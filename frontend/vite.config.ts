import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('/node_modules/')) {
            return undefined;
          }
          if (id.includes('/node_modules/@fortawesome/')) {
            return 'vendor-icons';
          }
          if (id.includes('/node_modules/highlight.js/')) {
            return 'vendor-highlight';
          }
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
            return 'vendor-react';
          }
          return 'vendor-markdown';
        },
      },
    },
  },
});
