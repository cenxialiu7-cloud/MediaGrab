import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {target:'http://127.0.0.1:9800',changeOrigin:true},
      '/ws': {
        target: 'ws://localhost:9800',
        ws: true,changeOrigin:true
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
