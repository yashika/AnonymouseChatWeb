/* 真实浏览器截图：中文界面 + English UI（通过分享链接加入的视角） */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'docs');
fs.mkdirSync(outDir, { recursive: true });

const BASE = 'http://127.0.0.1:9222';
const FILE_URL = 'file:///D:/prjs/encNetChat/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const bust = (q) => FILE_URL + '?' + (q ? q + '&' : '') + '_t=' + Date.now();

class Tab {
  constructor(t) { this.id = t.id; this.ws = new WebSocket(t.webSocketDebuggerUrl); this.seq = 0; this.w = new Map(); }
  async ready() {
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.w.has(m.id)) { const x = this.w.get(m.id); this.w.delete(m.id); m.error ? x.rej(new Error(JSON.stringify(m.error))) : x.res(m.result); }
    };
    return this;
  }
  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((res, rej) => { this.w.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); setTimeout(() => rej(new Error('timeout ' + method)), 30000); });
  }
  async ev(expr) { return (await this.send('Runtime.evaluate', { expression: `(function(){try{return ${expr}}catch(e){return 'ERR:'+e.message}})()`, returnByValue: true })).result.value; }
  async waitFor(expr, ms = 25000) {
    const t0 = Date.now();
    for (;;) { const v = await this.ev(expr); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout ' + expr); await sleep(250); }
  }
  async shot(file, w, h) {
    await this.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1.6, mobile: false });
    await this.ev(`document.getElementById('log').scrollTop = 0; 1`);
    await sleep(600);
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    console.log('saved', file);
  }
}
async function newTab(url) {
  const r = await fetch(BASE + '/json/new?' + encodeURIComponent(url), { method: 'PUT' });
  return new Tab(await r.json()).ready();
}
const say = (t, text, nick) => t.ev(`(function(){document.getElementById('nick').value=${JSON.stringify(nick)};document.getElementById('msg').value=${JSON.stringify(text)};document.getElementById('btnSend').click();return 1})()`);

const stale = (await (await fetch(BASE + '/json/list')).json()).filter(t => t.type === 'page');

/** 跑一轮对话，最后截「通过分享链接加入的人」的界面 */
async function scenario(lang, hostFile, joinFile) {
  const q = 'lang=' + lang;
  const a = await newTab(bust(q));
  await a.waitFor(`!!document.getElementById('btnConnect')`, 15000);
  const hostNick = lang === 'zh' ? '小明' : 'Alice';
  const joinNick = lang === 'zh' ? '小红' : 'Bob';
  const hello = lang === 'zh'
    ? '大家好，我是小明 👋 这个房间是用 GUID 建起来的'
    : 'Hi everyone, I created this room with a GUID 👋';
  const join = lang === 'zh'
    ? '我是小红，用你发的分享链接进来的，历史消息都看到了'
    : 'I am Bob — I opened your share link and can already see the history';
  const reply = lang === 'zh'
    ? '收到！现在是 P2P 直连，消息不经过服务器转发'
    : 'Got it! We are on a direct P2P channel now — nothing is relayed';

  await a.ev(`(function(){document.getElementById('nick').value=${JSON.stringify(hostNick)};document.getElementById('btnConnect').click();return 1})()`);
  await a.waitFor(`!!document.getElementById('guidTag')`, 25000);
  const guid = await a.ev(`document.getElementById('guid').value`);
  await say(a, hello, hostNick);
  await sleep(900);

  const b = await newTab(bust('lang=' + lang + '&guid=' + encodeURIComponent(guid)));
  await b.waitFor(`window.__encRoom && window.__encRoom.messages.length >= 1`, 25000);
  await b.ev(`(function(){document.getElementById('nick').value=${JSON.stringify(joinNick)};return 1})()`);
  await b.waitFor(`window.__encRoom.status().p2p > 0`, 30000);
  await say(b, join, joinNick);
  await sleep(800);
  await say(a, reply, hostNick);
  await sleep(1000);

  await a.shot(hostFile, 1120, 820);
  await b.shot(joinFile, 1120, 820);
  for (const t of [a, b]) { try { await fetch(BASE + '/json/close/' + t.id); } catch (e) { /* ignore */ } }
}

await scenario('zh', path.join(outDir, 'screenshot-zh.png'), path.join(outDir, 'screenshot-zh-join.png'));
await scenario('en', path.join(outDir, 'screenshot-en.png'), path.join(outDir, 'screenshot-en-join.png'));

for (const p of stale) { try { await fetch(BASE + '/json/close/' + p.id); } catch (e) { /* ignore */ } }
process.exit(0);
