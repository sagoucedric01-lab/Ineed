import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Tests d'intégration : vraie base PostgreSQL/PostGIS, vrai Redis, vrai stockage S3 (voir test/helpers/env.ts).
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/integration/**/*.int.spec.ts'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
