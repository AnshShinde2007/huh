import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Firefox build: plain Vite (no @crxjs/vite-plugin — it doesn't support Firefox).
// manifest.firefox.json is copied into dist-firefox/ by scripts/copy-firefox-manifest.js
// which runs as a post-build step via `npm run build:firefox`.
export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'dist-firefox',
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        background: resolve(import.meta.dirname, 'src/background.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',

        // Don't create shared chunks for content scripts
        inlineDynamicImports: false,
        manualChunks: undefined,
      },
    },
  },
})
