/*!
 * ENC i18n — 中英双语文案 / Chinese & English strings
 * ------------------------------------------------------------------
 * 语言选择优先级 / language priority:
 *   ?lang=xx  →  localStorage('enc.lang')  →  navigator.language  →  zh
 */
(function () {
  'use strict';

  var DICT = {
    /* ============================================================ 中文 */
    zh: {
      'html.lang': 'zh-CN',
      'doc.title': 'ENC · 无服务器 P2P 聊天室',
      'app.title': '无服务器 P2P 聊天室',
      'app.github': 'GitHub 源码',

      'status.off': '未连接',
      'status.connecting': '连接中… · 在线 {n} 人',
      'status.on.relay': '已连接 · 在线 {n} 人 · 中继',
      'status.on.pure': '已连接 · 在线 {n} 人 · 纯P2P',
      'status.p2p': ' · P2P直连 {a}/{b}',

      'lbl.guid': '房间 GUID',
      'ph.guid': '留空 = 新建聊天室；粘贴别人的 GUID / 分享链接 = 加入',
      'btn.connect': '连接',
      'btn.disconnect': '断开',
      'lbl.pure': '纯 P2P（聊天内容不经中继）',
      'lbl.broker': '公共节点',
      'lbl.nick': '我的昵称',
      'hint.sameNode': '提示：双方必须选同一个节点才能互相发现',
      'ph.msg': '输入消息，回车发送…',
      'btn.send': '发送',
      'btn.clear': '清屏',
      'lbl.share': '分享链接',
      'share.none': '连接后会在这里生成分享链接',
      'btn.copyLink': '复制链接',
      'btn.copyGuid': '复制 GUID',
      'btn.copied': '已复制 ✓',

      'broker.emqx': 'EMQX 公共节点（推荐）',
      'broker.hivemq': 'HiveMQ 公共节点',
      'broker.mosquitto': 'Mosquitto 测试节点',

      'chat.me': '我',
      'chat.anon': '匿名',
      'chat.user': '用户',

      'log.connecting': '正在连接公共节点 {url} …',
      'log.connected.relay': '已接入公共节点（信令 + 保留最近 100 条记录）',
      'log.connected.pure': '已接入公共节点（仅用于信令，聊天内容走 P2P）',
      'log.peerJoin': '成员加入：{name}  [{id}]',
      'log.peerLeave': '成员离开：{name}',
      'log.peerOffline': '成员离线：{name}',
      'log.p2pUp': '🔗 P2P 直连已建立 ↔ {name}',
      'log.p2pDown': 'P2P 直连不可用（{state}），自动走中继。',
      'log.mqttClose': '与公共节点的连接断开，正在重连…',
      'log.mqttError': '节点错误：{msg}',
      'log.retryIn': '{n} 秒后重试连接…',
      'log.pureNoPeer': '纯 P2P 模式下当前没有已建直连的在线成员，本条消息未能送达对方。',
      'log.notConnected': '尚未连接公共节点，本条消息只保存在本机，未广播。',
      'log.noWebRTC': 'WebRTC 不可用：{msg}',
      'log.offerFail': '创建 offer 失败：{msg}',
      'log.handleOfferFail': '处理 offer 失败：{msg}',
      'log.handleAnswerFail': '处理 answer 失败：{msg}',

      'log.newRoom': '新建聊天室：正在接入公共节点…',
      'log.joinRoom': '加入聊天室 [{guid}]：正在接入公共节点…',
      'log.modePure': '传输模式：纯 P2P（聊天内容只走 WebRTC 直连，不经过中继）',
      'log.modeHybrid': '传输模式：混合模式（WebRTC 直连 + 中继兜底，并保留最近 100 条记录）',
      'log.created': '✅ 聊天室创建成功，SESSION GUID（把它发给对方即可加入）：',
      'log.joined': '✅ 已加入 GUID 房间：',
      'log.shareIs': '分享链接：',
      'log.shareHelp': '把上面这个链接发给别人，对方打开就能直接进入本房间并看到最近 100 条聊天记录。',
      'log.fileWarning': '⚠️ 当前是以本地文件(file://)打开的，这个链接只在本机有效。要真正分享给别人，请把 index.html 放到任意静态网站 / 内网 HTTP 服务上，再用那个网址打开。',
      'log.replay': '📜 回放历史消息 {n} 条（房间最多保留最近 {cap} 条）',
      'log.noHistory': '本房间暂无历史记录 —— 你是第一个到达的人。',
      'log.needConnect': '请先点击「连接」。',
      'log.disconnected': '已断开连接。',
      'log.tooLong': '消息过长，已截断到 {n} 字符。',
      'log.ready': 'ENC 无服务器 P2P 聊天室 v{v} 已就绪。',
      'log.tip1': '① 输入框留空 → 点「连接」= 新建聊天室；② 粘贴别人的 GUID / 分享链接 → 点「连接」= 加入同一个房间。',
      'log.tip2': '③ 多个人使用同一个 GUID 即可互相收发消息；链接里的 ?guid= 会自动加入。',
      'log.autoJoin': '检测到分享链接参数 ?guid={g}，正在自动加入房间并加载最近 100 条聊天记录…',
      'log.cleared': '已清屏。',
      'log.noRTC': '当前浏览器不支持 WebRTC，P2P 直连不可用，将只能使用中继模式。',
      'log.pureOn': '已切换为纯 P2P：聊天内容只走 WebRTC 直连，不写入公共节点的保留记录；若对方离线或 NAT 打洞失败，消息将无法送达（双方都需在线才能收到历史记录）。',
      'log.pureOff': '已切换为混合模式：P2P 直连 + 中继兜底，并保留最近 100 条记录。',
      'log.copyFail': '复制失败，请手动选择文本复制。',
      'log.coreMissing': '核心脚本未加载（core.js 缺失）。',
      'log.langZh': '语言已切换为中文。',
      'log.langEn': 'Language switched to English.'
    },

    /* ========================================================== English */
    en: {
      'html.lang': 'en',
      'doc.title': 'ENC · Serverless P2P Chat',
      'app.title': 'Serverless P2P Chat',
      'app.github': 'Source on GitHub',

      'status.off': 'Disconnected',
      'status.connecting': 'Connecting… · {n} online',
      'status.on.relay': 'Connected · {n} online · Relay',
      'status.on.pure': 'Connected · {n} online · Pure P2P',
      'status.p2p': ' · P2P {a}/{b}',

      'lbl.guid': 'Room GUID',
      'ph.guid': 'Empty = create a room; paste a GUID or share link = join',
      'btn.connect': 'Connect',
      'btn.disconnect': 'Disconnect',
      'lbl.pure': 'Pure P2P (chat never touches the relay)',
      'lbl.broker': 'Public node',
      'lbl.nick': 'My nickname',
      'hint.sameNode': 'Tip: both sides must pick the same node to find each other',
      'ph.msg': 'Type a message, press Enter to send…',
      'btn.send': 'Send',
      'btn.clear': 'Clear',
      'lbl.share': 'Share link',
      'share.none': 'Your share link will appear here once you connect',
      'btn.copyLink': 'Copy link',
      'btn.copyGuid': 'Copy GUID',
      'btn.copied': 'Copied ✓',

      'broker.emqx': 'EMQX public node (recommended)',
      'broker.hivemq': 'HiveMQ public node',
      'broker.mosquitto': 'Mosquitto test node',

      'chat.me': 'Me',
      'chat.anon': 'Anonymous',
      'chat.user': 'User',

      'log.connecting': 'Connecting to public node {url} …',
      'log.connected.relay': 'Connected to the public node (signaling + last 100 messages kept)',
      'log.connected.pure': 'Connected to the public node (signaling only; chat goes P2P)',
      'log.peerJoin': 'Peer joined: {name}  [{id}]',
      'log.peerLeave': 'Peer left: {name}',
      'log.peerOffline': 'Peer offline: {name}',
      'log.p2pUp': '🔗 P2P direct channel established ↔ {name}',
      'log.p2pDown': 'P2P direct channel unavailable ({state}); falling back to the relay.',
      'log.mqttClose': 'Disconnected from the public node, reconnecting…',
      'log.mqttError': 'Node error: {msg}',
      'log.retryIn': 'Retrying in {n}s…',
      'log.pureNoPeer': 'Pure P2P: no online peer has a direct channel yet, so this message was not delivered.',
      'log.notConnected': 'Not connected to the public node yet — this message is stored locally only.',
      'log.noWebRTC': 'WebRTC unavailable: {msg}',
      'log.offerFail': 'Failed to create offer: {msg}',
      'log.handleOfferFail': 'Failed to handle offer: {msg}',
      'log.handleAnswerFail': 'Failed to handle answer: {msg}',

      'log.newRoom': 'Creating a new room: connecting to the public node…',
      'log.joinRoom': 'Joining room [{guid}]: connecting to the public node…',
      'log.modePure': 'Transport: Pure P2P (chat travels only over the WebRTC direct channel)',
      'log.modeHybrid': 'Transport: Hybrid (WebRTC direct + relay fallback, last 100 messages kept)',
      'log.created': '✅ Room created. SESSION GUID (send it to others so they can join):',
      'log.joined': '✅ Joined GUID room:',
      'log.shareIs': 'Share link:',
      'log.shareHelp': 'Send that link to anyone — opening it joins this room automatically and replays the last 100 messages.',
      'log.fileWarning': '⚠️ This page is open from a local file (file://), so the link works only on this machine. To really share it, host index.html on any static website / HTTP server and use that URL.',
      'log.replay': '📜 Replayed {n} messages (a room keeps the latest {cap})',
      'log.noHistory': 'No history in this room yet — you are the first one here.',
      'log.needConnect': 'Click “Connect” first.',
      'log.disconnected': 'Disconnected.',
      'log.tooLong': 'Message too long — truncated to {n} characters.',
      'log.ready': 'ENC Serverless P2P Chat v{v} is ready.',
      'log.tip1': '① Leave the box empty → “Connect” creates a room. ② Paste a GUID / share link → “Connect” joins that room.',
      'log.tip2': '③ Everyone using the same GUID can chat together; ?guid= in the link joins automatically.',
      'log.autoJoin': 'Found ?guid={g} in the URL — joining the room and loading the last 100 messages…',
      'log.cleared': 'Cleared.',
      'log.noRTC': 'This browser does not support WebRTC, so P2P is unavailable and only the relay can be used.',
      'log.pureOn': 'Switched to Pure P2P: chat travels only over WebRTC and is not stored on the public node. If the other side is offline or NAT traversal fails, messages cannot be delivered (both sides must be online to receive history).',
      'log.pureOff': 'Switched to Hybrid: WebRTC direct + relay fallback, last 100 messages kept.',
      'log.copyFail': 'Copy failed — please select the text and copy manually.',
      'log.coreMissing': 'Core script missing (core.js not loaded).',
      'log.langZh': '语言已切换为中文。',
      'log.langEn': 'Language switched to English.'
    }
  };

  var LANGS = ['zh', 'en'];
  var current = 'zh';
  var handlers = [];

  function t(key, params) {
    var table = DICT[current] || DICT.zh;
    var s = table[key];
    if (s == null) s = DICT.zh[key];
    if (s == null) s = key;
    if (params) {
      s = s.replace(/\{(\w+)\}/g, function (m, k) {
        return (params[k] === undefined || params[k] === null) ? m : String(params[k]);
      });
    }
    return s;
  }

  function detect() {
    try {
      if (typeof location !== 'undefined' && location.search) {
        var q = new URLSearchParams(location.search).get('lang');
        if (q) { q = q.toLowerCase().slice(0, 2); if (DICT[q]) return q; }
      }
    } catch (e) { /* ignore */ }
    try {
      if (typeof localStorage !== 'undefined') {
        var s = localStorage.getItem('enc.lang');
        if (s && DICT[s]) return s;
      }
    } catch (e) { /* ignore */ }
    try {
      var n = String((typeof navigator !== 'undefined' && (navigator.language || navigator.userLanguage)) || 'zh').toLowerCase();
      return n.indexOf('zh') === 0 ? 'zh' : 'en';
    } catch (e) { /* ignore */ }
    return 'zh';
  }

  /** 把 data-i18n / data-i18n-ph / data-i18n-title 的元素填上文案 */
  function apply(root) {
    root = root || (typeof document !== 'undefined' ? document : null);
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    root.querySelectorAll('[data-i18n-ph]').forEach(function (el) {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
    });
    root.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });
    try {
      document.title = t('doc.title');
      document.documentElement.lang = t('html.lang');
    } catch (e) { /* ignore */ }
  }

  function setLang(lang, silent) {
    if (!DICT[lang]) return current;
    var changed = lang !== current;
    current = lang;
    try { if (typeof localStorage !== 'undefined') localStorage.setItem('enc.lang', lang); } catch (e) { /* ignore */ }
    apply();
    if (!silent) handlers.forEach(function (h) { try { h(lang, changed); } catch (e) { /* ignore */ } });
    return current;
  }

  function onApply(fn) { handlers.push(fn); return fn; }
  function getLang() { return current; }

  var API = { DICT: DICT, LANGS: LANGS, t: t, detect: detect, apply: apply, setLang: setLang, getLang: getLang, onApply: onApply };

  current = detect();
  if (typeof globalThis !== 'undefined') globalThis.ENC_I18N = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
