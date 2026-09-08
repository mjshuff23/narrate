import { defineConfig } from 'vitest/config';

// Each workspace package owns its test environment (core/server: node, web: jsdom).
export default defineConfig({
  test: { projects: ['packages/core', 'apps/server', 'apps/web'] },
});
