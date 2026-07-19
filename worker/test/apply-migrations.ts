import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import type { D1Migration } from '@cloudflare/vitest-pool-workers';

const testEnv = env as Cloudflare.Env & {
  TEST_MIGRATIONS: D1Migration[];
};

await applyD1Migrations(testEnv.PUSH_DB, testEnv.TEST_MIGRATIONS);
