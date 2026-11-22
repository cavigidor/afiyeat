// Runs only the social sign-in tests. Same shape as the repo's main
// vitest.config.ts on the Lists V2 branches, so these tests also run
// there unchanged once both land. Usage (from the repo root):
//   npm install --no-save vitest@3.2.7 jsdom@26.1.0 @testing-library/react@16.3.3 \
//     @testing-library/dom@10.4.1 @testing-library/user-event@14.6.1
//   npx vitest run --config tests/socialAuth.vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  test: {
    root: fileURLToPath(new URL('..', import.meta.url)),
    environment: 'jsdom',
    include: ['tests/socialAuth*.test.{ts,tsx}', 'tests/accountSetup*.test.{ts,tsx}'],
    setupFiles: ['tests/socialAuth.setup.ts'],
    restoreMocks: true,
  },
});
