import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC émet les métadonnées de décorateurs nécessaires à l'injection de dépendances NestJS.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.spec.ts', 'scripts/**/*.spec.ts'],
    environment: 'node',
  },
});
