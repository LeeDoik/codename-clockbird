import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import stageRouter from './routes/stage.js';
import studioRouter from './routes/studio.js';

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY) });
});

app.use('/api/stage', stageRouter);
app.use('/api/studio', studioRouter);

// 프롬프트 스튜디오 (팀원용 프롬프트 튜닝 UI) — 개발 모드 전용.
if (!isProd) {
  const studioPage = fileURLToPath(new URL('./studio.html', import.meta.url));
  app.get('/prompt-studio', (req, res) => res.sendFile(studioPage));
}

// 제출 빌드에서는 Express 가 dist/ 를 직접 서빙한다 (심사위원은 npm start 하나로 실행).
// 개발 중에는 Vite dev 서버가 클라이언트를 서빙하고 /api 만 이쪽으로 프록시한다.
if (isProd) {
  const dist = fileURLToPath(new URL('../../dist', import.meta.url));
  app.use(express.static(dist));

  // SPA 폴백. Express 5 는 path-to-regexp v8 을 쓰므로 app.get('*') 가 에러를 낸다.
  // 미들웨어로 처리한다.
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}

// 에러 핸들러 — 스택을 클라이언트에 노출하지 않는다.
app.use((err, req, res, _next) => {
  console.error('[error]', err);
  res.status(err.status || 500).json({ error: err.message || '서버 오류' });
});

app.listen(PORT, () => {
  console.log(`\n  코드네임: 태엽새 — 서버 기동`);
  console.log(`  API: http://localhost:${PORT}/api/health`);
  if (isProd) {
    console.log(`  게임: http://localhost:${PORT}\n`);
  } else {
    console.log(`  게임: http://localhost:5173  (Vite dev)`);
    console.log(`  프롬프트 스튜디오: http://localhost:${PORT}/prompt-studio\n`);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('  [!] ANTHROPIC_API_KEY 미설정 — 스테이지 시작이 실패합니다.\n');
  }
});
