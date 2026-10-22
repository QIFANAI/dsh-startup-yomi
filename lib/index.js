/* ============================================================================
 * dsh-startup-yomi — Host 半侧（黄泉启动序列）
 * ----------------------------------------------------------------------------
 * 做三件事：
 *   1) 在 index.html 首屏注入全屏启动层：兜底 CSS + #dsh-yomi-root + 配置 + 兜底 JS
 *   2) 提供 /dsh-yomi/splash.css · splash.js · config · asset/:name 四组路由
 *   3) 把配置持久化到 ~/.dsh/dsh-startup-yomi.json（设置页经 HTTP 读写）
 *
 * 设计规格见 yomi/SPEC.md。与旧插件只共享「宿主注入机制」，视觉、文案、
 * 配置字段全部独立；不采集 profile / 模型 / 插件数之类的宿主事实。
 *
 * 降级纪律：静态文件读不到返回空串，素材/配置读不到返回 404 或 DEFAULTS，
 * 任何一条路径都不许向宿主抛异常；日志一律走 ctx.logger?.warn?.。
 * ========================================================================== */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const CONFIG_FILE = path.join(DSH_HOME, 'dsh-startup-yomi.json')

const NS = 'dsh-startup-yomi'
const ROUTE_BASE = '/dsh-yomi'

/** 插件版本：读自己的 package.json，避免源码与版本号两处各写一份。
    读不到就退回占位符（设置页会显示它，不会显示 undefined）。 */
const PLUGIN_VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    const v = String(pkg.version || '').trim()
    return v || '0.0.0'
  } catch (err) {
    return '0.0.0'
  }
})()

/** 默认配置：字段与取值必须与 yomi/SPEC.md §3 完全一致，
    同时与 lib/splash.js 的 DEFAULTS、lib/client.js 的 FALLBACK 保持一致。 */
const DEFAULTS = {
  enabled: true,
  mode: 'session',             // session | always | daily
  speed: 1,                    // 0.6 – 2.0
  interaction: 'full',         // full | quick | off
  allowSkip: true,
  identity: 'OPERATOR',        // 显示名，最多 24 字
  rank: '雷鸣的残响',           // 称号，最多 24 字
  fragments: '雷声之前|她曾在此|名字已归还', // 三段残响文案，| 分隔，最多 3 段
  colorA: '#ff2d55',           // 主色：电光红
  colorB: '#7a5cff',           // 副色：残响紫
  video: true,                 // 有 hero.mp4 才用视频，素材缺失由浏览器半侧回落程序化背景
  bgm: true,
  bgmVolume: 0.35,
  sfx: true,
  sfxVolume: 0.6,
  scanlines: true,
  reducedMotion: false,        // 关视差 / 色散 / 抖动
  glitch: 0.6                  // 0 – 1，揭幕故障强度
}

const BOOL_KEYS = ['enabled', 'allowSkip', 'video', 'bgm', 'sfx', 'scanlines', 'reducedMotion']
const COLOR_KEYS = ['colorA', 'colorB']
const ENUMS = {
  mode: ['session', 'always', 'daily'],
  interaction: ['full', 'quick', 'off']
}
/** 数值字段的合法区间（越界夹取，非法值回落默认）。 */
const RANGES = {
  speed: [0.6, 2],
  bgmVolume: [0, 1],
  sfxVolume: [0, 1],
  glitch: [0, 1]
}
/** 文本字段长度上限（单位：字符）。 */
const TEXT_LIMITS = {
  identity: 24,
  rank: 24
}
/** 颜色只接受 #rgb / #rrggbb / #rrggbbaa，拒绝 javascript: 之类的东西。 */
const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

/**
 * 三段残响文案：按 | 分段，去空白、丢空段、最多 3 段，单段最多 24 字。
 * 全空时回落到默认三段，保证浏览器半侧读到的永远是可用文案。
 */
function normalizeFragments(value) {
  try {
    const parts = String(value == null ? '' : value)
      .split('|')
      .map((s) => s.trim().slice(0, 24))
      .filter((s) => s.length > 0)
      .slice(0, 3)
    return parts.length ? parts.join('|') : DEFAULTS.fragments
  } catch (err) {
    return DEFAULTS.fragments
  }
}

/** 配置白名单归一化：只认 DEFAULTS 里的字段，逐字段校验/夹取。 */
function normalize(input) {
  const out = { ...DEFAULTS }
  const src = input && typeof input === 'object' ? input : {}
  for (const key of Object.keys(DEFAULTS)) {
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue
    const value = src[key]
    if (value === undefined || value === null) continue
    if (BOOL_KEYS.includes(key)) {
      out[key] = value === true || value === 'true' || value === 1 || value === '1'
    } else if (ENUMS[key]) {
      out[key] = ENUMS[key].includes(value) ? value : DEFAULTS[key]
    } else if (RANGES[key]) {
      const [lo, hi] = RANGES[key]
      const n = Number(value)
      out[key] = Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : DEFAULTS[key]
    } else if (COLOR_KEYS.includes(key)) {
      const s = String(value).trim()
      out[key] = COLOR_RE.test(s) ? s : DEFAULTS[key]
    } else if (TEXT_LIMITS[key] !== undefined) {
      out[key] = String(value).trim().slice(0, TEXT_LIMITS[key]) || DEFAULTS[key]
    } else if (key === 'fragments') {
      out[key] = normalizeFragments(value)
    }
  }
  return out
}

/** 读配置：文件缺失、JSON 坏了、权限不够，一律回落 DEFAULTS，不抛。 */
function readConfig() {
  try {
    return normalize(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')))
  } catch (err) {
    return { ...DEFAULTS }
  }
}

/** 原子写：先写 .tmp 再 rename，避免写一半被读到。 */
function writeConfig(next) {
  const cfg = normalize(next)
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
  const tmp = CONFIG_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8')
  fs.renameSync(tmp, CONFIG_FILE)
  return cfg
}

/** 静态文件按 mtime + size 缓存；改完插件刷新页面即生效。读不到返回空串。 */
function makeReader(rel) {
  let cache = null
  return function read() {
    const file = path.join(PACKAGE_ROOT, rel)
    try {
      const st = fs.statSync(file)
      if (!cache || cache.mtimeMs !== st.mtimeMs || cache.size !== st.size) {
        cache = { mtimeMs: st.mtimeMs, size: st.size, text: fs.readFileSync(file, 'utf8') }
      }
      return cache.text
    } catch (err) {
      cache = null
      return ''
    }
  }
}

const readSplashCss = makeReader('lib/splash.css')
const readSplashJs = makeReader('lib/splash.js')
const readPreviewHtml = makeReader('preview/index.html')

/** 内联脚本里绝对不能出现 `</script>`。 */
function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/** 首屏兜底：应用挂载前先把窗口盖住，避免闪出界面本体。
    #dsh-yomi-root 的尺寸/层级按 SPEC §4.2 写死，别让样式表加载慢时漏白。 */
const CRITICAL_CSS = [
  'html.yomi-lock,html.yomi-lock body{overflow:hidden!important}',
  '#dsh-yomi-root{position:fixed;inset:0;z-index:2147483000;background:#000}'
].join('')

/** 兜底脚本（内联执行，先于 splash.js）：
 *    - enabled=false，或 session/daily 已播过 → 直接摘掉根节点，不锁屏；
 *    - 否则加锁，并挂 8 秒看门狗：splash.js 404 / 语法错 / 被拦时无条件放行。
 *  绝不锁黑屏是本插件的硬约束。 */
const BOOTSTRAP_JS = `(function(){try{
var c=window.__DSH_YOMI__||{};
var root=document.getElementById('dsh-yomi-root');
function seen(bag,key,val){try{var s=window[bag];return !!s&&s.getItem(key)===val}catch(e){return false}}
var off=!c.enabled;
if(!off&&c.mode==='session'&&seen('sessionStorage','dsh-startup-yomi:shown','1'))off=true;
if(!off&&c.mode==='daily'&&seen('localStorage','dsh-startup-yomi:day',new Date().toISOString().slice(0,10)))off=true;
if(off){window.__DSH_YOMI_SKIP__=true;if(root&&root.parentNode)root.parentNode.removeChild(root);}
else{
document.documentElement.classList.add('yomi-lock');
setTimeout(function(){try{
var r=document.getElementById('dsh-yomi-root');
if(r&&r.className&&r.className.indexOf('yomi-boot')!==-1){
if(r.parentNode)r.parentNode.removeChild(r);
document.documentElement.classList.remove('yomi-lock');
if(document.body)document.body.style.overflow='';
window.__DSH_YOMI_FAILED__=true;
}
}catch(e){}},8000);
}
}catch(e){} })()`

/** 素材白名单：只允许扁平文件名，杜绝目录穿越与任意读盘。 */
const ASSET_TYPES = {
  'hero-loop.mp4': 'video/mp4',
  'hero-loop.webm': 'video/webm',
  'hero.mp4': 'video/mp4',
  'hero.webm': 'video/webm',
  'hero-poster.jpg': 'image/jpeg',
  'bgm.mp3': 'audio/mpeg',
  'voice-echo.mp3': 'audio/mpeg',
  'voice-reveal.mp3': 'audio/mpeg',
  'font-brush.woff2': 'font/woff2',
  'sfx-charge.mp3': 'audio/mpeg'
}

/**
 * 解析单段 Range 头。返回：
 *   null            → 没有 Range 或格式不认识（按整份下发处理）
 *   {invalid:true}  → 语法合法但区间不可满足（回 416）
 *   {start,end}     → 可满足的闭区间
 */
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim())
  if (!m) return null
  if (m[1] === '' && m[2] === '') return { invalid: true }
  if (!Number.isFinite(size) || size <= 0) return { invalid: true }
  let start
  let end
  if (m[1] === '') {
    // bytes=-N：最后 N 个字节
    const n = Number(m[2])
    if (!Number.isFinite(n) || n <= 0) return { invalid: true }
    start = Math.max(0, size - n)
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] === '' ? size - 1 : Number(m[2])
    if (end > size - 1) end = size - 1
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= size) {
    return { invalid: true }
  }
  return { start, end }
}

/** 只读区间：视频拖动进度条时不必把整份文件读进内存。 */
function readAssetSlice(file, start, end) {
  const length = end - start + 1
  const buf = Buffer.alloc(length)
  const fd = fs.openSync(file, 'r')
  try {
    let offset = 0
    while (offset < length) {
      const n = fs.readSync(fd, buf, offset, length - offset, start + offset)
      if (n <= 0) break
      offset += n
    }
    return offset === length ? buf : buf.subarray(0, offset)
  } finally {
    try { fs.closeSync(fd) } catch (err) { /* close 失败不影响响应 */ }
  }
}

const name = NS
const inject = ['webServer', 'connection']

/**
 * 取得 HTTP 载体服务。
 *
 * web profile 与桌面端都会挂 `@deepseek-ai/dsh-web-app`，其中 `webserver`
 * 这一行提供 webServer；桌面端也可能改用 file:// + IPC 下发前端，那种情况下
 * 没有 webServer，本插件不该把一颗 fiber 炸掉，安静跳过即可。
 */
function resolveWebServer(ctx) {
  try {
    const viaGet = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
    if (viaGet) return viaGet
  } catch (err) { /* 取不到就当没有 */ }
  return ctx.webServer
}

function hasRoutes(server) {
  return !!server && typeof server.register === 'function' && typeof server.tapIndex === 'function'
}

function apply(ctx) {
  const disposers = []
  const warned = new Set()

  /** 日志失败不许影响插件；同样的告警只打一次，避免每个请求刷屏。 */
  function warnOnce(key, message) {
    if (warned.has(key)) return
    warned.add(key)
    try { ctx.logger?.warn?.('[' + NS + '] ' + message) } catch (err) { /* noop */ }
  }

  const webServer = resolveWebServer(ctx)

  if (!hasRoutes(webServer)) {
    warnOnce('no-webserver',
      '当前 profile 没有可用的 webServer（桌面端可能用 file:// + IPC 下发前端）；' +
      'Host 半侧跳过路由与首屏注入。')
    return
  }

  /** 浏览器信任栅栏：自定义路由必须过一遍，否则可被任意网页读写。 */
  function rejected(req, res) {
    try {
      const conn = (typeof ctx.get === 'function' ? ctx.get('connection') : undefined) || ctx.connection
      if (!conn || typeof conn.requestRejection !== 'function') return false
      const code = conn.requestRejection(req)
      if (code === undefined || code === null || code === false) return false
      res.statusCode = typeof code === 'number' ? code : 403
      res.end()
      return true
    } catch (err) {
      return false
    }
  }

  function registerRoute(route) {
    const inner = route && route.handler
    const wrapped = Object.assign({}, route, {
      handler: async (req, res) => {
        if (rejected(req, res)) return
        return inner(req, res)
      }
    })
    return webServer.register(wrapped)
  }

  function sendJson(res, code, payload) {
    const body = Buffer.from(JSON.stringify(payload), 'utf8')
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': String(body.length)
    })
    res.end(body)
  }

  function sendText(res, type, text) {
    const body = Buffer.from(text, 'utf8')
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'Content-Length': String(body.length)
    })
    res.end(body)
  }

  function readBody(req, limit = 64 * 1024) {
    return new Promise((resolve) => {
      let size = 0
      const chunks = []
      req.on('data', (c) => {
        size += c.length
        if (size > limit) {
          try { req.destroy?.() } catch (err) { /* noop */ }
          resolve('')
          return
        }
        chunks.push(c)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', () => resolve(''))
    })
  }

  /* ── 样式与运行时：同一份文件由浏览器直接拉取，不在 Host 侧复制副本 ── */
  disposers.push(registerRoute({
    kind: 'exact',
    path: ROUTE_BASE + '/splash.css',
    handler: (req, res) => {
      const text = readSplashCss()
      if (!text) warnOnce('splash-css', 'lib/splash.css 读取失败，本次返回空样式（启动层兜底 CSS 仍生效）。')
      sendText(res, 'text/css; charset=utf-8', text)
    }
  }))

  disposers.push(registerRoute({
    kind: 'exact',
    path: ROUTE_BASE + '/splash.js',
    handler: (req, res) => {
      const text = readSplashJs()
      if (!text) warnOnce('splash-js', 'lib/splash.js 读取失败，本次返回空脚本（8 秒兜底放行仍在）。')
      sendText(res, 'application/javascript; charset=utf-8', text)
    }
  }))

  /* 独立预览页：设置页「预览」按钮与 /dsh-yomi/preview 共用同一份 HTML，
     页面自身按 file:// 或 http:// 切换资源前缀。 */
  disposers.push(registerRoute({
    kind: 'exact',
    path: ROUTE_BASE + '/preview',
    handler: (req, res) => {
      const html = readPreviewHtml()
      if (!html) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('preview not found')
        return
      }
      sendText(res, 'text/html; charset=utf-8', html)
    }
  }))

  /* 素材：GET/HEAD + 单段 Range。视频要能拖进度条，必须回 206 + Content-Range。
     文件不存在或不在白名单 → 404 空体，浏览器半侧据此回落程序化背景。 */
  disposers.push(registerRoute({
    kind: 'prefix',
    path: ROUTE_BASE + '/asset',
    handler: (req, res) => {
      const method = String(req.method || 'GET').toUpperCase()
      if (method !== 'GET' && method !== 'HEAD') {
        res.writeHead(405, { 'Allow': 'GET, HEAD' })
        res.end()
        return
      }
      const prefix = ROUTE_BASE + '/asset/'
      const pathname = String(req.url || '').split('?')[0].split('#')[0]
      if (!pathname.startsWith(prefix)) {
        res.writeHead(404)
        res.end()
        return
      }
      let assetName
      try {
        assetName = decodeURIComponent(pathname.slice(prefix.length))
      } catch (err) {
        res.writeHead(404)
        res.end()
        return
      }
      const type = Object.prototype.hasOwnProperty.call(ASSET_TYPES, assetName) ? ASSET_TYPES[assetName] : null
      if (!type || assetName.includes('/') || assetName.includes('\\') || assetName.includes('..')) {
        res.writeHead(404)
        res.end()
        return
      }
      const file = path.join(PACKAGE_ROOT, 'lib', 'assets', assetName)
      let size
      try {
        const st = fs.statSync(file)
        if (!st.isFile()) throw new Error('not a file')
        size = st.size
      } catch (err) {
        res.writeHead(404)
        res.end()
        return
      }

      const rangeHeader = req.headers ? (req.headers.range || req.headers.Range) : ''
      const range = rangeHeader ? parseRange(rangeHeader, size) : null
      if (range && range.invalid) {
        res.writeHead(416, {
          'Content-Type': type,
          'Accept-Ranges': 'bytes',
          'Content-Range': 'bytes */' + size,
          'Content-Length': '0'
        })
        res.end()
        return
      }

      const headOnly = method === 'HEAD'
      const headers = {
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=86400'
      }
      if (!range) {
        headers['Content-Length'] = String(size)
        if (headOnly) {
          res.writeHead(200, headers)
          res.end()
          return
        }
        let bytes
        try {
          bytes = fs.readFileSync(file)
        } catch (err) {
          res.writeHead(404)
          res.end()
          return
        }
        res.writeHead(200, headers)
        res.end(bytes)
        return
      }

      let bytes
      try {
        bytes = headOnly ? null : readAssetSlice(file, range.start, range.end)
      } catch (err) {
        res.writeHead(404)
        res.end()
        return
      }
      headers['Content-Range'] = 'bytes ' + range.start + '-' + range.end + '/' + size
      headers['Content-Length'] = String(range.end - range.start + 1)
      res.writeHead(206, headers)
      res.end(bytes === null ? undefined : bytes)
    }
  }))

  /* 配置读写：白名单字段由 normalize() 把关，写盘原子替换。 */
  disposers.push(registerRoute({
    kind: 'exact',
    path: ROUTE_BASE + '/config',
    handler: async (req, res) => {
      const method = String(req.method || 'GET').toUpperCase()
      if (method === 'GET') {
        sendJson(res, 200, {
          ok: true,
          version: PLUGIN_VERSION,
          config: readConfig(),
          defaults: DEFAULTS,
          file: CONFIG_FILE
        })
        return
      }
      if (method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      const text = await readBody(req)
      let payload = {}
      try {
        payload = text ? JSON.parse(text) : {}
      } catch (err) {
        sendJson(res, 400, { ok: false, error: 'invalid json' })
        return
      }
      try {
        if (payload && payload.action === 'reset') {
          sendJson(res, 200, {
            ok: true,
            version: PLUGIN_VERSION,
            config: writeConfig(DEFAULTS),
            defaults: DEFAULTS
          })
          return
        }
        const current = readConfig()
        const patch = payload && typeof payload.patch === 'object' && payload.patch ? payload.patch : payload
        sendJson(res, 200, {
          ok: true,
          version: PLUGIN_VERSION,
          config: writeConfig({ ...current, ...patch }),
          defaults: DEFAULTS
        })
      } catch (err) {
        sendJson(res, 500, { ok: false, error: String((err && err.message) || err) })
      }
    }
  }))

  /* ── 首屏注入 ──────────────────────────────────────────────────────────── */
  disposers.push(webServer.tapIndex((html) => {
    if (typeof html !== 'string' || html.includes(ROUTE_BASE + '/splash.js')) return html
    const cfg = readConfig()
    const head =
      '<link rel="stylesheet" href="' + ROUTE_BASE + '/splash.css">' +
      '<style id="dsh-yomi-critical">' + CRITICAL_CSS + '</style>'
    const body =
      '<div id="dsh-yomi-root" class="yomi-boot"></div>' +
      '<script>window.__DSH_YOMI_VERSION__=' + safeJson(PLUGIN_VERSION) +
      ';window.__DSH_YOMI__=' + safeJson(cfg) + ';' + BOOTSTRAP_JS + '</script>' +
      '<script defer src="' + ROUTE_BASE + '/splash.js"></script>'

    let out = html
    if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, head + '</head>')
    else out = head + out
    if (/<body[^>]*>/i.test(out)) out = out.replace(/<body[^>]*>/i, (tag) => tag + body)
    else if (/<\/body>/i.test(out)) out = out.replace(/<\/body>/i, body + '</body>')
    else out = out + body
    return out
  }))

  ctx.effect(() => () => {
    for (const dispose of disposers) {
      try { dispose() } catch (err) { /* noop */ }
    }
  })
}

/* 导出形状对齐 DSH 内部插件（如 dsh-host-open-in-app）：只给具名 name / inject / apply。
   刻意不导出 default 与 Config：cordis-plugin-loader 的 unwrapExports 是
   `exports.default ?? exports`，有 default 反而多一个"改一处忘一处"的坑；
   本插件也不吃 profile 配置（配置走自己的 JSON + HTTP API）。 */
export { apply, inject, name }
