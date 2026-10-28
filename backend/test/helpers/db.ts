import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { testServices } from './env.js';

const run = promisify(execFile);
export const BACKEND_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PRISMA_CLI = createRequire(import.meta.url).resolve('prisma/build/index.js');

export interface TestDatabase {
  name: string;
  url: string;
  drop(): Promise<void>;
}

function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

/** Crée une base vide, détruite par drop(). */
export async function createTestDatabase(prefix = 'ineed_it'): Promise<TestDatabase> {
  const name = `${prefix}_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: testServices.adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
  return {
    name,
    url: withDatabase(testServices.adminUrl, name),
    async drop() {
      const c = new pg.Client({ connectionString: testServices.adminUrl });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await c.end();
    },
  };
}

/** Exécute la CLI Prisma (migrate deploy, migrate diff…) sur la base indiquée. */
export async function prismaCli(args: string[], env: Record<string, string>): Promise<{ stdout: string; stderr: string }> {
  return run(process.execPath, [PRISMA_CLI, ...args], { cwd: BACKEND_DIR, env: { ...process.env, ...env } });
}

export async function migrate(url: string): Promise<string> {
  const { stdout } = await prismaCli(['migrate', 'deploy'], { DATABASE_URL: url });
  return stdout;
}

export function prismaFor(url: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}
