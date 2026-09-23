import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// dist-extension/ is the only Chrome-loadable package root (see
// scripts/copy-runtime.mjs). The React workspace is built into its
// workspace/ subfolder with stable, hash-free names; app.html / planner.html
// load it as a packaged resource. `base: './'` keeps every URL relative to the
// extension page.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist-extension/workspace',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: 'src/workspace/main.jsx',
      output: {
        entryFileNames: 'workspace.js',
        chunkFileNames: '[name].js',
        assetFileNames: assetInfo =>
          assetInfo.name && /\.css$/i.test(assetInfo.name) ? 'workspace.css' : 'assets/[name]-[hash][extname]'
      }
    }
  }
});
