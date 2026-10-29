import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BACKEND_DIR, createTestDatabase, migrate, prismaCli, type TestDatabase } from '../helpers/db.js';

describe('migrations sur une base vide', () => {
  let db: TestDatabase;
  let shadow: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
    shadow = await createTestDatabase('ineed_shadow');
  });
  afterAll(async () => {
    await db?.drop();
    await shadow?.drop();
  });

  it('s’appliquent toutes et activent PostGIS', async () => {
    const out = await migrate(db.url);
    expect(out).toContain('All migrations have been successfully applied');
    const c = new pg.Client({ connectionString: db.url });
    await c.connect();
    const applied = await c.query('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY 1');
    expect(applied.rows.map((r: { migration_name: string }) => r.migration_name)).toEqual([
      '20261028000000_init',
      '20261028120000_zones_unique_nulls_not_distinct', '20261029000000_dispatch', '20261030000000_payments',
    ]);
    const tables = await c.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name NOT IN ('spatial_ref_sys', '_prisma_migrations')`);
    expect(tables.rows[0].n).toBe(64);
    const postgis = await c.query('SELECT postgis_lib_version() AS v');
    expect(postgis.rows[0].v).toMatch(/^3\./);
    await c.end();
  });

  it('sont relancables sans effet (déjà appliquées)', async () => {
    const out = await migrate(db.url);
    expect(out).toContain('No pending migrations to apply');
  });

  it('correspondent exactement à schema.prisma (aucune dérive)', async () => {
    const { stdout } = await prismaCli(
      ['migrate', 'diff', '--from-migrations', 'prisma/migrations', '--to-schema', 'prisma/schema.prisma', '--exit-code'],
      { DATABASE_URL: db.url, SHADOW_DATABASE_URL: shadow.url },
    );
    expect(stdout).toContain('No difference detected');
  });

  it('font respecter les invariants critiques en base (attribution unique, devis, paiements, grand livre, avis, audit)', async () => {
    const script = readFileSync(resolve(BACKEND_DIR, '../docs/phase-1/schema-invariants-check.sql'), 'utf8')
      .split('\n').filter((l) => !l.startsWith('\\')).join('\n');
    const c = new pg.Client({ connectionString: db.url });
    const notices: string[] = [];
    c.on('notice', (n) => notices.push(n.message ?? ''));
    await c.connect();
    await c.query(script);
    await c.end();
    const ok = notices.filter((n) => n.startsWith('OK '));
    expect(ok).toHaveLength(10);
    expect(ok).toContain('OK 2 double attribution refusée');
  });

  it('refuse deux communes de même nom dans une même ville', async () => {
    const c = new pg.Client({ connectionString: db.url });
    await c.connect();
    const city = await c.query(`SELECT id FROM cities LIMIT 1`);
    const cityId = city.rows[0].id as string;
    await c.query(`INSERT INTO zones (city_id, kind, name) VALUES ($1, 'COMMUNE', 'Doublon')`, [cityId]);
    await expect(c.query(`INSERT INTO zones (city_id, kind, name) VALUES ($1, 'COMMUNE', 'Doublon')`, [cityId])).rejects.toThrow(/zones_city_id_parent_id_name_key/);
    await c.end();
  });
});
