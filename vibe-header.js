/**
 * VibeHeader for Surge
 * ---------------------------------------------------------------------------
 * 作用：像 Chrome 的「VibeHeader」插件一样，在 Surge 里按「域名 / 路径」对 HTTP(S)
 *      请求头做 增加(add) / 覆盖(set) / 删除(del)，可选启用、可多规则共存。
 *
 * 类型：http-request（HTTPS 请求需要 Surge 对目标域名开启 MITM 才能被看到）
 *
 * 配置来源：BoxJs（本脚本直接读 $persistentStore，key 与 BoxJs 设置项 id 相同）
 *   vibe_header_enable   总开关                    "true" / "false"
 *   vibe_header_rules    规则（多行文本或 JSON）    见下方语法
 *   vibe_header_block    排除域名（不修改的域名）    逗号 / 空格 / 换行分隔
 *   vibe_header_log      调试日志 + 命中记录         "true" / "false"
 *
 * 自检页：浏览器打开 http://vibeheader.local/
 *   /            查看总开关、规则解析结果、语法错误、最近命中
 *   /reset       清空「最近命中」记录
 *
 * 看状态（不依赖浏览器，更可靠）：
 *   ① 模块里的 VibeHeaderStatus 行（type=generic）→ 在 Surge 的「脚本」列表长按运行 → 弹通知
 *   ② 浏览器访问任意明文 http 网址的 /vibeheader-status 路径 → 同样弹通知，请求照常放行
 *   ③ 作为 Surge 信息面板脚本时（$input.purpose === 'panel'）返回面板内容
 *
 * 自检模式：当模块脚本行带 argument=check（cron 触发）时，仅做配置校验，
 *          只在发现语法错误时发通知，成功时静默。
 *
 * 版本：1.1.0
 */

(function () {
  'use strict';

  var VERSION = '1.1.0';
  var LOCAL_HOST = 'vibeheader.local';
  var MAX_RECENT = 20;

  var K_ENABLE = 'vibe_header_enable';
  var K_RULES = 'vibe_header_rules';
  var K_BLOCK = 'vibe_header_block';
  var K_LOG = 'vibe_header_log';
  var K_RECENT = 'vibe_header_recent';

  /** 这些头一旦改动会破坏请求报文的完整性，一律拒绝修改 */
  var PROTECTED = [
    'host', 'content-length', 'content-encoding', 'transfer-encoding',
    'connection', 'proxy-connection', 'expect', 'upgrade', 'te', 'trailer', 'keep-alive'
  ];

  /** 动作别名：统一映射到 set / add / del */
  var OP_ALIAS = {
    set: 'set', add: 'add', del: 'del',
    '覆盖': 'set', '设置': 'set', '追加': 'add', '添加': 'add', '删除': 'del'
  };

  // ==========================================================================
  // 基础工具
  // ==========================================================================

  function raw(key) {
    try {
      var v = $persistentStore.read(key);
      if (v === null || v === undefined || v === '') return null;
      return String(v);
    } catch (e) {
      return null;
    }
  }

  function store(key, val) {
    try { $persistentStore.write(val, key); } catch (e) { /* ignore */ }
  }

  function flag(key, def) {
    var v = raw(key);
    if (v === null) return !!def;
    return /^(true|1|yes|on|开|是)$/.test(v.trim().toLowerCase());
  }

  function log() {
    try { console.log.apply(console, arguments); } catch (e) { /* ignore */ }
  }

  function notify(title, subtitle, body) {
    try { $notification.post(title, subtitle, body); } catch (e) { /* ignore */ }
  }

  function done(obj) {
    try { $done(obj || {}); } catch (e) { try { $done(); } catch (e2) { /* ignore */ } }
  }

  function escRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function escHtml(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function nowStr() {
    var d = new Date();
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  function stripQuotes(s) {
    var v = String(s === null || s === undefined ? '' : s).trim();
    if (v.length >= 2) {
      var a = v.charAt(0), b = v.charAt(v.length - 1);
      if ((a === '"' && b === '"') || (a === "'" && b === "'")) return v.slice(1, -1);
    }
    return v;
  }

  // ==========================================================================
  // URL 解析
  // ==========================================================================

  function parseUrl(url) {
    var s = String(url || '');
    var m = /^([a-z][a-z0-9+.\-]*):\/\/([^?#]*)/i.exec(s);
    var scheme = m ? m[1].toLowerCase() : 'http';
    var rest = m ? m[2] : s;

    var seg = rest.split('/');
    var authority = seg.shift() || '';
    var path = '/' + seg.join('/');
    authority = authority.replace(/^.*@/, ''); // 去掉 user:pass@

    var host = authority, port = '';
    if (authority.charAt(0) === '[') {            // IPv6 字面量
      var i = authority.indexOf(']');
      host = authority.slice(0, i + 1);
      port = authority.slice(i + 2);
    } else if (authority.indexOf(':') !== -1) {
      var parts = authority.split(':');
      port = parts.pop();
      host = parts.join(':');
    }

    return {
      scheme: scheme,
      host: host.toLowerCase(),
      port: port,
      path: path || '/'
    };
  }

  // ==========================================================================
  // 作用域（域名 / 路径）匹配器
  // ==========================================================================

  /**
   * 编译单个作用域 token，支持：
   *   *                    所有域名
   *   example.com          精确匹配该 host
   *   *.example.com        主域 + 全部子域
   *   ||example.com        同 *.example.com（AdGuard 风格）
   *   api-*.example.com    通配（* 匹配单段）
   *   re:^api\..*\.com$    正则
   *   example.com/api      域名 + 路径前缀（路径结尾可写 * ）
   */
  function compileToken(tok) {
    var t = String(tok === null || tok === undefined ? '' : tok).trim();
    if (!t) return null;
    if (t === '*') return { kind: 'all', raw: t, path: '' };

    if (/^re:/i.test(t)) {
      try {
        return { kind: 're', re: new RegExp(t.slice(3), 'i'), raw: t, path: '' };
      } catch (e) {
        return { kind: 'bad', raw: t, err: '正则无效：' + (e && e.message ? e.message : e) };
      }
    }

    var hostPart = t, path = '';
    var slash = t.indexOf('/');
    if (slash > 0) {
      hostPart = t.slice(0, slash);
      path = t.slice(slash);
      if (path.length > 1 && path.charAt(path.length - 1) === '*') path = path.slice(0, -1);
    }
    if (!hostPart) return null;

    var apex = false;
    if (hostPart.slice(0, 2) === '||') { hostPart = hostPart.slice(2); apex = true; }
    else if (hostPart.slice(0, 2) === '*.') { hostPart = hostPart.slice(2); apex = true; }

    if (!hostPart) return { kind: 'all', raw: t, path: path };

    if (hostPart.indexOf('*') !== -1) {
      var body = hostPart.toLowerCase().split('*').map(escRe).join('[^.]*');
      var re = new RegExp('^' + (apex ? '(?:[^.]+\\.)*' : '') + body + '$', 'i');
      return { kind: 'wild', re: re, raw: t, path: path };
    }

    if (apex) return { kind: 'suffix', v: hostPart.toLowerCase(), raw: t, path: path };
    return { kind: 'exact', v: hostPart.toLowerCase(), raw: t, path: path };
  }

  function matchHost(m, host) {
    switch (m.kind) {
      case 'all': return true;
      case 'exact': return host === m.v;
      case 'suffix':
        return host === m.v || (host.length > m.v.length && host.slice(-(m.v.length + 1)) === '.' + m.v);
      case 'wild':
      case 're':
        return m.re.test(host);
      default:
        return false;
    }
  }

  function matchPath(m, path) {
    return !m.path || String(path).indexOf(m.path) === 0;
  }

  function matchAny(mats, ctx) {
    for (var i = 0; i < mats.length; i++) {
      if (matchHost(mats[i], ctx.host) && matchPath(mats[i], ctx.path)) return true;
    }
    return false;
  }

  /** 解析「排除域名」文本框 */
  function parseList(text) {
    var out = [];
    if (!text) return out;
    var toks = String(text).split(/[\s,，]+/);
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i].trim();
      if (!t || t.charAt(0) === '#') continue;
      var c = compileToken(t);
      if (c && c.kind !== 'bad') out.push(c);
    }
    return out;
  }

  // ==========================================================================
  // 规则解析（多行文本 DSL，或 JSON 数组）
  // ==========================================================================

  function toOp(v) {
    var s = String(v === null || v === undefined ? '' : v).trim().toLowerCase();
    return OP_ALIAS[s] || null;
  }

  function pushRule(out, errors, label, o) {
    var tokens = [];
    if (o.scope instanceof Array) tokens = o.scope;
    else tokens = String(o.scope === null || o.scope === undefined ? '*' : o.scope).split(/[,\s]+/);

    var mats = [], bad = null;
    for (var i = 0; i < tokens.length; i++) {
      var tk = String(tokens[i]).trim();
      if (!tk) continue;
      var c = compileToken(tk);
      if (!c) continue;
      if (c.kind === 'bad') { bad = c.err; continue; }
      mats.push(c);
    }
    if (bad) errors.push(label + '：' + bad);
    if (!mats.length) { errors.push(label + '：作用域无效（' + o.scope + '）'); return; }

    out.push({ on: o.on, op: o.op, name: o.name, value: o.value, mats: mats, raw: o.raw });
  }

  function parseRules(text) {
    var rules = [], errors = [];
    var body = String(text === null || text === undefined ? '' : text).trim();
    if (!body) return { rules: rules, errors: errors };

    // ---- JSON 数组写法 ----
    if (body.charAt(0) === '[') {
      var arr = null;
      try {
        arr = JSON.parse(body);
      } catch (e) {
        errors.push('JSON 解析失败：' + (e && e.message ? e.message : e));
        return { rules: rules, errors: errors };
      }
      if (!(arr instanceof Array)) {
        errors.push('JSON 顶层必须是数组，形如 [{"scope":"*.a.com","op":"set","name":"X-A","value":"1"}]');
        return { rules: rules, errors: errors };
      }
      for (var i = 0; i < arr.length; i++) {
        var it = arr[i] || {};
        var label = 'JSON 第 ' + (i + 1) + ' 项';
        var nm = it.name || it.header || it.key;
        if (!nm) { errors.push(label + '：缺少 name'); continue; }
        var op = toOp(it.op || it.action || 'set');
        if (!op) { errors.push(label + '：op 只能是 set / add / del'); continue; }
        var on = !(it.disabled === true || it.enable === false || it.enabled === false || it.on === false);
        var val = it.value !== undefined ? it.value : it.val;
        pushRule(rules, errors, label, {
          on: on,
          op: op,
          name: String(nm).trim(),
          value: val === undefined || val === null ? '' : String(val),
          scope: it.scope || it.domains || it.domain || it.host || it.urls || '*',
          raw: JSON.stringify(it)
        });
      }
      return { rules: rules, errors: errors };
    }

    // ---- 多行文本 DSL：<作用域> <动作> <头名> <值> ----
    var lines = body.split(/\r?\n/);
    var re = /^(\S+)\s+(\S+)\s+([^\s=:]+)\s*(?:[:=]\s*)?([\s\S]*)$/;
    for (var j = 0; j < lines.length; j++) {
      var line = lines[j].trim();
      if (!line || line.charAt(0) === '#' || line.slice(0, 2) === '//') continue;

      var on2 = true;
      if (line.charAt(0) === '!') { on2 = false; line = line.slice(1).trim(); }

      var m = re.exec(line);
      if (!m) {
        errors.push('第 ' + (j + 1) + ' 行：格式应为「作用域 动作 头名 值」，当前：' + line);
        continue;
      }
      var op2 = toOp(m[2]);
      if (!op2) {
        errors.push('第 ' + (j + 1) + ' 行：动作「' + m[2] + '」不支持，只能是 set / add / del');
        continue;
      }
      pushRule(rules, errors, '第 ' + (j + 1) + ' 行', {
        on: on2,
        op: op2,
        name: m[3].trim(),
        value: stripQuotes(m[4]),
        scope: m[1],
        raw: line
      });
    }
    return { rules: rules, errors: errors };
  }

  // ==========================================================================
  // 应用规则
  // ==========================================================================

  /** HTTP 头名大小写不敏感：找到 headers 中真实存在的那个 key */
  function ciKey(headers, name) {
    var lower = name.toLowerCase();
    for (var k in headers) {
      if (Object.prototype.hasOwnProperty.call(headers, k) && String(k).toLowerCase() === lower) return k;
    }
    return null;
  }

  /** 支持 ${host} ${method} ${path} ${scheme} ${port} 变量 */
  function tmpl(v, ctx, method) {
    if (!v || v.indexOf('${') === -1) return v;
    return v.replace(/\$\{(host|method|path|scheme|port)\}/g, function (mm, k) {
      switch (k) {
        case 'host': return ctx.host;
        case 'method': return method;
        case 'path': return ctx.path;
        case 'scheme': return ctx.scheme;
        case 'port': return ctx.port;
        default: return mm;
      }
    });
  }

  function applyRules(rules, headers, ctx, method) {
    var hits = [], skipped = [];
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (!r.on) continue;
      if (!matchAny(r.mats, ctx)) continue;

      if (PROTECTED.indexOf(r.name.toLowerCase()) !== -1) {
        skipped.push(r.name);
        continue;
      }

      var exist = ciKey(headers, r.name);
      var value = tmpl(r.value, ctx, method);

      if (r.op === 'del') {
        if (exist === null) continue;
        delete headers[exist];
        hits.push({ name: exist, op: 'del', value: '' });
      } else if (r.op === 'add') {
        if (exist !== null) continue;          // 已存在则不覆盖
        headers[r.name] = value;
        hits.push({ name: r.name, op: 'add', value: value });
      } else {
        var key = exist === null ? r.name : exist;   // 复用原有大小写，避免出现重复头
        if (String(headers[key]) === value) continue;
        headers[key] = value;
        hits.push({ name: key, op: 'set', value: value });
      }
    }
    return { hits: hits, skipped: skipped };
  }

  function record(hits, ctx, method) {
    var arr = readRecent();
    for (var i = 0; i < hits.length; i++) {
      arr.push({
        t: nowStr(), m: method, h: ctx.host, p: ctx.path,
        n: hits[i].name, o: hits[i].op, v: String(hits[i].value).slice(0, 60)
      });
    }
    while (arr.length > MAX_RECENT) arr.shift();
    store(K_RECENT, JSON.stringify(arr));
  }

  function readRecent() {
    var v = raw(K_RECENT);
    if (!v) return [];
    try {
      var arr = JSON.parse(v);
      return arr instanceof Array ? arr : [];
    } catch (e) {
      return [];
    }
  }

  // ==========================================================================
  // 状态输出（不依赖浏览器的出口）
  //   出口一：Surge「脚本」列表里长按本脚本手动运行（模块里那条 argument=status 的 generic 行）
  //   出口二：浏览器访问任意明文 http 网址的 /vibeheader-status 路径（请求本身照常放行）
  //   出口三（可选）：作为 Surge 信息面板的脚本（$input.purpose === 'panel'）
  //   三者都调用 reportStatus()：发一条通知 + 返回面板对象
  // ==========================================================================

  function statusText() {
    var enable = flag(K_ENABLE, true);
    var debug = flag(K_LOG, false);
    var rulesText = raw(K_RULES) || '';
    var cfg = parseRules(rulesText);
    var blocks = parseList(raw(K_BLOCK));
    var recent = readRecent();
    var onCount = 0;
    for (var i = 0; i < cfg.rules.length; i++) if (cfg.rules[i].on) onCount++;

    var lines = [];
    lines.push('总开关：' + (enable ? '开' : '关'));
    lines.push('规则：' + cfg.rules.length + ' 条解析成功（其中启用 ' + onCount + ' 条）');
    lines.push('排除域名：' + blocks.length + ' 个');
    lines.push('调试日志：' + (debug ? '开' : '关'));

    if (cfg.errors.length) {
      lines.push('');
      lines.push('⚠️ 语法问题 ' + cfg.errors.length + ' 处：');
      for (var e = 0; e < cfg.errors.length && e < 5; e++) lines.push('· ' + cfg.errors[e]);
    }
    if (!rulesText) { lines.push(''); lines.push('⚠️ 规则为空，请到 BoxJs 配置'); }
    if (blocks.length) { lines.push(''); lines.push('排除：' + blocks.map(function (b) { return b.raw; }).join(', ')); }

    lines.push('');
    lines.push('最近命中（' + recent.length + ' 条）：');
    if (!recent.length) {
      lines.push(debug ? '（暂无，去触发一次目标请求）' : '（需先打开调试日志才会记录）');
    } else {
      var tail = recent.slice(-5).reverse();
      for (var k = 0; k < tail.length; k++) {
        var it = tail[k] || {};
        lines.push(it.t + ' ' + it.m + ' ' + (it.h || '') + (it.p || '') + ' → ' + it.o + ' ' + it.n + (it.v ? '=' + it.v : ''));
      }
    }
    return lines.join('\n');
  }

  /**
   * asPanel=true 时同时返回面板对象（$done({title,content,style})）；
   * 手动运行 generic 脚本 / 万能路径触发时只发通知，并让请求照常放行。
   */
  function reportStatus(asPanel) {
    var t = statusText();
    log('[VibeHeader] 状态\n' + t);
    notify('VibeHeader 状态', '', t);
    if (asPanel) {
      var hasErr = /⚠️/.test(t);
      return done({ title: 'VibeHeader', content: t, style: hasErr ? 'alert' : 'info' });
    }
    return done({});
  }

  // ==========================================================================
  // 请求处理主流程
  // ==========================================================================

  function handleRequest() {
    var req = (typeof $request !== 'undefined' && $request) ? $request : {};
    var headers = req.headers || {};
    var method = String(req.method || 'GET').toUpperCase();
    var ctx = parseUrl(req.url || '');

    // 自检页
    if (ctx.host === LOCAL_HOST) return renderPage(ctx);

    // 万能触发：任意明文 http 网址的 /vibeheader-status 路径 → 弹通知报状态，请求照常放行
    if (/\/vibeheader-status\/?$/i.test(ctx.path)) return reportStatus(false);

    var debug = flag(K_LOG, false);

    if (!flag(K_ENABLE, true)) {
      if (debug) log('[VibeHeader] 总开关关闭，跳过');
      return done({});
    }

    var rulesText = raw(K_RULES);
    if (!rulesText) {
      if (debug) log('[VibeHeader] 规则为空，请到 BoxJs 配置');
      return done({});
    }

    var cfg = parseRules(rulesText);
    if (!cfg.rules.length) {
      if (debug) log('[VibeHeader] 没有可用的规则' + (cfg.errors.length ? '（' + cfg.errors.length + ' 个语法错误，打开 http://' + LOCAL_HOST + '/ 查看）' : ''));
      return done({});
    }

    var blocks = parseList(raw(K_BLOCK));
    if (blocks.length && matchAny(blocks, ctx)) {
      if (debug) log('[VibeHeader] 命中排除域名，跳过：' + ctx.host);
      return done({});
    }

    var res = applyRules(cfg.rules, headers, ctx, method);

    if (!res.hits.length) {
      if (debug && res.skipped.length) {
        log('[VibeHeader] 已跳过受保护的头：' + res.skipped.join(', '));
      }
      return done({});
    }

    if (debug) {
      var desc = res.hits.map(function (h) {
        return h.op + ' ' + h.name + (h.value ? '=' + h.value : '');
      }).join(' & ');
      log('[VibeHeader] ' + method + ' ' + ctx.host + ctx.path + ' → ' + desc);
      record(res.hits, ctx, method);
    }

    if (res.skipped.length) {
      log('[VibeHeader] 跳过受保护的头：' + res.skipped.join(', '));
    }

    return done({ headers: headers });
  }

  // ==========================================================================
  // 自检页 http://vibeheader.local/
  // ==========================================================================

  function renderPage(ctx) {
    if (ctx.path.indexOf('/reset') === 0) store(K_RECENT, '');

    var enable = flag(K_ENABLE, true);
    var debug = flag(K_LOG, false);
    var rulesText = raw(K_RULES) || '';
    var cfg = parseRules(rulesText);
    var blocks = parseList(raw(K_BLOCK));
    var recent = readRecent();

    var h = [];
    h.push('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">');
    h.push('<meta name="viewport" content="width=device-width,initial-scale=1">');
    h.push('<title>VibeHeader</title><style>');
    h.push(':root{color-scheme:light dark}');
    h.push('body{font:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;margin:0;padding:18px;line-height:1.7;background:#f5f6f8;color:#16181d}');
    h.push('@media(prefers-color-scheme:dark){body{background:#14161a;color:#e6e8eb}}');
    h.push('h1{font-size:17px;margin:0 0 2px}h2{font-size:14px;margin:22px 0 6px;color:#5b6472}');
    h.push('@media(prefers-color-scheme:dark){h2{color:#98a2b3}}');
    h.push('.m{color:#8a919e;font-size:12px;margin-bottom:14px}');
    h.push('.kv{font-size:13px;margin:2px 0}.kv b{font-weight:600}');
    h.push('table{width:100%;border-collapse:collapse;font-size:13px;margin:6px 0 4px}');
    h.push('th,td{text-align:left;padding:6px 7px;border-bottom:1px solid rgba(128,128,128,.22);vertical-align:top;word-break:break-all}');
    h.push('th{color:#8a919e;font-weight:500;font-size:12px}');
    h.push('code{font-family:ui-monospace,Menlo,monospace;font-size:12px;background:rgba(128,128,128,.16);padding:1px 4px;border-radius:4px}');
    h.push('.on{color:#12803c;font-weight:600}.off{color:#9aa1ad}.bad{color:#c8271c}');
    h.push('@media(prefers-color-scheme:dark){.on{color:#4ed17b}.bad{color:#ff7b72}}');
    h.push('.empty{color:#8a919e;font-size:13px}');
    h.push('a{color:#2f7ff0;text-decoration:none}');
    h.push('.tip{font-size:12px;color:#8a919e;border-left:3px solid rgba(128,128,128,.35);padding-left:10px;margin:12px 0}');
    h.push('</style></head><body>');

    h.push('<h1>VibeHeader</h1>');
    h.push('<div class="m">Surge 请求头管理器 · v' + VERSION + ' · ' + escHtml(nowStr()) + '</div>');

    h.push('<div class="kv">总开关：<b class="' + (enable ? 'on' : 'off') + '">' + (enable ? '已开启' : '已关闭') + '</b></div>');
    h.push('<div class="kv">调试日志 / 命中记录：<b class="' + (debug ? 'on' : 'off') + '">' + (debug ? '已开启' : '已关闭') + '</b></div>');
    h.push('<div class="kv">排除域名：<b>' + (blocks.length ? escHtml(blocks.map(function (b) { return b.raw; }).join(', ')) : '（无）') + '</b></div>');

    // 规则表
    h.push('<h2>规则（' + cfg.rules.length + ' 条可用）</h2>');
    if (!cfg.rules.length) {
      h.push('<div class="empty">还没有配置规则。到 BoxJs → VibeHeader → 规则 里填写。</div>');
    } else {
      h.push('<table><tr><th>状态</th><th>作用域</th><th>动作</th><th>头名</th><th>值</th></tr>');
      for (var i = 0; i < cfg.rules.length; i++) {
        var r = cfg.rules[i];
        h.push('<tr>' +
          '<td class="' + (r.on ? 'on' : 'off') + '">' + (r.on ? '启用' : '禁用') + '</td>' +
          '<td>' + escHtml(r.mats.map(function (m) { return m.raw; }).join('<br>')) + '</td>' +
          '<td>' + escHtml(r.op) + '</td>' +
          '<td>' + escHtml(r.name) + '</td>' +
          '<td>' + escHtml(r.value || '—') + '</td>' +
          '</tr>');
      }
      h.push('</table>');
    }

    if (cfg.errors.length) {
      h.push('<h2>语法问题（' + cfg.errors.length + '）</h2><table><tr><th>说明</th></tr>');
      for (var e = 0; e < cfg.errors.length; e++) {
        h.push('<tr><td class="bad">' + escHtml(cfg.errors[e]) + '</td></tr>');
      }
      h.push('</table>');
    }

    // 最近命中
    h.push('<h2>最近命中' + (recent.length ? '（' + recent.length + ' 条）' : '') + '</h2>');
    if (!recent.length) {
      h.push('<div class="empty">暂无记录。' + (debug ? '去触发一次目标 App 的请求再回来刷新。' : '到 BoxJs 打开「调试日志」后才会记录。') + '</div>');
    } else {
      h.push('<table><tr><th>时间</th><th>方法</th><th>主机</th><th>路径</th><th>动作</th><th>头名</th><th>值</th></tr>');
      for (var k = recent.length - 1; k >= 0; k--) {
        var it = recent[k] || {};
        h.push('<tr>' +
          '<td>' + escHtml(it.t) + '</td>' +
          '<td>' + escHtml(it.m) + '</td>' +
          '<td>' + escHtml(it.h) + '</td>' +
          '<td>' + escHtml(it.p) + '</td>' +
          '<td>' + escHtml(it.o) + '</td>' +
          '<td>' + escHtml(it.n) + '</td>' +
          '<td>' + escHtml(it.v || '—') + '</td>' +
          '</tr>');
      }
      h.push('</table>');
      h.push('<div class="m"><a href="http://' + LOCAL_HOST + '/reset">清空命中记录</a></div>');
    }

    h.push('<h2>排查提示</h2>');
    h.push('<div class="tip">1. <b>HTTPS 必须 MITM</b>：只有加入 Surge MITM hostname 列表的域名，脚本才能看到其请求；明文 http 不需要。<br>' +
      '2. <b>一个请求只会运行一个 http-request 脚本</b>：本模块 pattern 为全局时，会抢占 Cookie 抓取类脚本，建议把 pattern 收窄到目标域名。<br>' +
      '3. 规则改了立刻生效，不需要重启 Surge；但 <b>已在连接中的会话</b>不受影响。<br>' +
      '4. 头部如 Host / Content-Length 等属于受保护头，规则不会生效。</div>');

    h.push('</body></html>');

    var html = h.join('');
    return done({
      response: {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
        // body 是 Surge 文档定义的字段；额外带一份 data 作为兼容兜底
        // （有反馈「浏览器拿到 200 但页面全白」，怀疑某些版本不认 body 字段）
        body: html,
        data: html
      }
    });
  }

  // ==========================================================================
  // 自检模式（模块脚本行 argument=check，cron 触发）
  // ==========================================================================

  function selfCheck() {
    var rulesText = raw(K_RULES) || '';
    var cfg = parseRules(rulesText);
    var blocks = parseList(raw(K_BLOCK));
    var problems = [];

    if (!rulesText) problems.push('规则为空，请到 BoxJs 填写');
    problems = problems.concat(cfg.errors);
    if (rulesText && !cfg.rules.length && !cfg.errors.length) problems.push('没有解析出任何可用规则');

    if (problems.length) {
      log('[VibeHeader] 自检未通过：\n' + problems.join('\n'));
      notify('VibeHeader 配置有问题', problems.length + ' 个问题', problems.slice(0, 6).join('\n'));
    } else {
      log('[VibeHeader] 自检通过：规则 ' + cfg.rules.length + ' 条（启用 ' + cfg.rules.filter(function (r) { return r.on; }).length + ' 条）' +
        '，排除域名 ' + blocks.length + ' 条，总开关 ' + (flag(K_ENABLE, true) ? '开' : '关'));
    }
    return done({});
  }

  // ==========================================================================
  // 入口
  // ==========================================================================

  try {
    var ARG = (typeof $argument !== 'undefined' && $argument !== null) ? String($argument) : '';
    var IS_PANEL = (typeof $input !== 'undefined' && $input && $input.purpose === 'panel');
    if (IS_PANEL || /\bstatus\b/i.test(ARG)) reportStatus(IS_PANEL);
    else if (/\bcheck\b/i.test(ARG)) selfCheck();
    else handleRequest();
  } catch (e) {
    log('[VibeHeader] 运行异常：' + (e && e.stack ? e.stack : e));
    done({});
  }
})();
