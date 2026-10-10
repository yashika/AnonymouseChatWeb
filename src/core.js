/*!
 * ENC core — 无服务器 P2P 聊天核心
 * ------------------------------------------------------------------
 * 只用公共基础设施，不需要你自己部署任何服务器：
 *   1) 公共 MQTT Broker (WSS)  —— 充当 WebRTC 信令交换 + 房间存在性广播
 *      + retained 消息 = 让后来者也能看到最近 100 条聊天记录
 *   2) WebRTC DataChannel (P2P 直连) —— 真正的点对点消息通道
 *
 * 本文件不依赖任何第三方库：内置了一个极简 MQTT 3.1.1 over WebSocket 客户端。
 * 浏览器与 Node 18+ 均可直接运行（Node 下自动跳过 WebRTC 部分）。
 */
(function () {
  'use strict';

  var te = new TextEncoder();
  var td = new TextDecoder();

  var TOPIC_ROOT = 'dsh/encnetchat/v1/r/';
  var HISTORY_CAP = 100;      // 最多保留/回放 100 条
  var MAX_TEXT = 4000;        // 单条文本上限
  var PRESENCE_MS = 8000;     // 心跳
  var PEER_TTL = 26000;       // 多久没心跳算离线
  var HIST_DEBOUNCE = 700;    // retained 历史发布节流

  var ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.nextcloud.com:443' }
  ];

  var BROKERS = [
    { id: 'emqx', label: 'EMQX public node', url: 'wss://broker.emqx.io:8084/mqtt' },
    { id: 'hivemq', label: 'HiveMQ public node', url: 'wss://broker.hivemq.com:8884/mqtt' },
    { id: 'mosquitto', label: 'Mosquitto test node', url: 'wss://test.mosquitto.org:8081/mqtt' }
  ];

  /** 取当前语言的文案；i18n.js 未加载时退化为 key 本身 */
  function T(key, params) {
    var i = (typeof globalThis !== 'undefined') ? globalThis.ENC_I18N : null;
    return i ? i.t(key, params) : key;
  }

  // ---------------------------------------------------------------- utils
  var HEX = '0123456789abcdef';
  function uid(n) {
    n = n || 16;
    var s = '';
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      var a = new Uint8Array(n);
      crypto.getRandomValues(a);
      for (var i = 0; i < n; i++) s += HEX[a[i] & 15];
      return s;
    }
    for (var j = 0; j < n; j++) s += HEX[Math.floor(Math.random() * 16)];
    return s;
  }

  /** 生成 RFC4122 v4 GUID */
  function newGuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = [];
    for (var k = 0; k < 16; k++) h.push((b[k] + 256).toString(16).slice(1));
    return h.slice(0, 4).join('') + '-' + h.slice(4, 6).join('') + '-' + h.slice(6, 8).join('') +
      '-' + h.slice(8, 10).join('') + '-' + h.slice(10, 16).join('');
  }

  /** MQTT 主题里不能出现 + # 和空字符 */
  function sanitizeTopic(s) {
    return String(s).replace(/[+#\u0000]/g, '-').replace(/^\/+|\/+$/g, '') || 'default';
  }

  function concat(a, b) {
    var out = new Uint8Array(a.length + b.length);
    out.set(a, 0); out.set(b, a.length);
    return out;
  }

  // ---------------------------------------------------------------- 极简 MQTT 3.1.1
  function encodeRemainingLength(n) {
    var out = [];
    do {
      var d = n % 128;
      n = Math.floor(n / 128);
      if (n > 0) d |= 0x80;
      out.push(d);
    } while (n > 0);
    return new Uint8Array(out);
  }

  function encodeString(str) {
    var b = te.encode(str);
    var h = new Uint8Array([(b.length >> 8) & 0xff, b.length & 0xff]);
    return concat(h, b);
  }

  function MqttClient(url, opts) {
    opts = opts || {};
    this.url = url;
    this.clientId = opts.clientId || ('enc_' + uid(14));
    this.keepalive = opts.keepalive || 45;
    this.handlers = {};
    this.subs = {};
    this.buf = new Uint8Array(0);
    this.pid = 1;
    this.connected = false;
    this.closedByUser = false;
    this.retries = 0;
    this.ws = null;
  }

  MqttClient.prototype.on = function (ev, fn) {
    (this.handlers[ev] = this.handlers[ev] || []).push(fn);
    return this;
  };
  MqttClient.prototype.emit = function (ev) {
    var args = Array.prototype.slice.call(arguments, 1);
    var list = this.handlers[ev] || [];
    for (var i = 0; i < list.length; i++) {
      try { list[i].apply(null, args); } catch (e) { if (typeof console !== 'undefined') console.error(e); }
    }
  };

  MqttClient.prototype.connect = function () {
    var self = this;
    this.closedByUser = false;
    var ws;
    try {
      ws = new WebSocket(this.url, ['mqtt']);
    } catch (e) {
      this.emit('error', new Error('Cannot open WebSocket: ' + e.message));
      this._retry();
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = function () {
      self.buf = new Uint8Array(0);
      self._send(self._connectPacket());
    };
    ws.onmessage = function (ev) {
      var d = ev.data, u8;
      if (d instanceof ArrayBuffer) u8 = new Uint8Array(d);
      else if (d && d.buffer) u8 = new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
      else if (typeof d === 'string') u8 = te.encode(d);
      else return;
      try { self._push(u8); } catch (e) { self.emit('error', e); }
    };
    ws.onerror = function () { self.emit('error', new Error('WebSocket error (' + self.url + ')')); };
    ws.onclose = function (ev) {
      self.connected = false;
      clearInterval(self.pingTimer); self.pingTimer = null;
      self.emit('close', ev);
      if (!self.closedByUser) self._retry();
    };
  };

  MqttClient.prototype._retry = function () {
    var self = this;
    if (this.closedByUser) return;
    if (this.retryTimer) return;
    var delay = Math.min(1000 * Math.pow(2, this.retries), 15000);
    this.retries++;
    this.emit('retry', delay);
    this.retryTimer = setTimeout(function () {
      self.retryTimer = null;
      if (!self.closedByUser) self.connect();
    }, delay);
  };

  MqttClient.prototype._send = function (u8) {
    if (this.ws && this.ws.readyState === 1) { this.ws.send(u8); return true; }
    return false;
  };

  MqttClient.prototype._connectPacket = function () {
    var vh = new Uint8Array([0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, 0x04, 0x02,
      (this.keepalive >> 8) & 0xff, this.keepalive & 0xff]);
    var payload = encodeString(this.clientId);
    var body = concat(vh, payload);
    return concat(concat(new Uint8Array([0x10]), encodeRemainingLength(body.length)), body);
  };

  MqttClient.prototype._push = function (chunk) {
    this.buf = concat(this.buf, chunk);
    for (;;) {
      var b = this.buf;
      if (b.length < 2) return;
      var type = b[0] >> 4, flags = b[0] & 0x0f;
      var mult = 1, len = 0, i = 1;
      for (;;) {
        if (i >= b.length) return;
        var d = b[i++];
        len += (d & 127) * mult;
        mult *= 128;
        if ((d & 128) === 0) break;
        if (mult > 2097152) { this.emit('error', new Error('Malformed MQTT remaining length')); return; }
      }
      var total = i + len;
      if (b.length < total) return;
      var payload = b.subarray(i, total);
      this.buf = b.subarray(total);
      this._handle(type, flags, payload);
    }
  };

  MqttClient.prototype._handle = function (type, flags, p) {
    if (type === 2) {                       // CONNACK
      var rc = p[1];
      if (rc === 0) {
        this.connected = true;
        this.retries = 0;
        var self = this;
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(function () { self._send(new Uint8Array([0xc0, 0x00])); },
          Math.max(5, this.keepalive / 2) * 1000);
        // 重新订阅（首次 & 断线重连都走这里）
        Object.keys(this.subs).forEach(function (t) { self._sub(t, self.subs[t]); });
        this.emit('connect');
      } else {
        this.emit('error', new Error('MQTT connection refused, returnCode=' + rc));
      }
      return;
    }
    if (type === 3) {                       // PUBLISH
      var qos = (flags >> 1) & 3;
      var tl = (p[0] << 8) | p[1];
      var topic = td.decode(p.subarray(2, 2 + tl));
      var off = 2 + tl, packetId = 0;
      if (qos > 0) { packetId = (p[off] << 8) | p[off + 1]; off += 2; }
      var body = p.subarray(off);
      if (qos === 1) {                      // 回 PUBACK
        this._send(new Uint8Array([0x40, 0x02, (packetId >> 8) & 0xff, packetId & 0xff]));
      }
      this.emit('message', topic, body, flags & 1);
      return;
    }
    if (type === 9) {                       // SUBACK
      var codes = [];
      for (var i = 2; i < p.length; i++) codes.push(p[i]);
      this.emit('suback', codes);
      return;
    }
  };

  MqttClient.prototype._sub = function (topic, qos) {
    qos = qos || 0;
    var id = this.pid = (this.pid % 60000) + 1;
    var body = concat(concat(new Uint8Array([(id >> 8) & 0xff, id & 0xff]),
      encodeString(topic)), new Uint8Array([qos]));
    return this._send(concat(concat(new Uint8Array([0x82]), encodeRemainingLength(body.length)), body));
  };

  /** 订阅（自动记忆，断线重连后恢复） */
  MqttClient.prototype.subscribe = function (topic, qos) {
    this.subs[topic] = qos || 0;
    if (this.connected) this._sub(topic, qos || 0);
    return this;
  };

  MqttClient.prototype.publish = function (topic, payloadStr, opts) {
    opts = opts || {};
    var qos = opts.qos || 0;
    var body = encodeString(topic);
    if (qos > 0) {
      var id = this.pid = (this.pid % 60000) + 1;
      body = concat(body, new Uint8Array([(id >> 8) & 0xff, id & 0xff]));
    }
    body = concat(body, te.encode(payloadStr));
    var header = new Uint8Array([0x30 | (qos << 1) | (opts.retain ? 1 : 0)]);
    return this._send(concat(concat(header, encodeRemainingLength(body.length)), body));
  };

  MqttClient.prototype.close = function () {
    this.closedByUser = true;
    clearInterval(this.pingTimer); this.pingTimer = null;
    clearTimeout(this.retryTimer); this.retryTimer = null;
    if (this.ws && this.ws.readyState === 1) {
      try { this._send(new Uint8Array([0xe0, 0x00])); } catch (e) { /* ignore */ }
      try { this.ws.close(); } catch (e2) { /* ignore */ }
    }
    this.connected = false;
  };

  // ---------------------------------------------------------------- Room
  function Room(opts) {
    opts = opts || {};
    this.guid = String(opts.guid || newGuid());
    this.broker = opts.broker || BROKERS[0].url;
    this.name = opts.name || (T('chat.user') + uid(4));
    this.id = opts.id || ('p-' + uid(10));
    this.pureP2P = !!opts.pureP2P;
    this.useP2P = (typeof RTCPeerConnection !== 'undefined');

    this.base = TOPIC_ROOT + sanitizeTopic(this.guid);
    this.messages = [];      // 最近 100 条
    this.seen = {};
    this.seenCount = 0;
    this.peers = {};         // id -> {id,name,last,p2p}
    this.pcs = {};           // id -> RTCPeerConnection
    this.dcs = {};           // id -> RTCDataChannel
    this.pendingIce = {};
    this.handlers = {};
    this.startedAt = 0;
    this.gotHistory = false;
  }

  Room.prototype.on = function (ev, fn) {
    (this.handlers[ev] = this.handlers[ev] || []).push(fn);
    return this;
  };
  Room.prototype.emit = function (ev) {
    var args = Array.prototype.slice.call(arguments, 1);
    var list = this.handlers[ev] || [];
    for (var i = 0; i < list.length; i++) {
      try { list[i].apply(null, args); } catch (e) { if (typeof console !== 'undefined') console.error(e); }
    }
  };
  Room.prototype.log = function (level, text) { this.emit('log', { level: level, text: text, ts: Date.now() }); };

  Room.prototype.shareUrl = function (href) {
    var u = String(href || (typeof location !== 'undefined' ? location.href : ''));
    return u.split('#')[0].split('?')[0] + '?guid=' + encodeURIComponent(this.guid);
  };

  Room.prototype.start = function () {
    var self = this;
    this.startedAt = Date.now();
    this.log('info', T('log.connecting', { url: this.broker }));

    var mqtt = new MqttClient(this.broker, { clientId: 'enc_' + this.id + '_' + uid(6) });
    this.mqtt = mqtt;

    mqtt.on('connect', function () {
      self.log('ok', T(self.pureP2P ? 'log.connected.pure' : 'log.connected.relay'));
      mqtt.subscribe(self.base + '/s');   // 信令
      mqtt.subscribe(self.base + '/p');   // 在线心跳
      if (!self.pureP2P) {
        mqtt.subscribe(self.base + '/m'); // 聊天消息
        mqtt.subscribe(self.base + '/h'); // retained 历史
      }
      self.publishPresence(false);
      clearInterval(self.presTimer);
      self.presTimer = setInterval(function () { self.tick(); }, 4000);
      self.emit('status', self.status());
    });

    mqtt.on('message', function (topic, payload) {
      var text = td.decode(payload);
      var suffix = topic.slice(self.base.length);
      if (suffix === '/m') {
        var m = safeJson(text);
        if (m) self.accept(m);
      } else if (suffix === '/h') {
        var h = safeJson(text);
        if (h && h.items) {
          self.gotHistory = true;
          var added = self.mergeHistory(h.items);
          if (!added && !self.historyReported) { self.historyReported = true; }
          // 我们手里有对方没有的消息 → 回写一次，保证最终一致
          var localNewer = self.messages.some(function (x) {
            return !h.items.some(function (y) { return y.id === x.id; });
          });
          if (localNewer) self.scheduleHistoryPublish();
        }
      } else if (suffix === '/s') {
        var s = safeJson(text);
        if (s && s.to === self.id && s.from !== self.id) self.handleSignal(s);
      } else if (suffix === '/p') {
        var p = safeJson(text);
        if (p) self.handlePresence(p);
      }
    });

    mqtt.on('close', function () {
      self.emit('status', self.status());
      if (!mqtt.closedByUser) self.log('warn', T('log.mqttClose'));
    });
    mqtt.on('error', function (e) { self.log('err', T('log.mqttError', { msg: e.message })); });
    mqtt.on('retry', function (d) { self.log('info', T('log.retryIn', { n: Math.round(d / 1000) })); });
    mqtt.on('suback', function () { self.emit('status', self.status()); });

    mqtt.connect();

    // 若 3 秒内没收到 retained 历史，说明这确实是新房间
    setTimeout(function () {
      if (!self.gotHistory && !self.pureP2P && self.mqtt && self.mqtt.connected) {
        self.gotHistory = true;
        self.emit('nohistory');
      }
    }, 3000);
    return this;
  };

  Room.prototype.tick = function () {
    if (!this.mqtt || !this.mqtt.connected) return;
    this.publishPresence(false);
    var now = Date.now(), changed = false;
    for (var id in this.peers) {
      if (now - this.peers[id].last > PEER_TTL) {
        self.log('info', T('log.peerOffline', { name: self.peers[id].name }));
        delete this.peers[id];
        this.dropPeer(id);
        changed = true;
      }
    }
    if (changed) this.emit('peers', this.peerList());
    this.emit('status', this.status());
  };

  Room.prototype.publishPresence = function (re) {
    if (!this.mqtt || !this.mqtt.connected) return;
    this.mqtt.publish(this.base + '/p', JSON.stringify({
      t: 'hi', id: this.id, name: this.name, re: !!re, ts: Date.now()
    }));
  };

  Room.prototype.handlePresence = function (p) {
    if (!p.id || p.id === this.id) return;
    if (p.t === 'bye') {
      if (this.peers[p.id]) {
        this.log('info', T('log.peerLeave', { name: this.peers[p.id].name }));
        delete this.peers[p.id];
        this.dropPeer(p.id);
        this.emit('peers', this.peerList());
      }
      return;
    }
    var fresh = !this.peers[p.id];
    this.peers[p.id] = { id: p.id, name: p.name || T('chat.anon'), last: Date.now(), p2p: !!this.dcOpen(p.id) };
    if (fresh) {
      this.log('info', T('log.peerJoin', { name: this.peers[p.id].name, id: p.id }));
      if (!p.re) this.publishPresence(true);
      this.emit('peers', this.peerList());
      if (this.useP2P) this.ensurePeer(p.id);
    }
  };

  Room.prototype.peerList = function () {
    var out = [];
    for (var id in this.peers) out.push({ id: id, name: this.peers[id].name, p2p: this.dcOpen(id) });
    return out;
  };

  Room.prototype.status = function () {
    var online = 0, p2p = 0;
    for (var id in this.peers) { online++; if (this.dcOpen(id)) p2p++; }
    var connected = !!(this.mqtt && this.mqtt.connected);
    return {
      guid: this.guid,
      connected: connected,
      pureP2P: this.pureP2P,
      useP2P: this.useP2P,
      online: connected ? online + 1 : 0,   // 含自己
      peers: online,
      p2p: p2p,
      total: this.messages.length
    };
  };

  Room.prototype.dcOpen = function (id) {
    var dc = this.dcs[id];
    return !!(dc && dc.readyState === 'open');
  };

  // ---------------------------------------------------------------- 消息
  Room.prototype.accept = function (m) {
    if (!m || !m.id || typeof m.text !== 'string') return false;
    if (this.seen[m.id]) return false;
    this.seen[m.id] = 1; this.seenCount++;
    var rec = {
      id: m.id, from: String(m.from || '?'), name: String(m.name || T('chat.anon')),
      ts: Number(m.ts) || Date.now(), text: m.text.slice(0, MAX_TEXT)
    };
    this.messages.push(rec);
    this.messages.sort(function (a, b) { return a.ts - b.ts; });
    if (this.messages.length > HISTORY_CAP) this.messages.splice(0, this.messages.length - HISTORY_CAP);
    if (this.seenCount > 4000) this.rebuildSeen();
    this.emit('msg', rec);
    return true;
  };

  Room.prototype.rebuildSeen = function () {
    this.seen = {}; this.seenCount = 0;
    for (var i = 0; i < this.messages.length; i++) { this.seen[this.messages[i].id] = 1; this.seenCount++; }
  };

  Room.prototype.mergeHistory = function (items) {
    if (!items || !items.length) return false;
    var fresh = [];
    for (var i = 0; i < items.length; i++) {
      var m = items[i];
      if (!m || !m.id || typeof m.text !== 'string' || this.seen[m.id]) continue;
      this.seen[m.id] = 1; this.seenCount++;
      var rec = {
        id: m.id, from: String(m.from || '?'), name: String(m.name || T('chat.anon')),
        ts: Number(m.ts) || Date.now(), text: m.text.slice(0, MAX_TEXT)
      };
      this.messages.push(rec); fresh.push(rec);
    }
    if (!fresh.length) return false;
    this.messages.sort(function (a, b) { return a.ts - b.ts; });
    if (this.messages.length > HISTORY_CAP) this.messages.splice(0, this.messages.length - HISTORY_CAP);
    fresh.sort(function (a, b) { return a.ts - b.ts; });
    this.emit('history', fresh);
    this.emit('status', this.status());
    return true;
  };

  Room.prototype.send = function (text) {
    text = String(text == null ? '' : text);
    if (!text.trim()) return { ok: false, reason: 'empty' };
    var clipped = false;
    if (text.length > MAX_TEXT) { text = text.slice(0, MAX_TEXT); clipped = true; }

    var msg = { id: uid(18) + Date.now().toString(36), from: this.id, name: this.name, ts: Date.now(), text: text };
    this.accept(msg);

    var relayed = false, p2p = 0;
    if (!this.pureP2P && this.mqtt && this.mqtt.connected) {
      this.mqtt.publish(this.base + '/m', JSON.stringify(msg));
      this.scheduleHistoryPublish();
      relayed = true;
    } else if (!this.pureP2P) {
      this.log('warn', T('log.notConnected'));
    }
    var payload = JSON.stringify({ t: 'm', m: msg });
    for (var id in this.dcs) {
      var dc = this.dcs[id];
      if (dc && dc.readyState === 'open') {
        try { dc.send(payload); p2p++; } catch (e) { /* ignore */ }
      }
    }
    if (this.pureP2P && p2p === 0) {
      this.log('warn', T('log.pureNoPeer'));
    }
    return { ok: true, relayed: relayed, p2p: p2p, clipped: clipped, id: msg.id };
  };

  Room.prototype.scheduleHistoryPublish = function () {
    if (this.pureP2P) return;
    var self = this;
    clearTimeout(this.histTimer);
    this.histTimer = setTimeout(function () { self.publishHistory(); }, HIST_DEBOUNCE);
  };

  Room.prototype.publishHistory = function () {
    if (this.pureP2P || !this.mqtt || !this.mqtt.connected) return;
    var items = this.messages.slice(-HISTORY_CAP);
    var payload = JSON.stringify({ v: 1, guid: this.guid, items: items });
    // 公共节点对单包大小有限制，超了就丢最旧的
    while (payload.length > 180000 && items.length > 1) {
      items = items.slice(Math.ceil(items.length / 10));
      payload = JSON.stringify({ v: 1, guid: this.guid, items: items });
    }
    this.mqtt.publish(this.base + '/h', payload, { retain: true });
  };

  // ---------------------------------------------------------------- WebRTC P2P
  Room.prototype.sendSignal = function (obj) {
    if (!this.mqtt || !this.mqtt.connected) return;
    obj.from = this.id;
    this.mqtt.publish(this.base + '/s', JSON.stringify(obj));
  };

  Room.prototype.ensurePeer = function (peerId) {
    var self = this;
    if (!this.useP2P) return null;
    if (this.pcs[peerId]) return this.pcs[peerId];
    var pc;
    try { pc = new RTCPeerConnection({ iceServers: ICE_SERVERS }); }
    catch (e) { this.log('warn', T('log.noWebRTC', { msg: e.message })); return null; }

    this.pcs[peerId] = pc;
    this.pendingIce[peerId] = [];

    pc.onicecandidate = function (e) {
      if (e.candidate) {
        self.sendSignal({ kind: 'ice', to: peerId, data: (e.candidate.toJSON ? e.candidate.toJSON() : e.candidate) });
      }
    };
    pc.onconnectionstatechange = function () {
      var st = pc.connectionState;
      if (st === 'failed' || st === 'closed') {
        self.log('warn', T('log.p2pDown', { state: st }));
        self.dropPeer(peerId);
      } else if (st === 'connected') {
        self.emit('peers', self.peerList());
      }
    };
    pc.ondatachannel = function (e) { self.attachDC(peerId, e.channel); };

    // 双方都会调用 ensurePeer，用 id 大小决定谁发 offer，避免双向 offer 打架
    if (this.id < peerId) {
      var dc = pc.createDataChannel('enc', { ordered: true });
      this.attachDC(peerId, dc);
      pc.createOffer()
        .then(function (offer) { return pc.setLocalDescription(offer); })
        .then(function () {
          self.sendSignal({ kind: 'offer', to: peerId, data: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
        })
        .catch(function (e) { self.log('warn', T('log.offerFail', { msg: e.message })); });
    }
    return pc;
  };

  Room.prototype.attachDC = function (peerId, dc) {
    var self = this;
    this.dcs[peerId] = dc;
    dc.onopen = function () {
      self.log('ok', T('log.p2pUp', { name: self.peers[peerId] ? self.peers[peerId].name : peerId }));
      if (self.pureP2P) {
        try { dc.send(JSON.stringify({ t: 'hreq' })); } catch (e) { /* ignore */ }
      }
      self.emit('peers', self.peerList());
      self.emit('status', self.status());
    };
    dc.onmessage = function (e) {
      var d = safeJson(e.data);
      if (!d) return;
      if (d.t === 'm') {
        if (self.accept(d.m) && !self.pureP2P) self.scheduleHistoryPublish();
      } else if (d.t === 'hreq') {
        try { dc.send(JSON.stringify({ t: 'hist', items: self.messages.slice(-HISTORY_CAP) })); } catch (err) { /* ignore */ }
      } else if (d.t === 'hist') {
        self.mergeHistory(d.items);
      }
    };
    dc.onclose = function () {
      if (self.dcs[peerId] === dc) delete self.dcs[peerId];
      self.emit('peers', self.peerList());
      self.emit('status', self.status());
    };
    dc.onerror = function () { /* 静默，走中继 */ };
  };

  Room.prototype.flushIce = function (peerId) {
    var self = this, pc = this.pcs[peerId], q = this.pendingIce[peerId] || [];
    this.pendingIce[peerId] = [];
    q.forEach(function (c) {
      try { pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) { /* ignore */ }
    });
  };

  Room.prototype.handleSignal = function (s) {
    var self = this;
    if (!this.useP2P) return;
    var pc;
    if (s.kind === 'offer') {
      pc = this.ensurePeer(s.from);
      if (!pc) return;
      pc.setRemoteDescription(new RTCSessionDescription(s.data))
        .then(function () { self.flushIce(s.from); return pc.createAnswer(); })
        .then(function (ans) { return pc.setLocalDescription(ans); })
        .then(function () {
          self.sendSignal({ kind: 'answer', to: s.from, data: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
        })
        .catch(function (e) { self.log('warn', T('log.handleOfferFail', { msg: e.message })); });
    } else if (s.kind === 'answer') {
      pc = this.pcs[s.from];
      if (!pc) return;
      if (pc.signalingState === 'have-local-offer') {
        pc.setRemoteDescription(new RTCSessionDescription(s.data))
          .then(function () { self.flushIce(s.from); })
          .catch(function (e) { self.log('warn', T('log.handleAnswerFail', { msg: e.message })); });
      }
    } else if (s.kind === 'ice') {
      pc = this.pcs[s.from];
      if (!pc) return;
      if (pc.remoteDescription && pc.remoteDescription.type) {
        try { pc.addIceCandidate(new RTCIceCandidate(s.data)); } catch (e) { /* ignore */ }
      } else {
        (this.pendingIce[s.from] = this.pendingIce[s.from] || []).push(s.data);
      }
    }
  };

  Room.prototype.dropPeer = function (id) {
    try { if (this.dcs[id]) this.dcs[id].close(); } catch (e) { /* ignore */ }
    try { if (this.pcs[id]) this.pcs[id].close(); } catch (e2) { /* ignore */ }
    delete this.dcs[id]; delete this.pcs[id]; delete this.pendingIce[id];
  };

  Room.prototype.stop = function () {
    clearInterval(this.presTimer);
    clearTimeout(this.histTimer);
    if (this.mqtt && this.mqtt.connected) {
      this.mqtt.publish(this.base + '/p', JSON.stringify({ t: 'bye', id: this.id, name: this.name }));
    }
    for (var id in this.pcs) this.dropPeer(id);
    if (this.mqtt) this.mqtt.close();
  };

  function safeJson(s) {
    try { return JSON.parse(s); } catch (e) { return null; }
  }

  // ---------------------------------------------------------------- export
  var ENC = {
    VERSION: VERSION_STR(),
    BROKERS: BROKERS,
    ICE_SERVERS: ICE_SERVERS,
    HISTORY_CAP: HISTORY_CAP,
    MAX_TEXT: MAX_TEXT,
    newGuid: newGuid,
    uid: uid,
    sanitizeTopic: sanitizeTopic,
    MqttClient: MqttClient,
    Room: Room
  };
  function VERSION_STR() { return '1.0.0'; }

  if (typeof globalThis !== 'undefined') globalThis.ENC = ENC;
  if (typeof module !== 'undefined' && module.exports) module.exports = ENC;
})();
