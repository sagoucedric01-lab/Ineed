/** Règles de téléversement par usage. Toute image est ré-encodée côté serveur (métadonnées EXIF/GPS supprimées). */
export type FilePurpose = 'AVATAR' | 'VERIFICATION_DOC' | 'REQUEST_PHOTO' | 'REQUEST_VOICE';
export const FILE_PURPOSES: FilePurpose[] = ['AVATAR', 'VERIFICATION_DOC', 'REQUEST_PHOTO', 'REQUEST_VOICE'];

export interface FileRule {
  visibility: 'PUBLIC' | 'PRIVATE';
  mimeTypes: string[];
  maxBytes: number;
}

const IMAGES = ['image/jpeg', 'image/png', 'image/webp'];
export const AUDIO_MP4 = 'audio/mp4';

export const FILE_RULES: Record<FilePurpose, FileRule> = {
  AVATAR: { visibility: 'PUBLIC', mimeTypes: IMAGES, maxBytes: 10 * 1024 * 1024 },
  VERIFICATION_DOC: { visibility: 'PRIVATE', mimeTypes: [...IMAGES, 'application/pdf'], maxBytes: 10 * 1024 * 1024 },
  // Photos du domicile du client : privées, montrées au seul professionnel concerné par des liens temporaires.
  REQUEST_PHOTO: { visibility: 'PRIVATE', mimeTypes: IMAGES, maxBytes: 10 * 1024 * 1024 },
  // Notes vocales AAC (format enregistré par défaut sur Android et iOS) ; durée vérifiée dans l'en-tête du fichier.
  REQUEST_VOICE: { visibility: 'PRIVATE', mimeTypes: [AUDIO_MP4], maxBytes: 5 * 1024 * 1024 },
};

/**
 * Types réellement détectés acceptés pour un type annoncé (la signature d'un M4A peut être reconnue comme
 * « audio/x-m4a » ou comme « video/mp4 » selon l'application qui l'a produit).
 */
export const DETECTED_ALIASES: Record<string, string[]> = {
  [AUDIO_MP4]: ['audio/mp4', 'audio/x-m4a', 'video/mp4'],
};

export const MAX_IMAGE_SIDE = 2048;
/** Protection contre les « bombes de décompression » (images minuscules en octets mais gigantesques en pixels). */
export const MAX_INPUT_PIXELS = 40_000_000;
