#!/usr/bin/env node
// Regenerates docs/screenshots/* from a running dev stack (web :3100, api :4000).
// Uses an installed Chrome/Edge in headless mode over the DevTools protocol — no extra packages.
//   node --experimental-websocket scripts/screenshots.mjs
// Admin shots log in with BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD from the environment.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WEB = process.env.SHOT_WEB || 'http://localhost:3100';
const API = process.env.SHOT_API || 'http://localhost:4000';
const OUT = join(process.cwd(), 'docs', 'screenshots');
const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const exe = BROWSERS.find((p) => existsSync(p));
if (!exe) throw new Error('No Chrome/Edge found');
mkdirSync(OUT, { recursive: true });

const port = 9333;
const browser = spawn(exe, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'nc-shots-'))}`,
  '--hide-scrollbars',
  '--no-first-run',
  '--lang=fa',
  'about:blank',
]);

let target;
for (let i = 0; i < 40 && !target; i++) {
  await sleep(250);
  target = await fetch(`http://127.0.0.1:${port}/json/list`)
    .then((r) => r.json())
    .then((l) => l.find((t) => t.type === 'page'))
    .catch(() => null);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value;

async function viewport(kind) {
  if (kind === 'phone') {
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  } else {
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  }
}

async function open(path, wait = 3500) {
  await send('Page.navigate', { url: WEB + path });
  await sleep(wait);
}

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 86 });
  writeFileSync(join(OUT, `${name}.jpg`), Buffer.from(data, 'base64'));
  console.log('✓', name);
}

const click = (text) =>
  evaluate(`(() => { const b = [...document.querySelectorAll('button, a')].find((x) => x.textContent.trim().includes(${JSON.stringify(text)})); b?.click(); return !!b; })()`);
const skipIntro = () => evaluate(`document.querySelector('[role=dialog] button')?.click(), true`);

await send('Page.enable');
await send('Runtime.enable');

const only = process.env.SHOT_ONLY; // e.g. "admin" to redo one group
const want = (group) => !only || only === group;

// Warm up the dev server so the first real shot isn't a half-compiled page.
await viewport('phone');
if (want('phone')) await open('/demo?theme=mist&sample=1', 12000);

// ---------- phone: every theme ----------
if (want('phone')) for (const theme of ['mist', 'graphite', 'sage', 'moss', 'pearl']) {
  await open(`/demo?theme=${theme}&sample=1`, 4500);
  await skipIntro();
  await sleep(900);
  await shot(`phone-${theme}`);
}

// ---------- phone: first screen, intro, sheets ----------
if (want('phone')) {
await open('/demo?theme=pearl', 4000);
await skipIntro();
await sleep(800);
await shot('phone-onboarding-pearl');

await open('/demo?theme=mist&intro=1', 4500);
await shot('phone-intro-welcome');
await click('ادامه');
await sleep(1200);
await shot('phone-intro-install');

await open('/demo?theme=mist&sample=1', 4000);
await skipIntro();
await sleep(600);
await click('تمدید');
await sleep(1300);
await shot('phone-renew');
await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })), true`);
await sleep(700);
await click('افزودن به اپ');
await sleep(1300);
await shot('phone-apps');
await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })), true`);
await sleep(700);
await click('اطلاعات بیشتر');
await sleep(1300);
await shot('phone-info');
}

// ---------- desktop ----------
await viewport('desktop');
if (want('desktop')) {
await open('/demo?theme=pearl&sample=1', 4500);
await sleep(800);
await shot('desktop-pearl');
await open('/demo?theme=mist&sample=1', 4500);
await shot('desktop-mist');
await open('/demo?theme=moss', 4500);
await shot('desktop-onboarding-moss');
}

// ---------- admin ----------
const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
if (email && password && want('admin')) {
  const login = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).then((r) => r.json());
  await open('/admin', 3000);
  await evaluate(`localStorage.setItem('nc.admin.token', ${JSON.stringify(login.accessToken)}), true`);
  await open('/admin?s=1#overview', 7000);
  await shot('admin-dashboard');
  await open('/admin?s=2#renewals', 5000);
  await shot('admin-renewals');
  await open('/admin?s=3#brands', 5000);
  await evaluate(`[...document.querySelectorAll('main button')].find((b) => b.querySelector('.h-24'))?.click(), true`);
  await sleep(2500);
  await shot('admin-brand');
  await evaluate(`[...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.trim() === 'تمدید')?.click(), true`);
  await sleep(1500);
  await shot('admin-plans');
}

// ---------- README hero: the themes side by side (docs/hero.html) ----------
if (want('hero')) {
  await send('Emulation.setDeviceMetricsOverride', { width: 2400, height: 1260, deviceScaleFactor: 1, mobile: false });
  const file = 'file:///' + join(process.cwd(), 'docs', 'hero.html').split(String.fromCharCode(92)).join('/');
  await send('Page.navigate', { url: file });
  await sleep(2500);
  const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
  writeFileSync(join(OUT, 'hero.jpg'), Buffer.from(data, 'base64'));
  console.log('✓ hero');
}

ws.close();
browser.kill();
