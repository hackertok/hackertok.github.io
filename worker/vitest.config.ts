import { Buffer } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  cloudflareTest,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const workerRoot = fileURLToPath(new URL('.', import.meta.url));
const configPath = fileURLToPath(new URL('./wrangler.jsonc', import.meta.url));
const migrationsPath = fileURLToPath(new URL('./migrations', import.meta.url));

export default defineConfig(async () => {
  const migrations = await readD1Migrations(migrationsPath);
  const vapidKeyPair = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const vapidPublicKey = Buffer.from(
    await webcrypto.subtle.exportKey('raw', vapidKeyPair.publicKey),
  ).toString('base64url');
  const vapidPrivateJwk = await webcrypto.subtle.exportKey(
    'jwk',
    vapidKeyPair.privateKey,
  );

  return {
    root: workerRoot,
    plugins: [
      cloudflareTest({
        main: './src/index.ts',
        wrangler: { configPath },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ALLOWED_ORIGINS: 'https://hackertok.github.io',
            VAPID_PUBLIC_KEY: vapidPublicKey,
            VAPID_PRIVATE_JWK: JSON.stringify(vapidPrivateJwk),
          },
        },
      }),
    ],
    test: {
      globals: true,
      include: ['test/**/*.test.ts'],
      setupFiles: ['./test/apply-migrations.ts'],
    },
  };
});
