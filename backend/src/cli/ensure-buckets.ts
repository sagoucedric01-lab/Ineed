// Crée les buckets S3 s'ils n'existent pas (environnements local et test uniquement).
// En staging et production, les buckets sont provisionnés avec leurs règles d'accès par l'hébergeur.
import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { loadEnv } from '../config/env.js';

const env = loadEnv();
if (env.APP_ENV !== 'local' && env.APP_ENV !== 'test') {
  console.error(`Création automatique des buckets refusée (APP_ENV=${env.APP_ENV}) : provisionnez-les chez l'hébergeur.`);
  process.exit(1);
}
const s3 = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
});
for (const Bucket of [env.S3_BUCKET_PUBLIC, env.S3_BUCKET_PRIVATE]) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket }));
    console.log(`Bucket existant : ${Bucket}`);
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket }));
    console.log(`Bucket créé : ${Bucket}`);
  }
}
s3.destroy();
