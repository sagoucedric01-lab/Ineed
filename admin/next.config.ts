import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  // Racine du monorepo : nécessaire pour résoudre @ineed/design et produire l'image Docker autonome.
  outputFileTracingRoot: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  turbopack: { root: resolve(dirname(fileURLToPath(import.meta.url)), '..') },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ];
  },
};

export default config;
