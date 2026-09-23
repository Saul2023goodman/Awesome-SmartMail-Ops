import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The extension root is the repository root (manifest.json lives here), so the
// React workspace is built into ./workspace with stable, hash-free names and is
// loaded directly by app.html / planner.html as a packaged resource.
// `base: './'` keeps every URL relative to the extension page.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'workspace',
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
