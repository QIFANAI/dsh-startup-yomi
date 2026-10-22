#!/usr/bin/env node
/* ============================================================================
 * scripts/shots.mjs — headless Edge + CDP 截图验收链（零依赖）
 * ----------------------------------------------------------------------------
 * 用本机 Edge 的 --headless=new + --remote-debugging-port 起一个临时实例，
 * Node 24 自带 WebSocket 直连 DevTools 协议：导航 → 等待 → 交互 → 冻结 → 截图，
 * 最后写 manifest.json（每张图的尺寸、字节数、像素统计、console 错误、DOM 快照）。
 *
 * 为什么需要「冻结」：
 *   · headless + --disable-gpu 只有约 7fps，Page.captureScreenshot 从请求到落帧
 *     可能晚 1–2 秒；而 sync 幕只有约 980ms，echo 点满三枚后 620ms 就进 sync，
 *     直接截会漂到后续幕。
 *   · Debugger.pause 期间渲染器被挂起，Page.captureScreenshot 会死锁（实测 30s 超时）；
 *     因此改为「页面级软冻结」：在文档最前面接管 requestAnimationFrame / setTimeout /
 *     clearTimeout，页面逻辑在目标状态同步调用 __SHOT_CLOCK__.freeze()，把 rAF 与
 *     定时器挂起（可 thaw 恢复）。渲染进程仍可响应 CDP，截图稳定拿到冻结帧。
 *   · 冻结点：蓄力 35%/85%（页面内 watcher 监测 __DSH_YOMI_API__.charge）、
 *     进入 echo 后 60ms、第一/第二枚点击后 150/260ms、第三枚点击后 260ms、sync 后约 560ms。
 *   · 若页面没有 window.__DSH_YOMI_API__.charge/.echo（旧版），自动回退到 DOM
 *     百分比文本 / 时间等待；--no-freeze 可整体关闭冻结。
 *
 * 用法：
 *   node scripts/shots.mjs                       # 跑全部场景 → _shots/v2/
 *   node scripts/shots.mjs --only=linkIdle,echo1 # 只跑指定场景
 *   node scripts/shots.mjs --width=1600 --height=900 --out=_shots/v2
 *   node scripts/shots.mjs --list                # 列出场景名
 *   node scripts/shots.mjs --self-test           # 反向验证截图链（黑图/报错/404/冻结截图）
 *   node scripts/shots.mjs --no-freeze           # 不冻结，纯时间等待（调试用）
 *   node scripts/shots.mjs --reduced             # 模拟 prefers-reduced-motion: reduce
 *
 * 场景（按组，含 95 秒静置与六形态终帧）：
 *   linkIdle   ?phase=link  待机 1.2s
 *   linkHold35 ?phase=link&charge=0  按住蓄能，冻结在约 35%
 *   linkHold85 ?phase=link&charge=0  按住蓄能，冻结在约 85%
 *   linkDone   ?phase=link&charge=0  按住直到蓄满进入 echo（echo 后 60ms 冻结）
 *   echoIdle   ?phase=echo  节点入场动画完成（约 1.4s）
 *   echo1/2/3  ?phase=echo  同一页面依次点击三枚 .yomi-node，各等约 0.9s
 *   sync       ?phase=echo  点满三枚后等 sync 冻结；失败回退 ?phase=sync
 *   reveal     ?phase=reveal 等 1.6s
 *
 * 选择器回退链（旧版 → 新版）：
 *   蓄能按钮  .yomi-core → .yomi-charge → .yomi-charge-ring
 *   残响碎片  .yomi-node → .yomi-fragment → [data-yomi-node]
 *   蓄力百分比 .yomi-charge-pct → .yomi-core-pct → [data-charge-pct]
 * 按住优先 Input.dispatchMouseEvent；页面无反应时回退 Runtime.evaluate 派发
 * pointerdown/pointerup。点击碎片优先 Runtime.evaluate .click()，无效时回退鼠标点击。
 *
 * 写入范围：只写 --out 目录（默认 _shots/v2/）和系统临时目录里的 Edge profile。
 * 不触碰 lib/ preview/ test/ package.json。
 * ========================================================================== */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { inflateSync } from 'node:zlib'

/* ── 路径与常量 ─────────────────────────────────────────────────────────── */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PREVIEW_URL = pathToFileURL(path.join(ROOT, 'preview', 'index.html')).href
const LINK_URL = PREVIEW_URL + '?phase=link&clean=1&nobgm=1'
/* 蓄力场景从 0 开始：新版预览页支持 ?charge=，旧版忽略该参数（旧版蓄力本身从 0 计） */
const LINK_HOLD_URL = LINK_URL + '&charge=0'
const LINK_ZERO_URL = LINK_HOLD_URL
const LINK_NOVIDEO_URL = LINK_URL + '&charge=0.62&novideo=1'
const ECHO_URL = PREVIEW_URL + '?phase=echo&clean=1&nobgm=1'
const ECHO_NOVIDEO_URL = ECHO_URL + '&novideo=1'
const SYNC_URL = PREVIEW_URL + '?phase=sync&clean=1&nobgm=1'
const SYNC_SLOW_URL = SYNC_URL + '&speed=0.6'
const REVEAL_URL = PREVIEW_URL + '?phase=reveal&clean=1&nobgm=1'
const REVEAL_FORMS = [
  { name: 'formCrest', order: '1-2-3', label: '溯名者 / crest' },
  { name: 'formHalo', order: '1-3-2', label: '执灯者 / halo' },
  { name: 'formStorm', order: '2-1-3', label: '归雷者 / storm' },
  { name: 'formGhost', order: '2-3-1', label: '拾忆者 / ghost' },
  { name: 'formMirror', order: '3-1-2', label: '问名者 / mirror' },
  { name: 'formEcho', order: '3-2-1', label: '余响者 / echo' }
]

/* DOM 选择器回退链：新版新增 .yomi-core，旧版沿用 .yomi-charge */
const SEL = {
  charge: ['.yomi-core', '.yomi-charge', '.yomi-charge-ring', '.yomi-core-btn'],
  node: ['.yomi-node', '.yomi-fragment', '[data-yomi-node]'],
  nodeDone: ['.yomi-node-done', '.yomi-node.done', '[data-yomi-node-done]'],
  pct: ['.yomi-charge-pct', '.yomi-core-pct', '[data-charge-pct]'],
  syncNum: ['.yomi-sync-num', '.yomi-core-sync', '[data-yomi-sync]'],
  flash: ['.yomi-flash'],
  root: ['.yomi-root'],
  skip: ['.yomi-skip', '[data-yomi-skip]']
}
const sel = (list) => list.join(', ')

const SCENES = [
  { name: 'linkIdle', group: 'link', kind: 'idle', url: LINK_URL, waitMs: 1200, desc: 'link 幕待机（真实 0% 蓄力环）' },
  { name: 'linkZero', group: 'link', kind: 'idle', url: LINK_ZERO_URL, waitMs: 1200, desc: 'link 幕真实 0% 待机' },
  { name: 'linkLongWait', group: 'link', kind: 'idle', url: LINK_ZERO_URL, waitMs: 8000, desc: 'link 幕静置 8 秒，确认蓄能不会自行上涨' },
  { name: 'linkLongWait95', group: 'link', kind: 'idle', url: LINK_ZERO_URL, waitMs: 95000, desc: 'link 幕静置 95 秒，确认不自动退出、不自行蓄能' },
  { name: 'linkLongWaitHold35', group: 'link', kind: 'hold', url: LINK_ZERO_URL, targetPct: 35, freezeTargetPct: 32, nominalWaitMs: 600, preWaitMs: 8000, desc: '静置 8 秒后再按住，冻结在约 35%' },
  { name: 'linkHold35', group: 'link', kind: 'hold', url: LINK_HOLD_URL, targetPct: 35, freezeTargetPct: 32, nominalWaitMs: 600, desc: '按住蓄能，冻结在约 35%' },
  { name: 'linkHold85', group: 'link', kind: 'hold', url: LINK_HOLD_URL, targetPct: 85, freezeTargetPct: 82, nominalWaitMs: 1500, desc: '按住蓄能，冻结在约 85%' },
  { name: 'linkNoVideo', group: 'link', kind: 'idle', url: LINK_NOVIDEO_URL, waitMs: 1600, desc: '无视频素材：海报角色仍可见，SYNC 62%' },
  { name: 'linkDone', group: 'link', kind: 'hold-until-echo', url: LINK_HOLD_URL, desc: '蓄满瞬间 / 刚进 echo（echo 后 60ms 冻结）' },
  { name: 'echoIdle', group: 'echo', kind: 'echo-idle', url: ECHO_URL, waitMs: 1400, desc: 'echo 幕节点入场动画完成' },
  { name: 'echoNoVideo', group: 'echo', kind: 'echo-idle', url: ECHO_NOVIDEO_URL, waitMs: 1400, desc: '无视频素材：ECHO 角色海报与开场第一句' },
  { name: 'echo1', group: 'echo', kind: 'echo-click', clicks: 1, waitMs: 900, earlyCaptureMs: 150, desc: '第 1 枚点击后约 0.15s（雷击白闪 / 裂痕）' },
  { name: 'echo2', group: 'echo', kind: 'echo-click', clicks: 2, waitMs: 900, earlyCaptureMs: 260, desc: '第 2 枚点击后约 0.26s（母版暂停 / 数字倒带）' },
  { name: 'echo3', group: 'echo', kind: 'echo-click', clicks: 3, waitMs: 900, earlyCaptureMs: 260, desc: '点击第 3 枚碎片后约 0.26s（在自动进 sync 前冻结）' },
  { name: 'echo3early', group: 'echo', kind: 'echo-click', clicks: 3, reset: true, waitMs: 900, earlyCaptureMs: 150, desc: '第三击后 150ms，捕捉主角头部反应' },
  { name: 'orderMirror', group: 'echo', kind: 'echo-click', clicks: 3, reset: true, clickOrder: [2, 0, 1], waitMs: 900, earlyCaptureMs: 260, desc: '真实逆序点击 03 → 01 → 02，校验 data-form-motif=mirror' },
  { name: 'sync', group: 'echo', kind: 'sync', clicks: 3, desc: '三枚点满后的 sync 瞬间；抓不到则回退 ?phase=sync' },
  { name: 'reveal', group: 'reveal', kind: 'idle', url: REVEAL_URL, waitMs: 3000, desc: 'reveal 幕默认形态，等台词落版' },
  ...REVEAL_FORMS.map((form) => ({
    name: form.name,
    group: 'reveal',
    kind: 'idle',
    url: REVEAL_URL + '&order=' + form.order,
    waitMs: 3000,
    desc: 'reveal 终态：' + form.label
  }))
]
const SCENE_NAMES = SCENES.map((s) => s.name)

/* ── 小工具 ─────────────────────────────────────────────────────────────── */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const nowIso = () => new Date().toISOString()
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/')

/* 页面级软时钟：文档最前面接管 rAF/setTimeout，可整体冻结/恢复页面逻辑。
 * 只影响页面里的动画与定时器，不影响 CDP 截图与 Runtime.evaluate。 */
const CLOCK_SOURCE = `(() => {
  if (window.__SHOT_CLOCK__) return;
  var realSetTimeout = window.setTimeout.bind(window);
  var realClearTimeout = window.clearTimeout.bind(window);
  var realSetInterval = window.setInterval.bind(window);
  var realClearInterval = window.clearInterval.bind(window);
  var realRAF = window.requestAnimationFrame.bind(window);
  var realCAF = window.cancelAnimationFrame.bind(window);
  var frozen = false;
  var timers = new Map();
  var rafs = new Map();
  var pendingTimers = new Map();
  var pendingRafs = new Map();
  var nextPending = -2;
  window.setTimeout = function (fn, delay) {
    var args = Array.prototype.slice.call(arguments, 2);
    if (typeof fn !== 'function') return realSetTimeout.apply(window, arguments);
    if (frozen) { var pid = nextPending--; pendingTimers.set(pid, { fn: fn, args: args, delay: Math.max(0, Number(delay) || 0) }); return pid; }
    var rec = { fn: fn, args: args, delay: Math.max(0, Number(delay) || 0), start: performance.now() };
    var id = realSetTimeout(function () { timers.delete(id); fn.apply(window, rec.args); }, rec.delay);
    rec.id = id; timers.set(id, rec); return id;
  };
  window.clearTimeout = function (id) {
    if (id < 0) { pendingTimers.delete(id); return; }
    timers.delete(id); realClearTimeout(id);
  };
  window.setInterval = function (fn, delay) {
    if (typeof fn !== 'function') return realSetInterval.apply(window, arguments);
    if (frozen) return nextPending--;
    return realSetInterval.apply(window, arguments);
  };
  window.clearInterval = function (id) { return realClearInterval(id); };
  window.requestAnimationFrame = function (fn) {
    if (frozen) { var pid = nextPending--; pendingRafs.set(pid, fn); return pid; }
    var id = realRAF(function (ts) { rafs.delete(id); fn(ts); });
    rafs.set(id, fn); return id;
  };
  window.cancelAnimationFrame = function (id) {
    if (id < 0) { pendingRafs.delete(id); return; }
    rafs.delete(id); realCAF(id);
  };
  window.__SHOT_CLOCK__ = {
    freeze: function () {
      if (frozen) return true;
      frozen = true;
      var now = performance.now();
      timers.forEach(function (rec, id) {
        realClearTimeout(id);
        pendingTimers.set(nextPending--, { fn: rec.fn, args: rec.args, delay: Math.max(0, rec.delay - (now - rec.start)) });
      });
      timers.clear();
      rafs.forEach(function (fn, id) { realCAF(id); pendingRafs.set(nextPending--, fn); });
      rafs.clear();
      return true;
    },
    thaw: function () {
      if (!frozen) return true;
      frozen = false;
      var t = Array.from(pendingTimers.values()); pendingTimers.clear();
      var r = Array.from(pendingRafs.values()); pendingRafs.clear();
      t.forEach(function (rec) { window.setTimeout(rec.fn, rec.delay, ...rec.args); });
      r.forEach(function (fn) { window.requestAnimationFrame(fn); });
      return true;
    },
    isFrozen: function () { return frozen; }
  };
})()`

const SYNC_WATCHER_SOURCE = (delayMs) => `(() => {
  if (window.__SHOT_SYNC_WATCHER__) return;
  window.__SHOT_SYNC_WATCHER__ = true;
  var enteredAt = 0;
  (function tick() {
    var api = window.__DSH_YOMI_API__;
    if (window.__SHOT_CLOCK__ && api && api.state === 'sync') {
      if (!enteredAt) enteredAt = performance.now();
      if (performance.now() - enteredAt >= ${delayMs}) {
        window.__SHOT_SYNC_RESULT__ = { state: 'sync', enteredAt: enteredAt, pausedAt: performance.now() };
        window.__SHOT_CLOCK__.freeze();
        return;
      }
    }
    requestAnimationFrame(tick);
  })();
})()`

function parseArgs(argv) {
  const o = {
    width: 1600,
    height: 900,
    out: path.join(ROOT, '_shots', 'v2'),
    only: null,
    selfTest: false,
    list: false,
    keep: false,
    help: false,
    verbose: false,
    freeze: true,
    reduced: false,
    syncFreezeDelayMs: 560,
    freezeTimeoutMs: 15000
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '-h') { o.help = true; continue }
    if (!arg.startsWith('--')) throw new Error('unexpected argument: ' + arg)
    const eq = arg.indexOf('=')
    const key = eq >= 0 ? arg.slice(2, eq) : arg.slice(2)
    const val = eq >= 0 ? arg.slice(eq + 1) : null
    const next = () => {
      if (val != null) return val
      const v = argv[++i]
      if (v == null) throw new Error('missing value for --' + key)
      return v
    }
    switch (key) {
      case 'width': o.width = Number(next()); break
      case 'height': o.height = Number(next()); break
      case 'out': o.out = next(); break
      case 'only': o.only = next(); break
      case 'self-test': o.selfTest = true; break
      case 'list': o.list = true; break
      case 'keep-profile': o.keep = true; break
      case 'verbose': o.verbose = true; break
      case 'no-freeze': o.freeze = false; break
      case 'reduced': o.reduced = true; break
      case 'help': o.help = true; break
      default: throw new Error('unknown argument: --' + key)
    }
  }
  if (!Number.isFinite(o.width) || o.width < 320) throw new Error('--width must be >= 320')
  if (!Number.isFinite(o.height) || o.height < 240) throw new Error('--height must be >= 240')
  o.width = Math.round(o.width)
  o.height = Math.round(o.height)
  o.out = path.isAbsolute(o.out) ? o.out : path.resolve(process.cwd(), o.out)
  if (o.only) {
    const names = o.only.split(',').map((s) => s.trim()).filter(Boolean)
    const unknown = names.filter((n) => !SCENE_NAMES.includes(n))
    if (unknown.length) throw new Error('unknown scene(s): ' + unknown.join(', ') + '\nvalid: ' + SCENE_NAMES.join(', '))
    o.only = new Set(names)
  }
  return o
}

function printHelp() {
  console.log(`scripts/shots.mjs — headless Edge CDP 截图验收链（零依赖）

用法:
  node scripts/shots.mjs                        跑全部场景，输出到 _shots/v2/
  node scripts/shots.mjs --only=linkIdle,echo1  只跑指定场景
  node scripts/shots.mjs --width=1600 --height=900
  node scripts/shots.mjs --out=_shots/v2
  node scripts/shots.mjs --list                 列出场景
  node scripts/shots.mjs --self-test            反向验证截图链（黑图/JS 报错/文件不存在/冻结截图）
  node scripts/shots.mjs --no-freeze            关闭页面级冻结（纯时间等待）
  node scripts/shots.mjs --reduced              模拟 prefers-reduced-motion: reduce

场景: ${SCENE_NAMES.join(', ')}
输出: <out>/<场景>.png + <out>/manifest.json
环境: EDGE_PATH 可覆盖 Edge 路径。`)
}

/* ── 端口 / Edge 进程 ───────────────────────────────────────────────────── */

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

async function fetchJson(url, timeoutMs = 1500) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

async function waitForPageTarget(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  let lastErr = null
  while (Date.now() < deadline) {
    try {
      const list = await fetchJson(`http://127.0.0.1:${port}/json/list`)
      const pages = (Array.isArray(list) ? list : []).filter((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (pages.length) return pages.find((t) => t.url === 'about:blank') || pages[0]
      lastErr = new Error('no page target yet')
    } catch (e) {
      lastErr = e
    }
    await sleep(120)
  }
  throw new Error('Edge 未在 ' + timeoutMs + 'ms 内暴露 page target: ' + (lastErr ? lastErr.message : 'unknown'))
}

function waitChildExit(child, timeoutMs) {
  if (child.exitCode != null || child.signalCode != null) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => { cleanup(); resolve(false) }, timeoutMs)
    function cleanup() { clearTimeout(timer); child.removeListener('exit', onExit) }
    function onExit() { cleanup(); resolve(true) }
    child.on('exit', onExit)
  })
}

function killProcessTree(pid) {
  if (!pid) return
  try {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  } catch { /* 已退出 */ }
}

async function launchEdge(opts) {
  if (!existsSync(EDGE_PATH)) throw new Error('找不到 Edge: ' + EDGE_PATH + '（可用 EDGE_PATH 环境变量覆盖）')
  const port = await findFreePort()
  const profileDir = await mkdtemp(path.join(tmpdir(), 'yomi-shots-'))
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `--window-size=${opts.width},${opts.height}`,
    '--force-device-scale-factor=1',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-sync',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--mute-audio',
    'about:blank'
  ]
  if (opts.verbose) console.log('[shots] spawn edge:', EDGE_PATH, args.join(' '))
  const child = spawn(EDGE_PATH, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
  let stderr = ''
  child.stderr && child.stderr.on('data', (d) => {
    stderr += String(d)
    if (stderr.length > 16384) stderr = stderr.slice(-16384)
  })
  const launchedAt = Date.now()
  const target = await waitForPageTarget(port)
  const version = await fetchJson(`http://127.0.0.1:${port}/json/version`).catch(() => ({}))
  return { child, port, profileDir, target, stderr: () => stderr, version, bootMs: Date.now() - launchedAt }
}

async function closeEdge(browser, opts) {
  if (!browser) return
  try { if (client && client.isOpen()) await client.send('Browser.close', {}, 3000) } catch { /* 忽略 */ }
  const exited = await waitChildExit(browser.child, 3000)
  if (!exited) {
    killProcessTree(browser.child.pid)
    await waitChildExit(browser.child, 3000)
  }
  if (!opts.keep) {
    for (let attempt = 0; attempt < 4; attempt++) {
      try { await rm(browser.profileDir, { recursive: true, force: true, maxRetries: 2, retryDelay: 150 }); break } catch { await sleep(250) }
    }
  } else {
    console.log('[shots] profile kept:', browser.profileDir)
  }
}

/* ── CDP 客户端 ─────────────────────────────────────────────────────────── */

let client = null
let currentScene = '(startup)'
const consoleErrors = []
const consoleWarnings = []
const MAX_LOG = 400

function pushLog(bucket, item) {
  if (bucket.length >= MAX_LOG) bucket.shift()
  bucket.push(item)
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl
    this.ws = null
    this.nextId = 0
    this.pending = new Map()
    this.handlers = new Map()
    this.closed = false
  }

  isOpen() { return !!this.ws && this.ws.readyState === 1 && !this.closed }

  async connect(timeoutMs = 12000) {
    this.ws = new WebSocket(this.wsUrl)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP WebSocket open timeout')), timeoutMs)
      const onOpen = () => { clearTimeout(timer); resolve() }
      const onError = () => { clearTimeout(timer); reject(new Error('CDP WebSocket connect error: ' + this.wsUrl)) }
      this.ws.addEventListener('open', onOpen, { once: true })
      this.ws.addEventListener('error', onError, { once: true })
    })
    this.ws.addEventListener('message', (ev) => this.#onMessage(ev))
    this.ws.addEventListener('close', () => {
      this.closed = true
      for (const [, p] of this.pending) p.reject(new Error('CDP connection closed while waiting for ' + p.method))
      this.pending.clear()
    })
    this.ws.addEventListener('error', () => { /* send 时会暴露 */ })
  }

  #onMessage(ev) {
    let msg
    try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)) } catch { return }
    if (msg.id != null) {
      const pending = this.pending.get(msg.id)
      if (!pending) return
      this.pending.delete(msg.id)
      if (msg.error) pending.reject(new Error(`${pending.method}: ${msg.error.message} (code ${msg.error.code})`))
      else pending.resolve(msg.result)
      return
    }
    const set = this.handlers.get(msg.method)
    if (set) for (const fn of [...set]) { try { fn(msg.params) } catch { /* handler 不抛 */ } }
  }

  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, new Set())
    const set = this.handlers.get(method)
    set.add(fn)
    return () => set.delete(fn)
  }

  once(method, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const off = this.on(method, (params) => { clearTimeout(timer); off(); resolve(params) })
      const timer = setTimeout(() => { off(); reject(new Error('timeout waiting for CDP event ' + method)) }, timeoutMs)
    })
  }

  send(method, params = {}, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      if (!this.isOpen()) { reject(new Error('CDP websocket is not open: ' + method)); return }
      const id = ++this.nextId
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP timeout after ${timeoutMs}ms: ${method}`))
      }, timeoutMs)
      this.pending.set(id, {
        method,
        resolve: (r) => { clearTimeout(timer); resolve(r) },
        reject: (e) => { clearTimeout(timer); reject(e) }
      })
      try {
        this.ws.send(JSON.stringify({ id, method, params }))
      } catch (e) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(e)
      }
    })
  }

  close() {
    try { this.ws && this.ws.close() } catch { /* 忽略 */ }
    this.closed = true
  }
}

function wireEventCollection(cdp) {
  cdp.on('Runtime.consoleAPICalled', (p) => {
    const level = p.type
    const text = (p.args || []).map((a) => {
      if (a.value !== undefined) return typeof a.value === 'string' ? a.value : JSON.stringify(a.value)
      if (a.description != null) return a.description
      if (a.unserializableValue != null) return a.unserializableValue
      return a.type || ''
    }).join(' ')
    const frame = p.stackTrace && p.stackTrace.callFrames && p.stackTrace.callFrames[0]
    const item = {
      kind: 'console',
      level,
      text,
      url: frame ? frame.url : '',
      line: frame ? frame.lineNumber : undefined,
      scene: currentScene
    }
    if (level === 'error' || level === 'assert') pushLog(consoleErrors, item)
    else if (level === 'warning' || level === 'warn') pushLog(consoleWarnings, item)
  })
  cdp.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails || {}
    pushLog(consoleErrors, {
      kind: 'exception',
      level: 'error',
      text: (d.exception && (d.exception.description || d.exception.value)) || d.text || 'uncaught exception',
      url: d.url || '',
      line: d.lineNumber,
      scene: currentScene
    })
  })
  cdp.on('Log.entryAdded', (p) => {
    const e = p.entry || {}
    if (e.level === 'error') {
      pushLog(consoleErrors, { kind: 'log', level: 'error', text: e.text || '', url: e.url || '', line: e.lineNumber, source: e.source, scene: currentScene })
    } else if (e.level === 'warning') {
      pushLog(consoleWarnings, { kind: 'log', level: 'warning', text: e.text || '', url: e.url || '', line: e.lineNumber, source: e.source, scene: currentScene })
    }
  })
  cdp.on('Inspector.targetCrashed', () => {
    pushLog(consoleErrors, { kind: 'crash', level: 'error', text: 'renderer target crashed', scene: currentScene })
  })
}

/* ── 页面操作 ───────────────────────────────────────────────────────────── */

async function evaluate(expression, timeoutMs = 12000) {
  const res = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }, timeoutMs)
  if (res && res.exceptionDetails) {
    const d = res.exceptionDetails
    throw new Error('Runtime.evaluate exception: ' + ((d.exception && (d.exception.description || d.exception.value)) || d.text))
  }
  return res && res.result ? res.result.value : undefined
}

async function waitFor(expression, timeoutMs, intervalMs = 50, label = 'condition') {
  const startedAt = Date.now()
  let lastValue
  let lastError = null
  while (Date.now() - startedAt < timeoutMs) {
    try {
      lastValue = await evaluate(expression)
      lastError = null
      if (lastValue) return { ok: true, value: lastValue, elapsedMs: Date.now() - startedAt, label }
    } catch (e) {
      lastError = e
    }
    await sleep(intervalMs)
  }
  return { ok: false, value: lastValue, error: lastError, elapsedMs: Date.now() - startedAt, label }
}

async function thawIfFrozen() {
  try {
    const frozen = await evaluate(`!!(window.__SHOT_CLOCK__ && window.__SHOT_CLOCK__.isFrozen())`, 5000)
    if (frozen) await evaluate(`window.__SHOT_CLOCK__.thaw()`, 5000)
  } catch { /* 页面可能正在导航 */ }
}

async function navigate(url) {
  await thawIfFrozen()
  const loadEvent = client.once('Page.loadEventFired', 15000).catch(() => null)
  const res = await client.send('Page.navigate', { url }, 15000)
  const errorText = res ? res.errorText : null
  await Promise.race([loadEvent, sleep(errorText ? 1200 : 5000)])
  try {
    await waitFor(`document.readyState === 'complete'`, errorText ? 1500 : 8000, 60, 'readyState')
  } catch { /* 交给下面的 errorText 判定 */ }
  if (errorText) throw new Error('navigation failed: ' + errorText + ' :: ' + url)
}

async function waitForApi(timeoutMs = 12000) {
  const r = await waitFor(`!!(window.__DSH_YOMI_API__ && window.__DSH_YOMI_API__.state)`, timeoutMs, 60, 'window.__DSH_YOMI_API__')
  if (!r.ok) throw new Error('window.__DSH_YOMI_API__ 未出现（splash.js 未加载或未启动）')
  return r.elapsedMs
}

async function readPageState() {
  try {
    return await evaluate(`(() => {
      const root = document.querySelector(${JSON.stringify(sel(SEL.root))});
      const pctEl = document.querySelector(${JSON.stringify(sel(SEL.pct))});
      const syncEl = document.querySelector(${JSON.stringify(sel(SEL.syncNum))});
      const pctText = pctEl ? (pctEl.textContent || '').trim() : null;
      const pct = pctText == null ? null : (Number.isFinite(parseInt(pctText.replace(/[^0-9]/g, ''), 10)) ? parseInt(pctText.replace(/[^0-9]/g, ''), 10) : null);
      const api = window.__DSH_YOMI_API__;
      return {
        href: location.href,
        state: api ? api.state : null,
        apiCharge: api && typeof api.charge === 'number' ? api.charge : null,
        apiEcho: api && typeof api.echo === 'number' ? api.echo : null,
        rootClasses: root ? Array.from(root.classList) : [],
        chargePctText: pctText,
        chargePct: pct,
        syncText: syncEl ? (syncEl.textContent || '').trim() : null,
        syncFillWidth: (() => {
          const el = document.querySelector('.yomi-sync-fill');
          return el ? getComputedStyle(el).width : null;
        })(),
        videoSrc: (() => {
          const el = document.querySelector('.yomi-video-el');
          return el ? (el.currentSrc || el.src || null) : null;
        })(),
        heroStill: (() => {
          const el = document.querySelector('.yomi-hero-still');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return {
            loaded: !!el.complete && el.naturalWidth > 0,
            width: el.naturalWidth,
            height: el.naturalHeight,
            visible: r.width > 4 && r.height > 4 && cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.01,
            opacity: cs.opacity,
            filter: cs.filter
          };
        })(),
        echoVoice: (() => {
          const el = document.querySelector('.yomi-echo-voice');
          if (!el) return null;
          const text = document.querySelector('.yomi-echo-voice-text');
          const cs = getComputedStyle(el);
          return {
            text: text ? (text.textContent || '').trim() : null,
            opacity: cs.opacity,
            visible: Number(cs.opacity) > 0.5 && el.getBoundingClientRect().width > 4
          };
        })(),
        nodeCount: document.querySelectorAll(${JSON.stringify(sel(SEL.node))}).length,
        nodeDone: document.querySelectorAll(${JSON.stringify(sel(SEL.nodeDone))}).length,
        dataForm: root ? root.getAttribute('data-form') : null,
        dataFormMotif: root ? root.getAttribute('data-form-motif') : null,
        dataOrder: root ? root.getAttribute('data-order') : null,
        formBodyCount: document.querySelectorAll('.yomi-form-body-el').length,
        formBodyMotif: (() => {
          const el = document.querySelector('.yomi-form-body');
          return el ? el.getAttribute('data-motif') : null;
        })(),
        formBodyOpacity: (() => {
          const el = document.querySelector('.yomi-form-body-el');
          return el ? getComputedStyle(el).opacity : null;
        })(),
        revealOrder: (() => {
          const el = document.querySelector('.yomi-reveal-order');
          return el ? (el.textContent || '').trim() : null;
        })(),
        orderForm: (() => {
          const el = document.querySelector('.yomi-order-form');
          return el ? (el.textContent || '').trim() : null;
        })(),
        flashVisible: (() => {
          const f = document.querySelector(${JSON.stringify(sel(SEL.flash))});
          return f ? f.classList.contains('yomi-flash-on') : false;
        })(),
        chargeVisible: (() => {
          const el = document.querySelector(${JSON.stringify(sel(SEL.charge))});
          if (!el) return false;
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return r.width > 4 && r.height > 4 && cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05;
        })(),
        clockFrozen: !!(window.__SHOT_CLOCK__ && window.__SHOT_CLOCK__.isFrozen()),
        reducedClass: root ? root.classList.contains('yomi-reduced') : null,
        prefersReducedMotion: window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : null,
        viewport: { width: innerWidth, height: innerHeight },
        dpr: devicePixelRatio
      };
    })()`)
  } catch {
    return null
  }
}

async function getChargeCenter() {
  const value = await evaluate(`(() => {
    const sels = ${JSON.stringify(SEL.charge)};
    const vw = innerWidth, vh = innerHeight;
    for (const s of sels) {
      const el = document.querySelector(s);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const big = r.width > Math.min(vw * 0.7, 700) || r.height > Math.min(vh * 0.85, 700);
      const visible = r.width >= 20 && r.height >= 20 && !big && cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05;
      if (visible) {
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), selector: s, via: 'rect' };
      }
    }
    return { x: Math.round(vw * 0.5), y: Math.round(vh * 0.78), w: 0, h: 0, selector: 'fallback', via: 'viewport' };
  })()`)
  if (!value) throw new Error('无法定位蓄能按钮中心')
  return value
}

async function pressAt(pt) {
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y, button: 'none', buttons: 0 }, 8000)
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', buttons: 1, clickCount: 1 }, 8000)
}

async function releaseAt(pt) {
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', buttons: 0, clickCount: 1 }, 8000)
}

async function dispatchPointerEvent(pt, type) {
  const selector = pt && pt.selector && pt.selector !== 'fallback' ? pt.selector : null
  await evaluate(`(() => {
    const type = ${JSON.stringify(type)};
    const selector = ${JSON.stringify(selector)};
    const el = selector ? document.querySelector(selector) : null;
    const target = el || window;
    const Ctor = window.PointerEvent || window.MouseEvent;
    const ev = new Ctor(type, {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: ${pt.x}, clientY: ${pt.y}, screenX: ${pt.x}, screenY: ${pt.y},
      pointerId: 1, pointerType: 'mouse', isPrimary: true,
      button: 0, buttons: ${type === 'pointerdown' ? 1 : 0}
    });
    target.dispatchEvent(ev);
    return true;
  })()`)
}

const CHARGE_ACTIVE_EXPR = `(() => {
  const root = document.querySelector(${JSON.stringify(sel(SEL.root))}) || document.documentElement;
  const pctEl = document.querySelector(${JSON.stringify(sel(SEL.pct))});
  let pct = null;
  if (pctEl) {
    const n = parseInt((pctEl.textContent || '').replace(/[^0-9]/g, ''), 10);
    if (Number.isFinite(n)) pct = n;
  }
  const api = window.__DSH_YOMI_API__;
  const st = api ? api.state : null;
  const charge = api && typeof api.charge === 'number' ? api.charge : null;
  return root.classList.contains('yomi-charging') || root.classList.contains('yomi-core-charging') || (pct !== null && pct > 0) || (charge !== null && charge > 0) || (st !== null && st !== 'link' && st !== 'boot');
})()`

async function beginHold(pt) {
  try {
    await pressAt(pt)
    const viaInput = await waitFor(CHARGE_ACTIVE_EXPR, 500, 30, 'charge active (Input)')
    if (viaInput.ok) return { mode: 'Input.dispatchMouseEvent', pt, activeAfterMs: viaInput.elapsedMs }
    await releaseAt(pt).catch(() => {})
  } catch {
    await releaseAt(pt).catch(() => {})
  }
  await dispatchPointerEvent(pt, 'pointerdown')
  const viaPointer = await waitFor(CHARGE_ACTIVE_EXPR, 700, 30, 'charge active (PointerEvent)')
  if (viaPointer.ok) return { mode: 'Runtime.evaluate.PointerEvent', pt, activeAfterMs: viaPointer.elapsedMs }
  throw new Error('蓄力未启动：Input.dispatchMouseEvent 与 PointerEvent 回退均无反应')
}

async function endHold(held) {
  if (!held) return
  try {
    if (held.mode === 'Input.dispatchMouseEvent') await releaseAt(held.pt)
    else await dispatchPointerEvent(held.pt, 'pointerup')
  } catch { /* ignore */ }
}

/* ── 页面级冻结 ─────────────────────────────────────────────────────────── */

async function waitFrozen(timeoutMs = 15000, intervalMs = 25) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const frozen = await evaluate(`!!(window.__SHOT_CLOCK__ && window.__SHOT_CLOCK__.isFrozen())`)
      if (frozen) return { ok: true, waitedMs: Date.now() - startedAt }
    } catch { /* 导航中可能短暂失败 */ }
    await sleep(intervalMs)
  }
  return { ok: false, waitedMs: Date.now() - startedAt }
}

async function armChargeFreeze(target) {
  const expr = `(() => {
    if (window.__SHOT_CHARGE_WATCHER__ || !window.__SHOT_CLOCK__) return false;
    window.__SHOT_CHARGE_WATCHER__ = true;
    window.__SHOT_CHARGE_TARGET__ = ${target};
    (function tick() {
      const api = window.__DSH_YOMI_API__;
      let c = null;
      if (api && typeof api.charge === 'number') c = api.charge;
      else {
        const el = document.querySelector(${JSON.stringify(sel(SEL.pct))});
        if (el) {
          const n = parseInt((el.textContent || '').replace(/[^0-9]/g, ''), 10);
          if (Number.isFinite(n)) c = n / 100;
        }
      }
      if (c != null && c >= window.__SHOT_CHARGE_TARGET__) {
        const el = document.querySelector(${JSON.stringify(sel(SEL.pct))});
        window.__SHOT_CHARGE_RESULT__ = {
          charge: c,
          state: api ? api.state : null,
          pctText: el ? (el.textContent || '').trim() : null,
          at: performance.now()
        };
        window.__SHOT_CLOCK__.freeze();
        return;
      }
      requestAnimationFrame(tick);
    })();
    return true;
  })()`
  await evaluate(expr)
}

async function armEchoClickFreeze(targetCount, delayMs, alreadyDone = 0) {
  const expr = `(() => {
    const token = 'click-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    window.__SHOT_CLICK_WATCHER_TOKEN__ = token;
    let seen = ${alreadyDone};
    const nodes = Array.from(document.querySelectorAll('.yomi-node'));
    const handler = function () {
      if (window.__SHOT_CLICK_WATCHER_TOKEN__ !== token) return;
      seen += 1;
      if (seen < ${targetCount}) return;
      window.setTimeout(function () {
        if (window.__SHOT_CLICK_WATCHER_TOKEN__ !== token) return;
        const api = window.__DSH_YOMI_API__;
        window.__SHOT_CLICK_RESULT__ = { echo: seen, state: api ? api.state : null, pausedAt: performance.now() };
        window.__SHOT_CLOCK__.freeze();
      }, ${delayMs});
    };
    nodes.forEach(function (node) { node.addEventListener('click', handler); });
    return nodes.length;
  })()`
  await evaluate(expr)
}

async function armEchoEntryFreeze(delayMs) {
  const expr = `(() => {
    if (window.__SHOT_ECHO_WATCHER__ || !window.__SHOT_CLOCK__) return false;
    window.__SHOT_ECHO_WATCHER__ = true;
    let enteredAt = 0;
    (function tick() {
      const api = window.__DSH_YOMI_API__;
      if (api && api.state === 'echo') {
        if (!enteredAt) enteredAt = performance.now();
        if (performance.now() - enteredAt >= ${delayMs}) {
          window.__SHOT_ECHO_RESULT__ = { enteredAt: enteredAt, pausedAt: performance.now() };
          window.__SHOT_CLOCK__.freeze();
          return;
        }
      }
      requestAnimationFrame(tick);
    })();
    return true;
  })()`
  await evaluate(expr)
}

/* ── 截图 + PNG 像素分析（零依赖解码）────────────────────────────────────── */

function decodePng(buf) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10]
  for (let i = 0; i < sig.length; i++) if (buf[i] !== sig[i]) throw new Error('not a PNG file')
  let pos = 8
  let ihdr = null
  const idat = []
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('latin1', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12]
      }
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    pos += 12 + len
  }
  if (!ihdr) throw new Error('PNG has no IHDR')
  if (ihdr.bitDepth !== 8) throw new Error('unsupported PNG bit depth: ' + ihdr.bitDepth)
  if (ihdr.interlace !== 0) throw new Error('interlaced PNG not supported')
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[ihdr.colorType]
  if (!channels) throw new Error('unsupported PNG color type: ' + ihdr.colorType)
  const raw = inflateSync(Buffer.concat(idat))
  const { width, height } = ihdr
  const stride = width * channels
  if (raw.length < height * (stride + 1)) throw new Error('PNG IDAT too short')
  const data = Buffer.alloc(stride * height)
  let src = 0
  const paeth = (a, b, c) => {
    const p = a + b - c
    const pa = Math.abs(p - a)
    const pb = Math.abs(p - b)
    const pc = Math.abs(p - c)
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
  }
  for (let y = 0; y < height; y++) {
    const filter = raw[src++]
    const rowStart = y * stride
    const prevStart = (y - 1) * stride
    const hasPrev = y > 0
    for (let x = 0; x < stride; x++) {
      const cur = raw[src + x]
      const left = x >= channels ? data[rowStart + x - channels] : 0
      const up = hasPrev ? data[prevStart + x] : 0
      const upLeft = hasPrev && x >= channels ? data[prevStart + x - channels] : 0
      let v
      switch (filter) {
        case 0: v = cur; break
        case 1: v = cur + left; break
        case 2: v = cur + up; break
        case 3: v = cur + ((left + up) >> 1); break
        case 4: v = cur + paeth(left, up, upLeft); break
        default: throw new Error('bad PNG filter type: ' + filter)
      }
      data[rowStart + x] = v & 255
    }
    src += stride
  }
  return { width, height, channels, data }
}

function analyzePng(buf) {
  const png = decodePng(buf)
  const { width, height, channels, data } = png
  const total = width * height
  const step = Math.max(1, Math.floor(total / 24000))
  const lums = []
  const colors = new Set()
  let sumLum = 0
  let maxLum = 0
  let nonDark = 0
  let count = 0
  for (let p = 0; p < total; p += step) {
    const o = p * channels
    let r, g, b
    if (channels >= 3) { r = data[o]; g = data[o + 1]; b = data[o + 2] } else { r = g = b = data[o] }
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    lums.push(lum)
    sumLum += lum
    if (lum > maxLum) maxLum = lum
    if (lum > 18) nonDark += 1
    count += 1
    colors.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3))
  }
  lums.sort((a, b) => a - b)
  const pick = (q) => (lums.length ? lums[Math.min(lums.length - 1, Math.floor(lums.length * q))] : 0)
  const avgLum = count ? sumLum / count : 0
  const nonDarkRatio = count ? nonDark / count : 0
  const uniqueColors = colors.size
  let verdict = 'ok'
  if (maxLum < 2 || (avgLum < 1.5 && nonDarkRatio < 0.001) || uniqueColors <= 2) verdict = 'blank'
  else if (uniqueColors < 8 || (nonDarkRatio < 0.01 && avgLum < 6)) verdict = 'low-content'
  return {
    pngWidth: width,
    pngHeight: height,
    channels,
    sampledPixels: count,
    avgLum: round(avgLum),
    p50Lum: round(pick(0.5)),
    p95Lum: round(pick(0.95)),
    maxLum: round(maxLum),
    nonDarkRatio: round(nonDarkRatio, 4),
    uniqueColors,
    verdict
  }
}

async function capturePng(file) {
  const startedAt = Date.now()
  const res = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }, 30000)
  const buf = Buffer.from(res.data, 'base64')
  await writeFile(file, buf)
  const stats = analyzePng(buf)
  return { bytes: buf.length, stats, captureMs: Date.now() - startedAt }
}

function fillShot(entry, file, shot, preState, extra = {}) {
  entry.file = rel(file)
  entry.bytes = shot.bytes
  entry.pngWidth = shot.stats.pngWidth
  entry.pngHeight = shot.stats.pngHeight
  entry.captureMs = shot.captureMs
  entry.pixelStats = shot.stats
  if (preState) {
    entry.url = preState.href || entry.url || ''
    entry.stateAtShot = preState.state
    entry.dom = preState
    entry.chargePctBefore = preState.chargePct
  }
  Object.assign(entry, extra)
}

async function shoot(entry, file, extra = {}) {
  const before = await readPageState()
  const shot = await capturePng(file)
  fillShot(entry, file, shot, before, extra)
  entry.frozen = false
  const after = await readPageState().catch(() => null)
  if (after) {
    entry.domAfter = after
    entry.chargePctAfter = after.chargePct
  }
  return shot
}

async function freezeAndCapture(entry, file, extra = {}) {
  if (!opts.freeze) {
    await shoot(entry, file, extra)
    return false
  }
  let frozen = false
  try {
    await evaluate(`window.__SHOT_CLOCK__ && window.__SHOT_CLOCK__.freeze()`)
    const w = await waitFrozen(4000)
    frozen = w.ok
    if (!frozen) throw new Error('clock.freeze() 调用后仍非冻结态')
  } catch (e) {
    entry.notes.push('主动冻结失败: ' + e.message + '；退回不冻结截图')
    await shoot(entry, file, extra)
    return false
  }
  const pre = await readPageState()
  const shot = await capturePng(file)
  fillShot(entry, file, shot, pre, extra)
  entry.frozen = true
  await thawIfFrozen()
  const after = await readPageState().catch(() => null)
  if (after) {
    entry.domAfter = after
    entry.chargePctAfter = after.chargePct
  }
  return true
}

/* ── 场景执行 ───────────────────────────────────────────────────────────── */

let echoSession = null
let outDir = null
let opts = null

async function readFrozenResult(key) {
  try {
    return await evaluate(`window[${JSON.stringify(key)}] || null`, 5000)
  } catch {
    return null
  }
}

async function holdWithFreeze(scene, entry, file, stopState) {
  await navigate(scene.url)
  entry.apiReadyMs = await waitForApi()
  if (scene.preWaitMs > 0) {
    await sleep(scene.preWaitMs)
    const before = await readPageState()
    entry.preWaitMs = scene.preWaitMs
    entry.chargePctBeforeHold = before ? before.chargePct : null
  }
  const pt = await getChargeCenter()
  entry.chargePoint = pt
  let held = null
  try {
    if (opts.freeze) {
      if (stopState) await armEchoEntryFreeze(60)
      else await armChargeFreeze(scene.freezeTargetPct / 100)
    }
    held = await beginHold(pt)
    entry.inputMode = held.mode
    entry.inputActiveMs = held.activeAfterMs

    if (opts.freeze) {
      const w = await waitFrozen(opts.freezeTimeoutMs)
      entry.freezeWaitMs = w.waitedMs
      if (w.ok) {
        const frozenState = await readPageState()
        const shot = await capturePng(file)
        fillShot(entry, file, shot, frozenState, { requestedWaitMs: stopState ? null : scene.nominalWaitMs })
        entry.frozen = true
        entry.stateAtShot = frozenState ? frozenState.state : null
        if (!stopState) {
          const result = await readFrozenResult('__SHOT_CHARGE_RESULT__')
          entry.freezeResult = result
          const pct = result && result.charge != null ? result.charge * 100 : (frozenState ? frozenState.chargePct : null)
          entry.chargePctBefore = pct == null ? null : round(pct, 1)
          entry.freezeTargetPct = scene.targetPct
          entry.waitMs = w.waitedMs
          if (pct != null && Math.abs(pct - scene.targetPct) > 6) {
            entry.notes.push('冻结时蓄力 ' + entry.chargePctBefore + '%，与目标 ' + scene.targetPct + '% 相差超过 6 个百分点')
          }
        } else {
          entry.freezeResult = await readFrozenResult('__SHOT_ECHO_RESULT__')
          entry.waitMs = w.waitedMs
          entry.notes.push('已在进入 echo 后 60ms 冻结截图（页面级软冻结）')
        }
        await thawIfFrozen()
      } else {
        entry.notes.push('等待页面内冻结超时（' + w.waitedMs + 'ms），退回不冻结')
        await sleep(stopState ? 2600 : scene.nominalWaitMs)
        await shoot(entry, file)
      }
    } else {
      await sleep(stopState ? 2600 : scene.nominalWaitMs)
      await shoot(entry, file)
    }

    const post = await readPageState().catch(() => null)
    if (post) {
      entry.domAfter = post
      entry.chargePctAfter = post.chargePct
      if (stopState) entry.stateAfter = post.state
      else if (!entry.stateAtShot) entry.stateAtShot = post.state
      if (stopState && entry.stateAtShot == null) entry.stateAtShot = post.state
    }
  } finally {
    await thawIfFrozen()
    await endHold(held)
  }
}

async function ensureEchoSession(url = ECHO_URL) {
  if (echoSession && echoSession.url === url) return echoSession
  echoSession = null
  await navigate(url)
  await waitForApi()
  const ready = await waitFor(`(() => {
    const api = window.__DSH_YOMI_API__;
    return !!(api && api.state === 'echo' && document.querySelectorAll(${JSON.stringify(sel(SEL.node))}).length === 3);
  })()`, 8000, 60, 'echo nodes ready')
  if (!ready.ok) throw new Error('echo 幕未就绪或碎片数量不是 3')
  await sleep(1100)
  echoSession = { url, clicked: 0, clickMethods: [], order: [] }
  return echoSession
}

async function clickNextEchoNode(session, preferredIndex) {
  const expected = session.clicked + 1
  const preferred = Number.isInteger(preferredIndex) ? preferredIndex : -1
  const result = await evaluate(`(() => {
    const nodes = Array.from(document.querySelectorAll(${JSON.stringify(sel(SEL.node))}));
    const preferred = ${preferred};
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.classList.contains('yomi-node-done') || node.getAttribute('aria-disabled') === 'true') continue;
      if (preferred >= 0 && i !== preferred) continue;
      const r = node.getBoundingClientRect();
      node.focus({ preventScroll: true });
      node.click();
      return { ok: true, index: i, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }
    return { ok: false, count: nodes.length, done: document.querySelectorAll(${JSON.stringify(sel(SEL.nodeDone))}).length };
  })()`)
  let method = 'Runtime.evaluate.HTMLElement.click'
  if (!result || !result.ok) {
    const fallback = await evaluate(`(() => {
      const nodes = Array.from(document.querySelectorAll(${JSON.stringify(sel(SEL.node))}));
      const node = nodes.find((n) => !n.classList.contains('yomi-node-done'));
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`)
    if (!fallback) throw new Error('没有可点击的碎片')
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: fallback.x, y: fallback.y, button: 'left', buttons: 1, clickCount: 1 }, 8000)
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: fallback.x, y: fallback.y, button: 'left', buttons: 0, clickCount: 1 }, 8000)
    method = 'Input.dispatchMouseEvent'
  }
  const advanced = await waitFor(`document.querySelectorAll(${JSON.stringify(sel(SEL.nodeDone))}).length >= ${expected}`, 2500, 40, 'echo node advanced')
  if (!advanced.ok) throw new Error('点击碎片后进度未前进到 ' + expected + '/3')
  session.clicked = expected
  session.order.push(result && Number.isInteger(result.index) ? result.index : null)
  session.clickMethods.push(method)
  return { method, index: result ? result.index : null }
}

async function ensureClicks(session, target, options = {}) {
  const betweenMs = Number.isFinite(options.betweenMs) ? options.betweenMs : 900
  const order = Array.isArray(options.order) ? options.order : null
  while (session.clicked < target) {
    await clickNextEchoNode(session, order ? order[session.clicked] : undefined)
    if (session.clicked < target) await sleep(betweenMs)
  }
  if (options.freezeAfterMs > 0) {
    await sleep(options.freezeAfterMs)
    await evaluate(`window.__SHOT_CLOCK__ && window.__SHOT_CLOCK__.freeze()`)
  } else if (options.afterLastMs > 0) {
    await sleep(options.afterLastMs)
  }
  return session.clickMethods
}

async function executeScene(scene, entry, file) {
  switch (scene.kind) {
    case 'idle': {
      await navigate(scene.url)
      const apiMs = await waitForApi()
      await sleep(scene.waitMs)
      entry.waitMs = scene.waitMs
      entry.apiReadyMs = apiMs
      await freezeAndCapture(entry, file, { requestedWaitMs: scene.waitMs })
      break
    }
    case 'hold': {
      await holdWithFreeze(scene, entry, file, false)
      break
    }
    case 'hold-until-echo': {
      await holdWithFreeze(scene, entry, file, true)
      break
    }
    case 'echo-idle': {
      echoSession = null
      const session = await ensureEchoSession(scene.url)
      await sleep(scene.waitMs)
      entry.waitMs = scene.waitMs
      await freezeAndCapture(entry, file, { requestedWaitMs: scene.waitMs })
      entry.clickMethods = session.clickMethods || []
      break
    }
    case 'echo-click': {
      if (scene.reset) echoSession = null
      const session = await ensureEchoSession()
      const isThird = scene.clicks >= 3
      const useEarly = !!opts.freeze && scene.earlyCaptureMs > 0
      if (useEarly) await armEchoClickFreeze(scene.clicks, scene.earlyCaptureMs, session.clicked)
      const methods = await ensureClicks(session, scene.clicks, {
        betweenMs: 900,
        order: scene.clickOrder,
        afterLastMs: useEarly || isThird ? 0 : scene.waitMs,
        freezeAfterMs: 0
      })
      entry.clickMethods = methods
      entry.clicksDone = session.clicked
      if (useEarly) {
        const w = await waitFrozen(5000)
        entry.freezeWaitMs = w.waitedMs
        if (w.ok) {
          const frozenState = await readPageState()
          const shot = await capturePng(file)
          fillShot(entry, file, shot, frozenState, { requestedWaitMs: scene.waitMs, earlyCapture: true })
          entry.frozen = true
          entry.stateAtShot = frozenState ? frozenState.state : null
          entry.waitMs = scene.earlyCaptureMs
          entry.notes.push((isThird ? '第三枚' : '第 ' + scene.clicks + ' 枚') + '碎片点击后 ' + scene.earlyCaptureMs + 'ms 冻结截图')
          if (frozenState && frozenState.nodeDone < scene.clicks) {
            entry.notes.push('冻结帧 nodeDone=' + frozenState.nodeDone + '（应 ≥' + scene.clicks + '）')
          }
          entry.freezeResult = await readFrozenResult(isThird ? '__SHOT_ECHO3_RESULT__' : '__SHOT_ECHO_RESULT__')
          await thawIfFrozen()
          const post = await readPageState().catch(() => null)
          if (post) entry.domAfter = post
        } else {
          entry.notes.push('等待点击后冻结超时，退回不冻结')
          await shoot(entry, file)
        }
      } else if (isThird) {
        await sleep(scene.waitMs)
        await shoot(entry, file)
      } else {
        entry.waitMs = scene.waitMs
        await freezeAndCapture(entry, file, { requestedWaitMs: scene.waitMs })
      }
      break
    }
    case 'sync': {
      /* sync 只持续约 980ms；用 0.6× 把窗口拉长到约 1.63s，再直接冻结，
         避免复用上一场景的 echoSession 时页面已走到 reveal。 */
      await navigate(SYNC_SLOW_URL)
      const apiMs = await waitForApi()
      await sleep(300)
      entry.waitMs = 300
      entry.apiReadyMs = apiMs
      const frozen = await freezeAndCapture(entry, file, { requestedWaitMs: 300 })
      entry.notes.push(frozen ? 'sync 幕在进入后约 300ms 冻结（0.6× 延长窗口）' : 'sync 幕未冻结，已按时间截图')
      if (entry.stateAtShot && entry.stateAtShot !== 'sync') {
        entry.notes.push('警告：截图时 state=' + entry.stateAtShot + '（应为 sync）')
      }
      break
    }
    default:
      throw new Error('未知场景类型: ' + scene.kind)
  }
}

async function runScene(scene) {
  const file = path.join(outDir, scene.name + '.png')
  const entry = {
    name: scene.name,
    desc: scene.desc || '',
    file: rel(file),
    url: scene.url || '',
    startedAt: nowIso(),
    notes: [],
    consoleErrors: [],
    consoleWarnings: []
  }
  currentScene = scene.name
  const startedAt = Date.now()
  try {
    await executeScene(scene, entry, file)
    if (entry.bytes == null) throw new Error('场景结束但没有产出截图')
  } catch (e) {
    entry.ok = false
    entry.error = e && e.message ? e.message : String(e)
    entry.notes.push('ERROR: ' + entry.error)
    if (scene.group === 'echo') echoSession = null
  } finally {
    await thawIfFrozen().catch(() => {})
  }
  entry.durationMs = Date.now() - startedAt
  entry.consoleErrors = consoleErrors.filter((x) => x.scene === scene.name)
  entry.consoleWarnings = consoleWarnings.filter((x) => x.scene === scene.name)
  if (entry.bytes != null) {
    entry.ok = !entry.error
    if (entry.pixelStats && entry.pixelStats.verdict === 'blank') {
      entry.ok = false
      entry.notes.push('像素分析判定为全黑/空白图')
    }
    if (entry.bytes < 50000) {
      entry.smallFile = true
      entry.notes.push('PNG 只有 ' + entry.bytes + ' 字节（< 50KB），建议人工看一眼')
    }
    if (entry.pngWidth !== opts.width || entry.pngHeight !== opts.height) {
      entry.notes.push(`PNG 尺寸 ${entry.pngWidth}x${entry.pngHeight} 与请求 ${opts.width}x${opts.height} 不一致`)
    }
    if (entry.dom && entry.dom.viewport && (entry.dom.viewport.width !== opts.width || entry.dom.viewport.height !== opts.height)) {
      entry.notes.push(`页面 innerWidth/innerHeight = ${entry.dom.viewport.width}x${entry.dom.viewport.height}，与请求视口不一致`)
    }
  }
  return entry
}

function printSceneLine(entry) {
  const parts = []
  parts.push(entry.ok ? '[ok]' : '[FAIL]')
  parts.push(entry.name.padEnd(11))
  parts.push(entry.bytes != null ? String(Math.round(entry.bytes / 1024) + 'KB').padStart(6) : '     -')
  if (entry.pixelStats) parts.push('nonDark=' + String(entry.pixelStats.nonDarkRatio).padEnd(7))
  if (entry.frozen) parts.push('frozen')
  if (entry.stateAtShot) parts.push('state=' + entry.stateAtShot)
  if (entry.chargePctBefore != null) parts.push('pct=' + entry.chargePctBefore + '%')
  parts.push((entry.durationMs / 1000).toFixed(1) + 's')
  console.log(parts.join(' '))
  if (!entry.ok && entry.error) console.log('       ↳ ' + entry.error)
  for (const note of entry.notes) if (!/^ERROR:/.test(note)) console.log('       · ' + note)
}

/* ── 反向验证（自检）────────────────────────────────────────────────────── */

async function runSelfTest() {
  const dir = path.join(outDir, '_selftest')
  await mkdir(dir, { recursive: true })
  const blackFile = path.join(dir, 'black.html')
  const errorFile = path.join(dir, 'error.html')
  const missingFile = path.join(dir, 'missing-does-not-exist.html')
  await writeFile(blackFile, '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;background:#000;overflow:hidden}</style></head><body></body></html>')
  await writeFile(errorFile, `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#111}</style></head><body>
<script>console.error('SELFTEST_CONSOLE_ERROR')</script>
<script>setTimeout(function () { throw new Error('SELFTEST_PAGE_ERROR') }, 60)</script>
</body></html>`)
  const checks = []
  const evidence = {}
  const check = (name, pass, detail) => {
    checks.push({ name, pass: !!pass, detail })
    console.log((pass ? '[SELFTEST ok]   ' : '[SELFTEST FAIL] ') + name + (detail ? '  :: ' + detail : ''))
  }

  // 1) 纯黑页面必须被判定为 blank
  currentScene = 'selftest-black'
  await navigate(pathToFileURL(blackFile).href)
  await sleep(250)
  const blackShot = await capturePng(path.join(dir, 'black.png'))
  evidence.black = blackShot.stats
  check('black-page-detected-as-blank',
    blackShot.stats.verdict === 'blank' && blackShot.stats.maxLum < 2,
    'verdict=' + blackShot.stats.verdict + ' maxLum=' + blackShot.stats.maxLum + ' bytes=' + blackShot.bytes)

  // 2) JS 运行时错误 + console.error 必须被收集
  currentScene = 'selftest-error'
  await navigate(pathToFileURL(errorFile).href)
  await sleep(450)
  const errShot = await capturePng(path.join(dir, 'error-page.png'))
  const errLogs = consoleErrors.filter((x) => x.scene === 'selftest-error')
  evidence.errorPage = { stats: errShot.stats, errors: errLogs }
  check('console-error-captured',
    errLogs.some((x) => /SELFTEST_CONSOLE_ERROR/.test(x.text || '')),
    'captured=' + JSON.stringify(errLogs.map((x) => x.kind + ':' + x.text)).slice(0, 300))
  check('page-exception-captured',
    errLogs.some((x) => x.kind === 'exception' && /SELFTEST_PAGE_ERROR/.test(x.text || '')),
    'exceptions=' + errLogs.filter((x) => x.kind === 'exception').length)

  // 3) 不存在的文件必须报导航错误，不能假装成功
  currentScene = 'selftest-missing'
  let missingError = null
  try {
    await navigate(pathToFileURL(missingFile).href)
  } catch (e) {
    missingError = e.message
  }
  evidence.missing = { error: missingError }
  check('missing-page-navigation-error-detected',
    !!missingError && /ERR_FILE_NOT_FOUND/.test(missingError),
    String(missingError))

  // 4) 真实预览页必须被判为非 blank（防止「永远判黑」的假绿灯）
  currentScene = 'selftest-preview'
  await navigate(LINK_URL)
  await waitForApi()
  await sleep(1200)
  const preState = await readPageState()
  const previewShot = await capturePng(path.join(dir, 'preview-link.png'))
  const previewStats = previewShot.stats
  evidence.preview = previewStats
  evidence.previewState = preState
  check('real-preview-detected-as-non-blank',
    previewStats.verdict !== 'blank' && previewStats.nonDarkRatio > 0.005,
    'verdict=' + previewStats.verdict + ' nonDark=' + previewStats.nonDarkRatio + ' bytes=' + previewShot.bytes)

  // 5) 媒体模拟：headless 默认 prefers-reduced-motion=reduce，工具应模拟为 no-preference
  check('reduced-motion-emulated-off',
    preState && preState.prefersReducedMotion === false && preState.reducedClass === false,
    'matchMedia(reduce)=' + (preState && preState.prefersReducedMotion) + ' yomi-reduced=' + (preState && preState.reducedClass))

  // 6) 冻结态截图链路可用（蓄力/echo3/sync 场景都依赖它）
  currentScene = 'selftest-freeze'
  const freezeEntry = { notes: [] }
  const frozenFile = path.join(dir, 'preview-link-frozen.png')
  let frozenOk = false
  try {
    frozenOk = await freezeAndCapture(freezeEntry, frozenFile)
  } catch (e) {
    freezeEntry.notes.push(e.message)
  }
  const frozenSize = frozenOk ? await stat(frozenFile).then((s) => s.size).catch(() => 0) : 0
  check('frozen-capture-works',
    frozenOk && frozenSize > 50000 && freezeEntry.frozen === true,
    'frozen=' + frozenOk + ' bytes=' + frozenSize + (freezeEntry.notes.length ? ' notes=' + freezeEntry.notes.join('; ') : ''))
  evidence.frozenCapture = { ok: frozenOk, bytes: frozenSize, entry: freezeEntry }

  const pass = checks.every((c) => c.pass)
  const manifest = {
    kind: 'selftest',
    generatedAt: nowIso(),
    viewport: { width: opts.width, height: opts.height },
    outDir: rel(dir),
    freeze: { enabled: opts.freeze, syncFreezeDelayMs: opts.syncFreezeDelayMs },
    pass,
    checks,
    evidence,
    consoleErrors: consoleErrors.filter((x) => /^selftest-/.test(x.scene) || x.scene === '(startup)')
  }
  await writeFile(path.join(dir, 'selftest-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log('\n[shots] selftest ' + (pass ? 'PASS' : 'FAIL') + ' — ' + checks.filter((c) => c.pass).length + '/' + checks.length + ' checks; report: ' + rel(path.join(dir, 'selftest-manifest.json')))
  return pass
}

/* ── 主流程 ─────────────────────────────────────────────────────────────── */

async function withBrowser(fn) {
  const browser = await launchEdge(opts)
  try {
    client = new CdpClient(browser.target.webSocketDebuggerUrl)
    await client.connect()
    wireEventCollection(client)
    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await client.send('Log.enable')
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: opts.width,
      height: opts.height,
      deviceScaleFactor: 1,
      mobile: false
    })
    /* headless 默认 prefers-reduced-motion: reduce，会把动画全关掉；截图验收要真实动画 */
    const motion = opts.reduced ? 'reduce' : 'no-preference'
    await client.send('Emulation.setEmulatedMedia', {
      media: '',
      features: [{ name: 'prefers-reduced-motion', value: motion }]
    })
    if (opts.freeze) {
      await client.send('Page.addScriptToEvaluateOnNewDocument', { source: CLOCK_SOURCE })
      await client.send('Page.addScriptToEvaluateOnNewDocument', { source: SYNC_WATCHER_SOURCE(opts.syncFreezeDelayMs) })
    }
    const targetInfo = {
      browser: browser.version.Browser || 'unknown',
      protocolVersion: browser.version['Protocol-Version'] || '',
      port: browser.port,
      bootMs: browser.bootMs,
      emulatedMotion: motion,
      softFreeze: opts.freeze
    }
    try {
      return await fn({ browser, targetInfo })
    } finally {
      await thawIfFrozen().catch(() => {})
    }
  } finally {
    if (client) client.close()
    await closeEdge(browser, opts)
  }
}

async function main() {
  opts = parseArgs(process.argv.slice(2))
  if (opts.help) { printHelp(); return 0 }
  if (opts.list) { console.log(SCENE_NAMES.join('\n')); return 0 }

  outDir = opts.out
  await mkdir(outDir, { recursive: true })

  const result = await withBrowser(async ({ targetInfo }) => {
    if (opts.selfTest) {
      const pass = await runSelfTest()
      return { selfTest: true, pass }
    }
    const scenes = SCENES.filter((s) => !opts.only || opts.only.has(s.name))
    console.log('[shots] ' + (targetInfo.browser || 'Edge') + '  protocol ' + (targetInfo.protocolVersion || '?') + '  viewport ' + opts.width + 'x' + opts.height + '  softFreeze=' + (opts.freeze ? 'on(' + opts.syncFreezeDelayMs + 'ms sync delay)' : 'off') + '  motion=' + targetInfo.emulatedMotion + '  out ' + rel(outDir))
    console.log('[shots] 场景: ' + scenes.map((s) => s.name).join(', '))
    const entries = []
    for (const scene of scenes) {
      const entry = await runScene(scene)
      entries.push(entry)
      printSceneLine(entry)
    }
    const captured = entries.filter((e) => e.bytes != null)
    const failed = entries.filter((e) => !e.ok)
    const blank = entries.filter((e) => e.pixelStats && e.pixelStats.verdict === 'blank')
    const allErrors = entries.flatMap((e) => e.consoleErrors.map((x) => ({ ...x, scene: e.name })))
    const manifest = {
      tool: 'scripts/shots.mjs',
      kind: 'scenes',
      generatedAt: nowIso(),
      root: ROOT,
      edge: EDGE_PATH,
      target: targetInfo,
      viewport: { width: opts.width, height: opts.height },
      outDir: rel(outDir),
      freeze: {
        enabled: opts.freeze,
        syncFreezeDelayMs: opts.syncFreezeDelayMs,
        note: '交互类场景用页面级软冻结（接管 rAF/setTimeout）停在目标状态再截图；headless 软件渲染约 7fps，直接截图会漂到后续幕'
      },
      only: opts.only ? [...opts.only] : null,
      scenes: entries,
      summary: {
        requested: scenes.length,
        captured: captured.length,
        failed: failed.length,
        blank: blank.length,
        failedScenes: failed.map((e) => e.name),
        blankScenes: blank.map((e) => e.name),
        totalBytes: captured.reduce((n, e) => n + e.bytes, 0),
        totalDurationMs: entries.reduce((n, e) => n + e.durationMs, 0)
      },
      consoleErrors: allErrors,
      consoleWarnings: entries.flatMap((e) => e.consoleWarnings.map((x) => ({ ...x, scene: e.name })))
    }
    await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    console.log('\n[shots] ' + captured.length + '/' + scenes.length + ' 张已产出, ' + failed.length + ' 失败, ' + blank.length + ' 张全黑; 总字节 ' + manifest.summary.totalBytes + '; consoleErrors=' + allErrors.length)
    console.log('[shots] manifest: ' + rel(path.join(outDir, 'manifest.json')))
    if (failed.length || blank.length) {
      for (const e of failed) console.log('[shots]   FAILED ' + e.name + ': ' + (e.error || 'blank'))
      return { ok: false }
    }
    return { ok: true }
  })

  if (result.selfTest) return result.pass ? 0 : 2
  return result.ok ? 0 : 1
}

main()
  .then((code) => { process.exitCode = code })
  .catch((e) => {
    console.error('[shots] fatal: ' + (e && e.stack ? e.stack : e))
    process.exitCode = 1
  })
