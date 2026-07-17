import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// ESM 환경이라 __dirname 을 쓸 수 없다. import.meta.url 로 절대경로를 만든다.
const resolve = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: resolve('./src/client'),
  publicDir: resolve('./public'),
  build: {
    outDir: resolve('./dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // 개발 중에는 Vite dev 서버가 /api 요청을 Express 로 넘긴다.
    // 덕분에 클라이언트는 개발/제출 환경 모두 같은 상대경로(/api/...)를 쓴다.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
