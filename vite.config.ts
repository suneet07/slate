import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cliBridgePlugin } from './server/cliBridge';

export default defineConfig({
  plugins: [react(), cliBridgePlugin()],
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api/nvidia': {
        target: 'https://integrate.api.nvidia.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/nvidia/, '')
      }
    }
  }
});
