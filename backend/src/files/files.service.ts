import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { ENV, type Env } from '../config/env.js';
import { AppError } from '../common/http/api-error.js';
import type { File as FileRow } from '../generated/prisma/client.js';
import { PrismaService } from '../infra/prisma.service.js';
import { StorageService } from '../infra/storage.service.js';
import { FILE_RULES, type FilePurpose, MAX_IMAGE_SIDE, MAX_INPUT_PIXELS } from './file-rules.js';

export interface UploadTicket {
  fileId: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

const UPLOAD_URL_TTL_S = 600;

/**
 * Téléversement direct vers le stockage via URL présignée, puis contrôle serveur à la finalisation :
 * taille réelle, type réel (signature binaire, pas l'extension), ré-encodage des images.
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger('Fichiers');
  private readonly presigner: S3Client;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(ENV) private readonly env: Env,
  ) {
    // Client distinct pour signer avec l'adresse vue par les applications.
    this.presigner = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
      // Sinon le SDK signe une somme de contrôle CRC32 calculée sur un corps vide : tout envoi réel serait refusé (BadDigest).
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  }

  private bucketFor(visibility: 'PUBLIC' | 'PRIVATE'): string {
    return visibility === 'PUBLIC' ? this.storage.buckets.public : this.storage.buckets.private;
  }

  async createUpload(ownerId: string, purpose: FilePurpose, mimeType: string, sizeBytes: number): Promise<UploadTicket> {
    const rule = FILE_RULES[purpose];
    if (!rule.mimeTypes.includes(mimeType)) {
      throw new AppError(422, 'FILE_TYPE_NOT_ALLOWED', 'Ce type de fichier n’est pas accepté.', { allowed: rule.mimeTypes });
    }
    if (sizeBytes <= 0 || sizeBytes > rule.maxBytes) {
      throw new AppError(422, 'FILE_TOO_LARGE', `Ce fichier dépasse ${rule.maxBytes / 1024 / 1024} Mo.`, { maxBytes: rule.maxBytes });
    }
    const bucket = this.bucketFor(rule.visibility);
    const file = await this.prisma.file.create({
      data: { ownerUserId: ownerId, purpose, visibility: rule.visibility, bucket, objectKey: 'en-attente', mimeType, sizeBytes },
    });
    const objectKey = `${purpose.toLowerCase()}/${ownerId}/${file.id}`;
    await this.prisma.file.update({ where: { id: file.id }, data: { objectKey } });
    const headers = { 'content-type': mimeType, 'content-length': String(sizeBytes) };
    const uploadUrl = await getSignedUrl(
      this.presigner,
      new PutObjectCommand({ Bucket: bucket, Key: objectKey, ContentType: mimeType, ContentLength: sizeBytes }),
      { expiresIn: UPLOAD_URL_TTL_S, signableHeaders: new Set(['content-type', 'content-length']) },
    );
    return { fileId: file.id, uploadUrl, method: 'PUT', headers, expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_S * 1000).toISOString() };
  }

  /** Contrôle le fichier réellement déposé ; le refuse (et l'efface) s'il ne correspond pas à ce qui était annoncé. */
  async complete(ownerId: string, fileId: string): Promise<FileRow> {
    const file = await this.prisma.file.findFirst({ where: { id: fileId, ownerUserId: ownerId } });
    if (!file) throw new AppError(404, 'NOT_FOUND', 'Cet élément n’existe plus ou a été supprimé.');
    if (file.status === 'READY') return file;
    if (file.status !== 'PENDING_UPLOAD') throw new AppError(409, 'FILE_NOT_PENDING', 'Ce fichier a déjà été traité.');
    const rule = FILE_RULES[file.purpose as FilePurpose];
    const s3 = this.storage.client;
    const location = { Bucket: file.bucket, Key: file.objectKey };

    const reject = async (reason: string): Promise<never> => {
      await s3.send(new DeleteObjectCommand(location)).catch(() => undefined);
      await this.prisma.file.update({ where: { id: file.id }, data: { status: 'REJECTED' } });
      throw new AppError(422, 'FILE_REJECTED', reason);
    };

    let size: number;
    try {
      const head = await s3.send(new HeadObjectCommand(location));
      size = head.ContentLength ?? 0;
    } catch {
      throw new AppError(409, 'FILE_NOT_UPLOADED', 'Le fichier n’a pas encore été envoyé. Réessayez l’envoi.');
    }
    if (size <= 0 || size > rule.maxBytes) return reject('La taille du fichier ne correspond pas à celle annoncée.');

    const object = await s3.send(new GetObjectCommand(location));
    const body = Buffer.from(await object.Body!.transformToByteArray());
    const detected = await fileTypeFromBuffer(body);
    if (!detected || !rule.mimeTypes.includes(detected.mime) || detected.mime !== file.mimeType) {
      return reject('Le contenu du fichier ne correspond pas à son type. Formats acceptés : JPG, PNG, WebP' + (rule.mimeTypes.includes('application/pdf') ? ', PDF.' : '.'));
    }

    let finalBody = body;
    let finalMime = detected.mime;
    if (detected.mime.startsWith('image/')) {
      try {
        // rotate() applique l'orientation EXIF puis toutes les métadonnées (dont la position GPS) sont abandonnées.
        finalBody = await sharp(body, { limitInputPixels: MAX_INPUT_PIXELS })
          .rotate()
          .resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
        finalMime = 'image/jpeg';
      } catch (e) {
        this.logger.warn({ err: e, fileId }, 'Image illisible');
        return reject('Cette image est illisible ou trop grande.');
      }
      await s3.send(new PutObjectCommand({ ...location, Body: finalBody, ContentType: finalMime }));
    }
    return this.prisma.file.update({
      where: { id: file.id },
      data: { status: 'READY', mimeType: finalMime, sizeBytes: finalBody.length, sha256: createHash('sha256').update(finalBody).digest('hex') },
    });
  }

  /** URL de lecture temporaire (les deux buckets sont privés au niveau du stockage). */
  async readUrl(file: Pick<FileRow, 'bucket' | 'objectKey'>, ttlSeconds = 3600): Promise<string> {
    return getSignedUrl(this.presigner, new GetObjectCommand({ Bucket: file.bucket, Key: file.objectKey }), { expiresIn: ttlSeconds });
  }

  async remove(fileId: string): Promise<void> {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file || file.status === 'DELETED') return;
    await this.storage.client.send(new DeleteObjectCommand({ Bucket: file.bucket, Key: file.objectKey })).catch(() => undefined);
    await this.prisma.file.update({ where: { id: fileId }, data: { status: 'DELETED', deletedAt: new Date() } });
  }

  /** Fichier prêt, appartenant à l'utilisateur, pour l'usage attendu ; sinon erreur explicite. */
  async requireReady(ownerId: string, fileId: string, purpose: FilePurpose): Promise<FileRow> {
    const file = await this.prisma.file.findFirst({ where: { id: fileId, ownerUserId: ownerId, purpose } });
    if (!file) throw new AppError(404, 'NOT_FOUND', 'Cet élément n’existe plus ou a été supprimé.');
    if (file.status !== 'READY') throw new AppError(409, 'FILE_NOT_READY', 'Le fichier n’a pas fini d’être envoyé.');
    return file;
  }
}
