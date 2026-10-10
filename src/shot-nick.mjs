/* 截图：昵称记忆（新设备随机生成 / 老设备沿用） */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'docs');
const BASE = 'http://127.0.0.1:9222';
const URL_BASE = process.env.APP_URL || 'file:///D:/prjs/encNetChat/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class Tab {
  constructor(t) { this.id = t.id; this.ws = new WebSocket(t.webSocketDebuggerUrl); this.seq = 0; this.w = new Map(); }
  async ready() {
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && this.w.has(m.id)) { const x = this.w.get(m.id); this.w.delete(m.id); m.error ? x.rej(new Error(JSON.stringify(m.error))) : x.res(m.result); } };
    return this;
  }
  send(method, params = {}) { const id = ++this.seq; return new Promise((res, rej) => { this.w.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); setTimeout(() => rej(new Error('timeout ' + method)), 30000); }); }
  async ev(expr) { return (await this.send('Runtime.evaluate', { expression: `(function(){try{return ${expr}}catch(e){return 'ERR:'+e.message}})()`, returnByValue: true, awaitPromise: true })).result.value; }
  async waitFor(expr, ms = 25000) { const t0 = Date.now(); for (;;) { const v = await this.ev(expr); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout ' + expr); await sleep(250); } }
}
async function newTab(url) { const r = await fetch(BASE + '/json/new?' + encodeURIComponent(url), { method: 'PUT' }); return new Tab(await r.json()).ready(); }
const bust = (q) => URL_BASE + '?' + (q ? q + '&' : '') + '_t=' + Date.now();

const stale = (await (await fetch(BASE + '/json/list')).json()).filter(t => t.type === 'page');

// 1) 先造一个「全新设备」：清掉存储后**不要**重载这一页（重载会让它立刻又生成一个）
const a = await newTab(bust(''));
await a.waitFor(`!!document.getElementById('btnConnect')`, 15000);
await a.ev(`(function(){try{localStorage.removeItem('enc.nick');}catch(e){}` +
  `document.cookie='enc_nick=;max-age=0;path=/';document.cookie='enc.nick=;max-age=0;path=/';return 1})()`);
await sleep(300);

// 2) 新设备：随机昵称 + 建房，截图
const fresh = await newTab(bust(''));
await fresh.waitFor(`!!document.getElementById('btnConnect')`, 15000);
await fresh.ev(`(function(){document.getElementById('btnConnect').click();return 1})()`);
await fresh.waitFor(`!!document.getElementById('guidTag')`, 25000);
const nick = await fresh.ev(`document.getElementById('nick').value`);
await fresh.ev(`(function(){document.getElementById('msg').value='大家好，我的昵称是本机记住的';document.getElementById('btnSend').click();return 1})()`);
await sleep(800);
await fresh.send('Emulation.setDeviceMetricsOverride', { width: 1120, height: 820, deviceScaleFactor: 1.6, mobile: false });
await fresh.ev(`document.getElementById('log').scrollTop = 0; 1`);
await sleep(500);
const shot = await fresh.send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(outDir, 'screenshot-nickname.png'), Buffer.from(shot.data, 'base64'));
console.log('saved docs/screenshot-nickname.png  | 本设备昵称 =', nick);

// 3) 老设备：再开一页，应沿用同一昵称
const back = await newTab(bust(''));
await back.waitFor(`!!document.getElementById('btnConnect')`, 15000);
const nick2 = await back.ev(`document.getElementById('nick').value`);
console.log('再次打开得到昵称 =', nick2, '| 一致:', nick === nick2);

for (const t of [a, fresh, back]) { try { await fetch(BASE + '/json/close/' + t.id); } catch (e) { /* ignore */ } }
for (const p of stale) { try { await fetch(BASE + '/json/close/' + p.id); } catch (e) { /* ignore */ } }
process.exit(0);
