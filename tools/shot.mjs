/**
 * 게임 화면 스크린샷 — 코드네임: 태엽새
 *
 *   node tools/shot.mjs <경로> [옵션]
 *
 *   node tools/shot.mjs "?tutorial" -o hq.png
 *   node tools/shot.mjs "?stage3" --wait 8000 --keys "Space,Space" -o escape.png
 *
 *   -o <파일>      낼 파일 (기본 shot.png)
 *   --wait <ms>    화면을 찍기 전에 기다릴 시간 (기본 6000)
 *   --keys <목록>  기다린 뒤 눌러 볼 키 (쉼표로 구분, 각 키 사이 400ms).
 *                  `키:ms` 로 적으면 그만큼 **누르고 있는다** — 걸어 보게 하려면 이쪽이다
 *                  (한 번 눌렀다 떼면 한 프레임만 움직여 충돌을 못 확인한다).
 *                  예: --keys "Escape,W:900,A:600"
 *   --url <주소>   기본 http://localhost:5173
 *
 * 크롬의 `--screenshot` 은 못 쓴다 — `--virtual-time-budget` 이 타이머만 앞당기고
 * 네트워크 응답은 실시간이라, 세션 fetch 가 돌아오기 전에 찍힌다 (본부 NPC 가 없는
 * 화면이 나오던 이유). 그래서 CDP 로 붙어 **실제로 기다렸다가** 찍는다.
 *
 * 먼저 서버가 떠 있어야 한다:  npm run dev   (또는 dev:server + vite 따로)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => fs.existsSync(p));
if (!CHROME) throw new Error('크롬을 못 찾았다 — tools/shot.mjs 의 CHROME 목록에 경로를 더해라');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const path0 = args.find((a) => !a.startsWith('-') && args[args.indexOf(a) - 1]?.startsWith('-') !== true) ?? '';
const out = flag('-o', 'shot.png');
const waitMs = Number(flag('--wait', 6000));
const keys = (flag('--keys', '') || '').split(',').filter(Boolean);
const base = flag('--url', 'http://localhost:5173');
const target = base + path0;

/** 안 쓰는 포트 하나 — 이미 돌던 크롬 디버거에 잘못 붙는 걸 막는다. */
const freePort = () =>
  new Promise((res) => {
    const s = net.createServer();
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = await freePort();
// 프로필 폴더는 **절대경로**여야 한다 — 상대경로를 주면 크롬이 곧바로 21번으로 죽는다.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'clockbird-shot-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  '--enable-unsafe-swiftshader', // 헤드리스에는 GPU 가 없다 — 없으면 Phaser 가 캔버스로 떨어진다
  '--hide-scrollbars',
  '--mute-audio',
  '--no-first-run',
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`,
  '--window-size=1920,1080',
  'about:blank',
], { stdio: 'ignore' });

const cleanup = () => {
  chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 지워지면 그만 */ }
};

try {
  // 디버거가 열릴 때까지
  let tab = null;
  for (let i = 0; i < 60 && !tab; i++) {
    await sleep(250);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(target)}`, { method: 'PUT' });
      if (r.ok) tab = await r.json();
    } catch { /* 아직 안 떴다 */ }
  }
  if (!tab) throw new Error('크롬 디버거에 못 붙었다');

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('디버거 소켓 연결 실패'));
  });

  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m.result);
      pending.delete(m.id);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      logs.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      logs.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res) => {
      const n = ++id;
      pending.set(n, res);
      ws.send(JSON.stringify({ id: n, method, params }));
    });

  await send('Runtime.enable');
  await send('Page.enable');
  console.log(`${target} — ${waitMs}ms 기다린다`);
  await sleep(waitMs);

  /** 'W' → 브라우저가 아는 key/code/키코드 3종 */
  const describe = (k) => {
    if (k === 'Space') return { key: ' ', code: 'Space', vk: 32 };
    if (k === 'Escape') return { key: 'Escape', code: 'Escape', vk: 27 };
    const up = k.toUpperCase();
    return { key: up, code: `Key${up}`, vk: up.charCodeAt(0) };
  };

  for (const entry of keys) {
    const [name, holdStr] = entry.trim().split(':');
    const hold = Number(holdStr ?? 0);
    const { key, code, vk } = describe(name);
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown', key, code, text: key.length === 1 ? key : undefined, windowsVirtualKeyCode: vk,
    });
    // 누르고 있는 동안 게임이 프레임을 돌려야 하므로 실제로 기다린다.
    if (hold) await sleep(hold);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
    await sleep(hold ? 200 : 400);
  }

  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(data, 'base64'));
  console.log(`→ ${out}  (${(fs.statSync(out).size / 1024).toFixed(0)}KB)`);
  if (logs.length) {
    console.log('\n브라우저 오류:');
    for (const l of logs.slice(0, 10)) console.log('  ' + l);
  }
} finally {
  cleanup();
}
