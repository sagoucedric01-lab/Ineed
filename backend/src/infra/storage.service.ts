import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { ENV, type Env } from '../config/env.js';

/** Accès au stockage objet S3-compatible (photos publiques, documents privés). */
@Injectable()
export class StorageService implements OnModuleDestroy {
  readonly client: S3Client;
  readonly buckets: { public: string; private: string };

  constructor(@Inject(ENV) env: Env) {
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
      maxAttempts: 1,
    });
    this.buckets = { public: env.S3_BUCKET_PUBLIC, private: env.S3_BUCKET_PRIVATE };
  }

  /** Vérifie que les deux buckets existent et sont accessibles avec les identifiants configurés. */
  async checkBuckets(signal?: AbortSignal): Promise<void> {
    for (const Bucket of [this.buckets.public, this.buckets.private]) {
      await this.client.send(new HeadBucketCommand({ Bucket }), { abortSignal: signal });
    }
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }
}
