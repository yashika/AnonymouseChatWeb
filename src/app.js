/*!
 * ENC UI —— 连接 / 日志 / 发送 / 分享（中英双语）
 * ENC UI —— connect / log / send / share (bilingual)
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var logEl = $('log'), guidEl = $('guid'), msgEl = $('msg'), nickEl = $('nick'), pureEl = $('pure');
  var room = null;

  var I18N = (typeof window !== 'undefined' && window.ENC_I18N) ? window.ENC_I18N : null;
  function t(key, params) { return I18N ? I18N.t(key, params) : key; }

  if (!window.ENC) {
    logEl.innerHTML = '<div class="row lvl-err">' + t('log.coreMissing') + '</div>';
    return;
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function clock(ts) {
    var d = new Date(ts || Date.now());
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function ls(key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, val);
    } catch (e) { /* file:// 下可能不可用 / may be unavailable on file:// */ }
    return null;
  }

  // ------------------------------------------------------------ 日志区 / log area
  function trim() {
    while (logEl.childElementCount > 500) logEl.removeChild(logEl.firstElementChild);
  }
  function atBottom() { return logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 70; }
  function scrollDown(force) { if (force || atBottom()) logEl.scrollTop = logEl.scrollHeight; }

  function line(level, nodes, cls) {
    var stick = atBottom();
    var row = document.createElement('div');
    row.className = 'row ' + (cls || '') + (level ? ' lvl-' + level : '');
    var tspan = document.createElement('span');
    tspan.className = 't';
    tspan.textContent = clock();
    row.appendChild(tspan);
    (Array.isArray(nodes) ? nodes : [nodes]).forEach(function (n) {
      if (typeof n === 'string') row.appendChild(document.createTextNode(n));
      else if (n) row.appendChild(n);
    });
    logEl.appendChild(row);
    trim();
    scrollDown(stick);
    return row;
  }
  function sys(level, text) { return line(level, text); }

  function guidLine(level, prefix, guid) {
    var g = document.createElement('span');
    g.id = 'guidTag';
    g.textContent = guid;
    var b = document.createElement('button');
    b.className = 'ghost';
    b.setAttribute('data-i18n', 'btn.copyGuid');
    b.textContent = t('btn.copyGuid');
    b.style.marginLeft = '10px';
    b.style.padding = '2px 8px';
    b.style.fontSize = '11px';
    b.onclick = function () { copy(guid, b); };
    return line(level, [prefix, g, b]);
  }

  function chatLine(m) {
    var mine = room && m.from === room.id;
    var stick = atBottom();
    var row = document.createElement('div');
    row.className = 'row chat' + (mine ? ' me' : '');

    var tm = document.createElement('span');
    tm.className = 't';
    tm.textContent = clock(m.ts);
    var who = document.createElement('span');
    who.className = 'who';
    who.textContent = (mine ? t('chat.me') : (m.name || t('chat.anon'))) + '：';
    var tx = document.createElement('span');
    tx.className = 'tx';
    tx.textContent = m.text;

    row.appendChild(tm); row.appendChild(who); row.appendChild(tx);
    logEl.appendChild(row);
    trim();
    scrollDown(stick);
    return row;
  }

  // ------------------------------------------------------------ 状态 / status
  function setPill(state, text) {
    $('pill').className = state || '';
    $('pillText').textContent = text;
  }
  function refreshStatus(st) {
    if (!st) { setPill('', t('status.off')); return; }
    if (!st.connected) { setPill('wait', t('status.connecting', { n: st.online })); return; }
    var mode = t(st.pureP2P ? 'status.on.pure' : 'status.on.relay', { n: st.online });
    var p2p = st.useP2P ? t('status.p2p', { a: st.p2p, b: st.peers }) : '';
    setPill('on', mode + p2p);
  }

  function setShare(url) {
    var el = $('shareUrl');
    if (!url) {
      el.className = 'url off';
      el.textContent = t('share.none');
      $('btnCopy').disabled = true;
      return;
    }
    el.className = 'url';
    el.textContent = url;
    $('btnCopy').disabled = false;
  }

  function copy(text, btn) {
    var done = function () {
      if (!btn) return;
      var key = btn.getAttribute('data-i18n');
      var old = key ? t(key) : (btn.getAttribute('data-label') || btn.textContent);
      btn.setAttribute('data-label', old);
      btn.textContent = t('btn.copied');
      setTimeout(function () { btn.textContent = old; }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    } else fallback();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { sys('warn', t('log.copyFail')); }
      document.body.removeChild(ta);
    }
  }

  // ------------------------------------------------------------ 连接 / connect
  function extractGuid(v) {
    var m = String(v).match(/[?&]guid=([^&#\s]+)/i);
    if (m) { try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; } }
    return String(v).trim();
  }

  function wire(r) {
    r.on('log', function (l) { sys(l.level, l.text); });
    r.on('status', refreshStatus);
    r.on('peers', function () { refreshStatus(r.status()); });
    r.on('msg', function (m) { chatLine(m); });
    r.on('history', function (items) {
      sys('info', t('log.replay', { n: items.length, cap: ENC.HISTORY_CAP }));
      items.forEach(function (m) { chatLine(m); });
      refreshStatus(r.status());
    });
    r.on('nohistory', function () { sys('info', t('log.noHistory')); });
  }

  function doConnect() {
    var raw = guidEl.value.trim();
    var isNew = (raw === '');
    var guid = isNew ? ENC.newGuid() : extractGuid(raw);
    guidEl.value = guid;

    if (room) { try { room.stop(); } catch (e) { /* ignore */ } room = null; }

    var pure = pureEl.checked;
    var nick = (nickEl.value || '').trim() || (t('chat.user') + ENC.uid(4));
    nickEl.value = nick;
    ls('enc.nick', nick);
    ls('enc.broker', $('broker').value);

    sys('info', '────────────────────────────────────────────');
    sys('ok', isNew ? t('log.newRoom') : t('log.joinRoom', { guid: guid }));
    sys('info', t(pure ? 'log.modePure' : 'log.modeHybrid'));

    room = new ENC.Room({
      guid: guid,
      broker: $('broker').value,
      name: nick,
      pureP2P: pure
    });
    wire(room);

    var me = room;
    window.__encRoom = me;          // 便于调试/自动化检查 · debug & automation hook
    me.start();

    // 连上后打印成功信息 + GUID + 分享链接 / announce once connected
    var announced = false;
    var iv = setInterval(function () {
      if (announced || me !== room) { clearInterval(iv); return; }
      if (me.mqtt && me.mqtt.connected) {
        announced = true;
        clearInterval(iv);
        sys('ok', t(isNew ? 'log.created' : 'log.joined'));
        guidLine('ok', '', guid);
        var url = me.shareUrl(location.href);
        setShare(url);
        sys('info', t('log.shareIs'));
        line('info', url);
        sys('info', t('log.shareHelp'));
        if (location.protocol === 'file:') sys('warn', t('log.fileWarning'));
        $('msg').disabled = false;
        $('btnSend').disabled = false;
        $('btnStop').disabled = false;
        msgEl.focus();
        refreshStatus(me.status());
      }
    }, 150);
    setTimeout(function () { clearInterval(iv); }, 60000);

    setShare(null);
    $('msg').disabled = true;
    $('btnSend').disabled = true;
    $('btnStop').disabled = false;
  }

  function doStop(silent) {
    if (room) {
      try { room.stop(); } catch (e) { /* ignore */ }
      room = null;
      window.__encRoom = null;
      if (!silent) sys('warn', t('log.disconnected'));
    }
    setPill('', t('status.off'));
    setShare(null);
    $('msg').disabled = true;
    $('btnSend').disabled = true;
    $('btnStop').disabled = true;
  }

  function doSend() {
    if (!room) { sys('warn', t('log.needConnect')); return; }
    var text = msgEl.value;
    if (!text.trim()) { msgEl.focus(); return; }
    var res = room.send(text);
    if (res && res.ok) {
      msgEl.value = '';
      if (res.clipped) sys('warn', t('log.tooLong', { n: ENC.MAX_TEXT }));
    }
  }

  // ------------------------------------------------------------ 语言 / language
  function markLang(lang) {
    Array.prototype.forEach.call(document.querySelectorAll('#langSwitch button'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-lang') === lang);
    });
  }
  function switchLang(lang, announce) {
    if (!I18N) return;
    I18N.setLang(lang, true);
    markLang(lang);
    sys('info', t(lang === 'zh' ? 'log.langZh' : 'log.langEn'));
    if (room) {
      refreshStatus(room.status());
      if (!room.mqtt || !room.mqtt.connected) setShare(null);
      else setShare(room.shareUrl(location.href));
    } else {
      setPill('', t('status.off'));
      setShare(null);
    }
  }

  // ------------------------------------------------------------ 初始化 / init
  (function init() {
    if (I18N) I18N.apply();
    markLang(I18N ? I18N.getLang() : 'zh');

    ENC.BROKERS.forEach(function (b) {
      var o = document.createElement('option');
      o.value = b.url;
      o.textContent = I18N ? t('broker.' + b.id) : b.label;
      o.setAttribute('data-broker-id', b.id);
      $('broker').appendChild(o);
    });
    var savedBroker = ls('enc.broker');
    if (savedBroker && ENC.BROKERS.some(function (b) { return b.url === savedBroker; })) {
      $('broker').value = savedBroker;
    }
    nickEl.value = ls('enc.nick') || (t('chat.user') + ENC.uid(4));

    setShare(null);
    setPill('', t('status.off'));

    if (typeof RTCPeerConnection === 'undefined') sys('warn', t('log.noRTC'));

    sys('info', t('log.ready', { v: ENC.VERSION }));
    sys('info', t('log.tip1'));
    sys('info', t('log.tip2'));

    var q = new URLSearchParams(location.search).get('guid');
    if (q) {
      guidEl.value = q;
      sys('ok', t('log.autoJoin', { g: q }));
      setTimeout(doConnect, 200);
    }
  })();

  $('btnConnect').onclick = doConnect;
  $('btnStop').onclick = function () { doStop(false); };
  $('btnSend').onclick = doSend;
  $('btnClear').onclick = function () { logEl.innerHTML = ''; sys('info', t('log.cleared')); };
  $('btnCopy').onclick = function () { if (room) copy(room.shareUrl(location.href), $('btnCopy')); };
  pureEl.onchange = function () { sys(this.checked ? 'warn' : 'info', t(this.checked ? 'log.pureOn' : 'log.pureOff')); };
  guidEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') doConnect(); });
  msgEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') doSend(); });

  Array.prototype.forEach.call(document.querySelectorAll('#langSwitch button'), function (b) {
    b.onclick = function () { switchLang(b.getAttribute('data-lang')); };
  });
})();
