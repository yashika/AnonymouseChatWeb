/* 通过 Chrome DevTools Protocol 在真实浏览器里端到端验证 index.html */
const BASE = 'http://127.0.0.1:9222';
// APP_URL 可指向线上地址，例如 APP_URL=https://user.github.io/repo/
const FILE_URL = process.env.APP_URL || 'file:///D:/prjs/encNetChat/index.html';

let failures = 0;
const check = (name, cond, extra = '') => {
  if (!cond) failures++;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}${extra ? ' :: ' + extra : ''}`);
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class Tab {
  constructor(target) {
    this.target = target;
    this.id = target.id;
    this.url = target.url;
    this.errors = [];
    this.consoleErrors = [];
    this.ws = new WebSocket(target.webSocketDebuggerUrl);
    this.seq = 0;
    this.waiting = new Map();
    this.ready = new Promise((res, rej) => {
      this.ws.onopen = () => res();
      this.ws.onerror = (e) => rej(new Error('ws error ' + (e.message || e.type)));
    });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.waiting.has(msg.id)) {
        const { res, rej } = this.waiting.get(msg.id);
        this.waiting.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
        return;
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        this.errors.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.consoleErrors.push(msg.params.args.map(a => a.value || a.description).join(' '));
      }
    };
    this.ready.then(() => Promise.all([this.send('Runtime.enable'), this.send('Log.enable')])).catch(() => {});
  }
  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((res, rej) => {
      this.waiting.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.waiting.has(id)) { this.waiting.delete(id); rej(new Error('CDP timeout ' + method)); } }, 30000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression: `(function(){ try { return ${expression} } catch(e) { return 'ERR:'+e.message } })()`,
      returnByValue: true, awaitPromise: true
    });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error((d.exception && d.exception.description) || d.text);
    }
    return r.result.value;
  }
  async waitFor(expr, ms = 20000, label = expr) {
    const t0 = Date.now();
    let last;
    for (;;) {
      last = await this.eval(expr);
      if (last && typeof last !== 'string') return last;
      if (last === true) return last;
      if (Date.now() - t0 > ms) throw new Error('等待超时: ' + label + ' (最后值 ' + JSON.stringify(last) + ')');
      await sleep(250);
    }
  }
  close() { try { this.ws.close(); } catch (e) { /* ignore */ } }
}

async function listPages() {
  const r = await fetch(BASE + '/json/list');
  return (await r.json()).filter(t => t.type === 'page');
}
async function newTab(url) {
  const r = await fetch(BASE + '/json/new?' + encodeURIComponent(url), { method: 'PUT' });
  if (!r.ok) throw new Error('新建标签页失败 HTTP ' + r.status);
  const t = new Tab(await r.json());
  await t.ready;
  return t;
}
const logOf = (t) => t.eval(`document.getElementById('log').innerText`);
const guidOf = (t) => t.eval(`document.getElementById('guid').value||''`);
const loaded = `!!document.getElementById('btnConnect')`;
// file:// 会被 Chrome 缓存，加时间戳强制读最新文件
const bust = (q) => FILE_URL + '?' + (q ? q + '&' : '') + '_t=' + Date.now();
const send = async (t, text, n) => t.eval(
  `(function(){document.getElementById('nick').value=${JSON.stringify(n)};` +
  `document.getElementById('msg').value=${JSON.stringify(text)};` +
  `document.getElementById('btnSend').click();return 1})()`);

(async () => {
  console.log('== 真实浏览器端到端测试 (Chrome ' + (await (await fetch(BASE + '/json/version')).json()).Browser + ') ==');

  // 干净起点：先开新页（避免关掉最后一个标签导致 Chrome 退出），再关掉遗留页面
  const stale = await listPages();
  const main = await newTab(bust(''));
  await main.waitFor(loaded, 15000, '页面加载');
  for (const p of stale) { try { await fetch(BASE + '/json/close/' + p.id); } catch (e) { /* ignore */ } }
  await sleep(300);
  check('页面加载完成且核心脚本已就绪', (await logOf(main)).includes('ENC 无服务器 P2P 聊天室'));
  check('页面无 JS 异常', main.errors.length === 0, main.errors.join(' | '));

  // ---------------------------------------------------------- 1) 空输入 = 新建房间
  console.log('\n-- 1) 输入框留空 → 点「连接」应新建聊天室并显示 SESSION GUID --');
  check('连接前输入框为空', (await guidOf(main)) === '', JSON.stringify(await guidOf(main)));
  await main.eval(`document.getElementById('btnConnect').click(); 1`);
  await main.waitFor(`!!document.getElementById('guidTag')`, 25000, '出现 GUID');
  const guidA = await guidOf(main);
  const logA1 = await logOf(main);
  check('GUID 已生成且为 UUID v4 格式',
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(guidA), guidA);
  check('日志框提示创建成功并显示当前 SESSION GUID',
    logA1.includes('聊天室创建成功') && logA1.includes(guidA));
  const shareTxt = await main.eval(`document.getElementById('shareUrl').textContent`);
  check('页面最末端已生成分享链接', shareTxt.includes('?guid=' + guidA), shareTxt);
  check('分享链接是页面最后一个可见区块 (footer)',
    await main.eval(`(function(){var f=document.querySelector('footer');var last=document.body.lastElementChild;if(last===f)return true;return last.tagName==='SCRIPT'&&((f.compareDocumentPosition(last)&Node.DOCUMENT_POSITION_FOLLOWING)>0)})()`));
  check('发送按钮已启用', (await main.eval(`document.getElementById('btnSend').disabled`)) === false);

  // ---------------------------------------------------------- 2) 发送消息
  console.log('\n-- 2) 输入文本 → 点「发送」 --');
  await send(main, '你好，我是 A 浏览器', 'A 浏览器');
  await sleep(600);
  check('A 自己的日志里出现该消息', (await logOf(main)).includes('你好，我是 A 浏览器'));
  check('A 的消息列表长度 1', (await main.eval(`window.__encRoom.messages.length`)) === 1);

  // ---------------------------------------------------------- 3) 第二个浏览器手动填 GUID 加入
  console.log('\n-- 3) 第二个页面手动把 GUID 填进输入框 → 点「连接」 --');
  const tabB = await newTab(bust(''));
  await tabB.waitFor(loaded, 15000, 'B 页面加载');
  await tabB.eval(`(function(){document.getElementById('guid').value=${JSON.stringify(guidA)};` +
    `document.getElementById('nick').value='B 浏览器';` +
    `document.getElementById('btnConnect').click();return 1})()`);
  await tabB.waitFor(`window.__encRoom && window.__encRoom.messages.length >= 1`, 25000, 'B 加载历史');
  const logB = await logOf(tabB);
  check('B 认出这是加入已有房间（非新建）', logB.includes('已加入 GUID 房间'));
  check('B 看到 A 之前发的消息', logB.includes('你好，我是 A 浏览器'));
  check('B 日志提示回放历史条数', /回放历史消息\s*\d+\s*条/.test(logB), (logB.match(/回放历史消息[^\n]*/) || [''])[0]);
  check('B 的日志里 GUID 与 A 相同', (await guidOf(tabB)) === guidA);

  await send(tabB, '收到，我是 B 浏览器', 'B 浏览器');
  await main.waitFor(`window.__encRoom.messages.some(m=>m.text.includes('B 浏览器'))`, 15000, 'A 收到 B 的消息');
  check('A 实时收到 B 的消息', (await logOf(main)).includes('收到，我是 B 浏览器'));
  check('A 与 B 消息序列一致',
    JSON.stringify(await main.eval(`window.__encRoom.messages.map(m=>m.text)`)) ===
    JSON.stringify(await tabB.eval(`window.__encRoom.messages.map(m=>m.text)`)));

  // ---------------------------------------------------------- 4) WebRTC P2P
  console.log('\n-- 4) WebRTC 数据通道（P2P 直连） --');
  const st = await main.waitFor(`(function(){var s=window.__encRoom.status();return s.p2p>0?s:false})()`, 30000, 'P2P 直连建立');
  check('A 与 B 建立了 P2P 直连 (DataChannel open)', st.p2p >= 1, 'p2p=' + st.p2p + '/' + st.peers);
  check('A 看到 2 人在线', st.online === 2, 'online=' + st.online);
  const pillTxt = await main.eval(`document.getElementById('pillText').textContent`);
  check('状态栏显示「已连接 · 在线2人 · P2P直连」', pillTxt.includes('已连接') && pillTxt.includes('P2P直连'), pillTxt);
  const dcs = await main.eval(`(function(){var r=window.__encRoom,ids=Object.keys(r.dcs),o=[];for(var i=0;i<ids.length;i++)o.push(ids[i]+':'+r.dcs[ids[i]].readyState);return o.join(',')})()`);
  check('DataChannel 状态为 open', dcs.includes(':open'), dcs);

  // ---------------------------------------------------------- 5) 分享链接自动加入
  console.log('\n-- 5) 用分享链接 ?guid= 打开第三个页面 --');
  for (let i = 1; i <= 5; i++) { await send(main, '第 ' + i + ' 条补充消息', 'A 浏览器'); await sleep(80); }
  await sleep(1500);
  const tabC = await newTab(bust('guid=' + encodeURIComponent(guidA)));
  await tabC.waitFor(loaded, 15000, 'C 页面加载');
  check('C 的输入框被链接参数自动填充', (await guidOf(tabC)) === guidA);
  await tabC.waitFor(`window.__encRoom && window.__encRoom.messages.length >= 7`, 25000, 'C 自动加入并加载历史');
  const cMsgs = await tabC.eval(`window.__encRoom.messages.map(m=>m.text)`);
  check('通过分享链接进入即自动加入同一房间', cMsgs.length >= 7, 'C.messages=' + cMsgs.length);
  check('C 看到最早那条 A 消息', cMsgs[0].includes('A 浏览器'), cMsgs[0]);
  check('C 看到 5 条补充消息', cMsgs.filter(x => x.includes('补充消息')).length === 5);
  check('C 日志提示由分享链接自动加入', (await logOf(tabC)).includes('自动加入'));
  await send(tabC, '我是从分享链接进来的 C', 'C');
  await main.waitFor(`window.__encRoom.messages.some(m=>m.text.includes('分享链接进来的 C'))`, 15000, 'A 收到 C 的消息');
  check('三人互通：A 收到 C 的消息', (await logOf(main)).includes('分享链接进来的 C'));

  // ---------------------------------------------------------- 6) 最近 100 条
  console.log('\n-- 6) 只回放「最后 100 条」 --');
  await main.eval(`(function(){ for (var i=1;i<=110;i++) window.__encRoom.send('压测消息 '+i); return 1 })()`);
  await sleep(3000);
  const aLen = await main.eval(`window.__encRoom.messages.length`);
  check('A 本地只保留最近 100 条', aLen === 100, 'len=' + aLen);
  const tabD = await newTab(bust('guid=' + encodeURIComponent(guidA)));
  await tabD.waitFor(loaded, 15000, 'D 页面加载');
  await tabD.waitFor(`window.__encRoom && window.__encRoom.messages.length > 0`, 25000, 'D 加载历史');
  const dMsgs = await tabD.eval(`window.__encRoom.messages.map(m=>m.text)`);
  check('新页面正好回放 100 条', dMsgs.length === 100, 'D.messages=' + dMsgs.length);
  check('最后一条是最新的压测消息 110', dMsgs[dMsgs.length - 1].includes('压测消息 110'), dMsgs[dMsgs.length - 1]);
  check('最旧的消息已被丢弃', !dMsgs.some(x => x.includes('A 浏览器')));

  // ---------------------------------------------------------- 7) 纯 P2P 模式
  console.log('\n-- 7) 纯 P2P 模式：聊天内容不经中继 --');
  const guidP = (await newTab(bust(''))), tabE = guidP;
  await tabE.waitFor(loaded, 15000, 'E 页面加载');
  await tabE.eval(`(function(){document.getElementById('pure').checked=true;document.getElementById('nick').value='E 纯P2P';document.getElementById('btnConnect').click();return 1})()`);
  await tabE.waitFor(`!!document.getElementById('guidTag')`, 25000, 'E 建房');
  const guidE = await guidOf(tabE);
  await send(tabE, '这是纯P2P的第一条', 'E 纯P2P');
  await sleep(1200);

  const tabF = await newTab(bust(''));
  await tabF.waitFor(loaded, 15000, 'F 页面加载');
  await tabF.eval(`(function(){document.getElementById('pure').checked=true;` +
    `document.getElementById('guid').value=${JSON.stringify(guidE)};` +
    `document.getElementById('nick').value='F 纯P2P';` +
    `document.getElementById('btnConnect').click();return 1})()`);
  await tabF.waitFor(`window.__encRoom && window.__encRoom.pureP2P === true`, 10000, 'F 已是纯 P2P');
  await tabF.waitFor(`window.__encRoom.status().p2p > 0`, 30000, 'F 与 E 建立直连');
  check('纯 P2P 下双方仍能建立直连', true);
  await send(tabF, '纯P2P下 F 的回话', 'F 纯P2P');
  await tabE.waitFor(`window.__encRoom.messages.some(m=>m.text.includes('F 的回话'))`, 15000, 'E 收到 F');
  check('纯 P2P 下 E 收到 F 的消息（走 DataChannel、不经中继）',
    (await logOf(tabE)).includes('F 的回话'));
  check('纯 P2P 下双方各自收到 2 条（本地记录一致）',
    (await tabE.eval(`window.__encRoom.messages.length`)) === 2, 'E=' + await tabE.eval(`window.__encRoom.messages.length`));

  // 用普通（混合）模式打开同一个 GUID，不应该看到纯 P2P 的聊天内容
  const tabG = await newTab(bust('guid=' + encodeURIComponent(guidE)));
  await tabG.waitFor(loaded, 15000, 'G 页面加载');
  await tabG.waitFor(`window.__encRoom && window.__encRoom.status().connected`, 25000, 'G 连上');
  await sleep(4000);
  const gMsgs = await tabG.eval(`window.__encRoom.messages.length`);
  check('后来者在中继上找不到纯 P2P 的聊天记录（证明未经过中继）', gMsgs === 0, 'G.messages=' + gMsgs);

  // ---------------------------------------------------------- 8) 中英双语
  console.log('\n-- 8) 中英双语 / bilingual --');
  const tabH = await newTab(FILE_URL + '?lang=en&_t=' + Date.now());
  await tabH.waitFor(loaded, 15000, 'H 页面加载');
  check('?lang=en 时 html lang 变为 en', (await tabH.eval(`document.documentElement.lang`)) === 'en');
  check('?lang=en 时标题为英文', (await tabH.eval(`document.title`)).includes('Serverless'), await tabH.eval(`document.title`));
  check('?lang=en 时「连接」按钮显示 Connect',
    (await tabH.eval(`document.getElementById('btnConnect').textContent`)) === 'Connect');
  check('?lang=en 时 GUID 输入框提示为英文',
    (await tabH.eval(`document.getElementById('guid').placeholder`)).includes('paste a GUID'));
  check('?lang=en 时英文使用说明已输出',
    (await logOf(tabH)).includes('is ready'), (await logOf(tabH)).split('\n')[0]);

  // 建房 → 英文日志
  await tabH.eval(`document.getElementById('btnConnect').click(); 1`);
  await tabH.waitFor(`!!document.getElementById('guidTag')`, 25000, 'H 建房');
  const guidH = await guidOf(tabH);
  await sleep(800);
  check('英文界面建房日志为英文', (await logOf(tabH)).includes('Room created'), '');
  check('英文界面分享链接同样生成',
    (await tabH.eval(`document.getElementById('shareUrl').textContent`)).includes(guidH));
  await send(tabH, 'English UI message', 'Alice');
  await sleep(400);
  check('英文界面自己的消息落进日志', (await logOf(tabH)).includes('English UI message'));
  check('英文界面「我」显示为 Me', (await logOf(tabH)).includes('Me：'), (await logOf(tabH)).split('\n').slice(-1)[0]);

  // 切换回中文
  await tabH.eval(`document.querySelector('#langSwitch button[data-lang="zh"]').click(); 1`);
  await sleep(400);
  check('点击「中文」后按钮变回中文',
    (await tabH.eval(`document.getElementById('btnConnect').textContent`)) === '连接');
  check('切换语言后 html lang 变回 zh-CN', (await tabH.eval(`document.documentElement.lang`)) === 'zh-CN');
  check('切换语言后状态栏文字变中文',
    (await tabH.eval(`document.getElementById('pillText').textContent`)).includes('已连接'),
    await tabH.eval(`document.getElementById('pillText').textContent`));
  check('切换语言会写入一条提示日志', (await logOf(tabH)).includes('语言已切换为中文'));

  // 中文链接仍能自动加入并回放
  const tabI = await newTab(FILE_URL + '?lang=zh&guid=' + encodeURIComponent(guidH) + '&_t=' + Date.now());
  await tabI.waitFor(loaded, 15000, 'I 页面加载');
  await tabI.waitFor(`window.__encRoom && window.__encRoom.messages.length >= 1`, 25000, 'I 加载历史');
  check('?lang=zh&guid= 组合参数可正常自动加入',
    (await logOf(tabI)).includes('English UI message'));

  // ---------------------------------------------------------- 9) 昵称记忆
  console.log('\n-- 9) 昵称：新设备随机 / 老设备沿用 --');
  const nickOf = (t) => t.eval(`document.getElementById('nick').value`);
  const clearNick = (t) => t.eval(`(function(){try{localStorage.removeItem('enc.nick');}catch(e){}` +
    `document.cookie='enc_nick=;max-age=0;path=/';document.cookie='enc.nick=;max-age=0;path=/';return 1})()`);

  await clearNick(tabI);   // 先把当前浏览器弄成「全新设备」

  const tabJ = await newTab(bust(''));
  await tabJ.waitFor(loaded, 15000, 'J 页面加载');
  const nickJ = await nickOf(tabJ);
  check('全新设备：打开即生成随机昵称', !!nickJ && nickJ.length >= 4, nickJ);
  check('全新设备：日志说明已生成并记住', (await logOf(tabJ)).includes('首次在本设备打开'),
    (await logOf(tabJ)).split('\n').slice(0, 3).join(' / '));

  const tabK = await newTab(bust(''));
  await tabK.waitFor(loaded, 15000, 'K 页面加载');
  const nickK = await nickOf(tabK);
  check('再次打开：一直沿用老昵称（不再随机）', nickK === nickJ, `${nickJ} vs ${nickK}`);
  check('老设备：日志说明已恢复昵称', (await logOf(tabK)).includes('已恢复本设备此前使用的昵称'),
    (await logOf(tabK)).split('\n').slice(0, 3).join(' / '));

  await tabK.eval(`(function(){var n=document.getElementById('nick');n.value='张三';` +
    `n.dispatchEvent(new Event('change'));return 1})()`);
  await sleep(400);
  check('手动改名后日志提示已记住', (await logOf(tabK)).includes('昵称已改为「张三」'));
  const tabL = await newTab(bust(''));
  await tabL.waitFor(loaded, 15000, 'L 页面加载');
  check('手动改的昵称被记住并成为默认', (await nickOf(tabL)) === '张三', await nickOf(tabL));

  // cookie 兜底：只清 localStorage 也应能找回（file:// 下浏览器根本不写 cookie，只在 http(s) 下验证）
  await tabL.eval(`(function(){try{localStorage.removeItem('enc.nick');}catch(e){}return 1})()`);
  const tabN = await newTab(bust(''));
  await tabN.waitFor(loaded, 15000, 'N 页面加载');
  if (FILE_URL.startsWith('http')) {
    check('cookie 兜底：localStorage 被清后仍能找回昵称', (await nickOf(tabN)) === '张三', await nickOf(tabN));
  } else {
    console.log('  [SKIP] cookie 兜底 —— file:// 下浏览器不写 cookie，改用线上地址验证 (APP_URL=...)');
  }

  // 全部清空 → 视为新设备，重新随机
  await clearNick(tabN);
  const tabM = await newTab(bust(''));
  await tabM.waitFor(loaded, 15000, 'M 页面加载');
  const nickM = await nickOf(tabM);
  check('存储被清空后重新随机出不同昵称', !!nickM && nickM !== '张三', nickM);

  // 昵称真的跟着消息发出去（自己看到「我」，别人看到昵称）
  await tabM.eval(`(function(){document.getElementById('btnConnect').click();return 1})()`);
  await tabM.waitFor(`!!document.getElementById('guidTag')`, 25000, 'M 建房');
  const guidM = await guidOf(tabM);
  check('连接的房间使用的是记住的昵称', (await tabM.eval(`window.__encRoom.name`)) === nickM,
    await tabM.eval(`window.__encRoom.name`));
  await send(tabM, 'my nickname is remembered', 'ignored');
  await sleep(600);
  const tabO = await newTab(bust('guid=' + encodeURIComponent(guidM)));
  await tabO.waitFor(loaded, 15000, 'O 页面加载');
  await tabO.waitFor(`window.__encRoom && window.__encRoom.messages.length >= 1`, 25000, 'O 加载历史');
  check('对方看到的是本设备记住的昵称',
    (await logOf(tabO)).includes(nickM + '：my nickname is remembered'),
    (await logOf(tabO)).split('\n').slice(-1)[0]);

  // ---------------------------------------------------------- 10) 异常检查
  console.log('\n-- 10) 页面异常 --');
  const allTabs = [main, tabB, tabC, tabD, tabE, tabF, tabG, tabH, tabI, tabJ, tabK, tabL, tabN, tabM, tabO];
  const allErr = allTabs.flatMap(t => t.errors.concat(t.consoleErrors));
  check('全部页面均无未捕获异常', allErr.length === 0, allErr.join(' | '));

  console.log('\n' + (failures ? `❌ ${failures} 项失败` : '✅ 全部通过'));
  allTabs.forEach(t => t.close());
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('\n💥 测试中断:', e.message);
  process.exit(2);
});
