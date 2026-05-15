/*
 * vite.config.ts
 *
 * Vite 개발 서버와 빌드 설정 파일입니다.
 * React 플러그인, Tailwind CSS 플러그인, 경로 alias, 청크 분리 전략, 개발 서버 포트를 정의합니다.
 *
 * 이 프로젝트는 MediaPipe, motion, React 등 비교적 큰 의존성을 사용하므로
 * manualChunks로 벤더 청크를 나눠 빌드 결과를 관리합니다.
 * 개발 서버는 package.json의 dev 스크립트와 함께 3000 포트에서 실행됩니다.
 */
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@mediapipe/tasks-vision')) return 'mediapipe';
          if (id.includes('motion')) return 'motion';
          if (id.includes('@base-ui/react') || id.includes('lucide-react') || id.includes('canvas-confetti')) return 'ui-vendor';
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'react-vendor';
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    allowedHosts: ['.trycloudflare.com'],
    hmr: process.env.DISABLE_HMR !== 'true',
    headers: { 'Cache-Control': 'no-store' },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
    },
  },
});
