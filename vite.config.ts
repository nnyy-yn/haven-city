import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // Desktop builds and browser profiles contain locked files and generated bundles.
    watch: { ignored: ['**/desktop/**', '**/playtest/**', '**/.pnpm-store/**'] },
  },
});
