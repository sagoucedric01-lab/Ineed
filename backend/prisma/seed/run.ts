// Seed : `pnpm seed` (référentiel, toujours sûr) ou `pnpm seed:demo` (référentiel + démonstration, hors production).
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { loadEnv } from '../../src/config/env.js';
import { seedReference } from './reference.js';
import { seedDemo } from './demo.js';

const env = loadEnv();
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
try {
  await seedReference(prisma);
  console.log('Référentiel : OK');
  if (process.argv.includes('--demo')) {
    await seedDemo(prisma, env.APP_ENV);
    console.log('Données de démonstration : OK (fictives, marquées « démo »)');
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
