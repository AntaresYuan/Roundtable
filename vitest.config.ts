import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      // fileURLToPath (not URL.pathname) so the alias resolves correctly on
      // Windows and on repo paths containing non-ASCII characters, which
      // URL.pathname would percent-encode into a non-existent directory.
      '@': fileURLToPath(new URL('./src/', import.meta.url)),
    },
  },
});
