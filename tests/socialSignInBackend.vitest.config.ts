// Runs the backend tests for the social sign-in safety work (SQL proposal + delete-account).
// Same shape as the repo's vitest.config.ts on the Lists V2 branches, so these files also run
// there unchanged. Usage (from the repo root):
//   npm install --no-save vitest@3.2.7 @electric-sql/pglite@0.5.13
//   npx vitest run --config tests/socialSignInBackend.vitest.config.ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  test: {
    root: fileURLToPath(new URL('..', import.meta.url)),
    environment: 'node',
    include: ['tests/socialSignInSafety.db.test.ts', 'tests/deleteAccount*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
