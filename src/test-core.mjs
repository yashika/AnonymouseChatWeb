/* Node 联调测试：两个/三个 Room 共享同一 GUID，验证消息互通 + retained 历史回放 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const i18nSrc = fs.readFileSync(path.join(__dirname, 'i18n.js'), 'utf8');
const src = fs.readFileSync(path.join(__dirname, 'core.js'), 'utf8');
const ENC = new Function(i18nSrc + '\n' + src + '\nreturn globalThis.ENC;')();

const BROKER = process.argv[2] || ENC.BROKERS[0].url;
const GUID = 'node-test-' + Date.now();
console.log('broker =', BROKER);
console.log('guid   =', GUID);
console.log('');

let failures = 0;
function check(name, cond, extra = '') {
  const tag = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(`  [${tag}] ${name}${extra ? ' :: ' + extra : ''}`);
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function mk(id, name) {
  const r = new ENC.Room({ guid: GUID, broker: BROKER, id, name });
  r.on('log', (l) => console.log(`   <${name}> ${l.level}: ${l.text}`));
  r.on('msg', (m) => console.log(`   <${name}> MSG <- ${m.name}: ${m.text}`));
  r.on('history', (items) => console.log(`   <${name}> HISTORY +${items.length}`));
  return r;
}
async function waitFor(fn, ms = 12000, step = 100) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(step); }
  return false;
}

// ---------------------------------------------------------------- 单元：100 条上限
console.log('== 单元测试：历史只保留最近 100 条 ==');
{
  const r = new ENC.Room({ guid: 'unit', broker: BROKER, id: 'unit', name: 'u' });
  const items = [];
  for (let i = 0; i < 130; i++) items.push({ id: 'x' + i, from: 'p', name: 'n', ts: 1000 + i, text: 'm' + i });
  r.mergeHistory(items);
  check('messages.length === 100', r.messages.length === 100, 'got ' + r.messages.length);
  check('保留的是最新 100 条', r.messages[0].text === 'm30' && r.messages[99].text === 'm129',
    r.messages[0].text + ' .. ' + r.messages[99].text);
  check('重复合并不会新增', r.mergeHistory(items) === false);
}

// ---------------------------------------------------------------- 端到端
console.log('\n== 端到端：A 建房发消息 → B 用同一 GUID 加入（应看到历史）→ 互发 ==');
const A = mk('a-1111', 'A');
const B = mk('b-2222', 'B');
const C = mk('c-3333', 'C');

A.start();
check('A 已连上公共节点', await waitFor(() => A.status().connected));
await waitFor(() => A.gotHistory, 6000);
check('A 收到 nohistory 事件（新房间）', A.gotHistory === true);

A.send('你好，这是 A 的第一条消息');
check('A 本地已有 1 条', A.messages.length === 1);
await sleep(1500); // 等 retained 历史落库

B.start();
check('B 已连上公共节点', await waitFor(() => B.status().connected));
check('B 通过 retained 历史看到 A 的消息', await waitFor(() => B.messages.length >= 1),
  'B.messages=' + B.messages.length);
check('B 收到的内容正确', B.messages[0] && B.messages[0].text.includes('A 的第一条消息'),
  B.messages[0] && B.messages[0].text);

B.send('收到，我是 B');
check('A 实时收到 B 的消息（/m 通道）', await waitFor(() => A.messages.length >= 2), 'A=' + A.messages.length);
check('A 与 B 的消息序列一致',
  JSON.stringify(A.messages.map(m => m.text)) === JSON.stringify(B.messages.map(m => m.text)),
  JSON.stringify(A.messages.map(m => m.text)) + ' vs ' + JSON.stringify(B.messages.map(m => m.text)));
check('没有重复消息（去重生效）', new Set(A.messages.map(m => m.id)).size === A.messages.length);

// 双方能看到在线人数
check('A 看到 2 名在线成员', await waitFor(() => A.status().online >= 2), 'online=' + A.status().online);

// 第三个后来者
await sleep(1600); // 让 retained 历史刷新
C.start();
check('C 已连上公共节点', await waitFor(() => C.status().connected));
check('C 后来加入也能看到之前 2 条', await waitFor(() => C.messages.length >= 2), 'C=' + C.messages.length);
check('C 看到的历史顺序正确',
  C.messages[0].text.includes('第一条') && C.messages[1].text.includes('我是 B'),
  JSON.stringify(C.messages.map(m => m.text)));

C.send('我是 C，后来者');
check('A 收到 C 的消息', await waitFor(() => A.messages.some(m => m.text.includes('后来者'))), 'A=' + A.messages.length);
check('B 收到 C 的消息', await waitFor(() => B.messages.some(m => m.text.includes('后来者'))), 'B=' + B.messages.length);

// 分享链接
check('分享链接格式正确', A.shareUrl('https://x.com/a.html?foo=1#z').endsWith('?guid=' + encodeURIComponent(GUID)),
  A.shareUrl('https://x.com/a.html?foo=1#z'));

A.stop(); B.stop(); C.stop();
await sleep(400);
console.log('\n' + (failures ? `❌ ${failures} 项失败` : '✅ 全部通过'));
process.exit(failures ? 1 : 0);
