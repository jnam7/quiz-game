import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@quiz/shared': path.resolve(__dirname, '../shared/src')
    }
  },
  server: {
    host: '0.0.0.0', // 모든 네트워크 인터페이스(스마트폰 등 외부 기기) 접속 허용
    port: 3000,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:4000',
        ws: true
      },
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true
      }
    }
  }
});
