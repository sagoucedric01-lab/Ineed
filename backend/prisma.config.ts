import { defineConfig } from 'prisma/config';

// La structure de la base est définie par les migrations SQL (prisma/migrations), qui font foi.
// schema.prisma décrit cette structure pour le client typé ; `pnpm migrate:check-drift` vérifie leur cohérence.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // Facultatif pour `prisma generate` (CI, typage) ; obligatoire pour les commandes de migration.
    url: process.env.DATABASE_URL,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
