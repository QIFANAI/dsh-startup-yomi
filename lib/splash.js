/* ============================================================================
 * dsh-startup-yomi — 启动序列运行时（浏览器端，零依赖）
 * ----------------------------------------------------------------------------
 *   幕一  DORMANT   黑场、信号线扫过、低频下潜
 *   幕二  LINK      蓄能核心：按住（也可连点）把环充满，画面随蓄能逐步聚焦、
 *                   拉丝、暗角收拢；蓄满时核心过载炸开，母版彻底显影
 *   幕三  ECHO      三枚残响碎片任意顺序点击；每点一枚：
 *                   碎片飞入主角胸口 → 雷击 → 主角本体回击
 *                   （头部闪避 / 发丝扬起 / 眼芒 / 残影 / 胸口印记逐级点亮）
 *                   三种碎片各有独立动作语言；六种点击顺序生成六种「残响形态」，
 *                   结局的称号、引句、光环、眼睛与音阶都不同。
 *   幕四  SYNC      同步完成：环塌缩、色散、过曝
 *   幕五  REVEAL    形态名逐字打亮 + 第二句台词落版 → 收敛为黑，交还应用
 *
 * 交互强度：full（蓄能 + 三碎片）/ quick（单击接入，自动收集）/ off（纯播放）
 * 任何阶段：Esc 或右上 SKIP 直接揭幕（allowSkip 时）。
 *
 * 配置来自 window.__DSH_YOMI__（Host 注入），预览页可直接赋值。
 * 素材基址：window.__DSH_YOMI_ASSET_BASE__ || '/dsh-yomi/asset/'。
 * 公开 API：window.__DSH_YOMI_API__ = { replay, skip, get state }
 * ========================================================================== */
(function () {
  'use strict'

  if (window.__DSH_YOMI_BOOTED__) return
  window.__DSH_YOMI_BOOTED__ = true

  var ROOT_ID = 'dsh-yomi-root'
  var ASSET = window.__DSH_YOMI_ASSET_BASE__ || '/dsh-yomi/asset/'
  var VIDEO_URL = ASSET + 'hero-loop.mp4'
  var VIDEO_WEBM_URL = ASSET + 'hero-loop.webm'
  var VIDEO_FALLBACK_URL = ASSET + 'hero.mp4'
  var POSTER_URL = ASSET + 'hero-poster.jpg'
  var BGM_URL = ASSET + 'bgm.mp3'
  var VOICE_URLS = {
    echo: ASSET + 'voice-echo.mp3',
    reveal: ASSET + 'voice-reveal.mp3'
  }
  var ECHO_LINE = '三道残响，由你拾起。'
  var REVEAL_LINES = ['顺序，就是我回来的样子。']

  var DEFAULTS = {
    enabled: true,
    mode: 'session',
    speed: 1,
    interaction: 'full',
    allowSkip: true,
    identity: 'OPERATOR',
    rank: '雷鸣的残响',
    fragments: '雷声之前|她曾在此|名字已归还',
    colorA: '#ff2d55',
    colorB: '#7a5cff',
    video: true,
    bgm: true,
    bgmVolume: 0.35,
    sfx: true,
    sfxVolume: 0.6,
    scanlines: true,
    reducedMotion: false,
    glitch: 0.6
  }

  /* ── 配置合并与夹取 ─────────────────────────────────────────────────── */
  function clamp(n, lo, hi, d) {
    n = Number(n)
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
  }
  function pickColor(s, d) {
    s = String(s || '').trim()
    return /^#[0-9a-fA-F]{3,8}$/.test(s) ? s : d
  }
  function normalize(input) {
    var src = input && typeof input === 'object' ? input : {}
    var c = {}
    for (var k in DEFAULTS) { if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) c[k] = DEFAULTS[k] }
    if (src.enabled === false || src.enabled === 'false') c.enabled = false
    if (src.mode === 'always' || src.mode === 'daily' || src.mode === 'session') c.mode = src.mode
    c.speed = clamp(src.speed, 0.6, 2, 1)
    if (src.interaction === 'quick' || src.interaction === 'off' || src.interaction === 'full') c.interaction = src.interaction
    if (src.allowSkip === false || src.allowSkip === 'false') c.allowSkip = false
    var texts = ['identity', 'rank']
    for (var i = 0; i < texts.length; i++) {
      var v = String(src[texts[i]] == null ? '' : src[texts[i]]).trim()
      if (v) c[texts[i]] = v.slice(0, 24)
    }
    if (typeof src.fragments === 'string' && src.fragments.trim()) {
      var parts = src.fragments.split('|').map(function (x) { return x.trim() }).filter(Boolean).slice(0, 3)
      if (parts.length) c.fragments = parts.join('|')
    }
    c.colorA = pickColor(src.colorA, DEFAULTS.colorA)
    c.colorB = pickColor(src.colorB, DEFAULTS.colorB)
    ;['video', 'bgm', 'sfx', 'scanlines', 'reducedMotion'].forEach(function (b) {
      if (src[b] === false || src[b] === 'false') c[b] = false
      else if (src[b] === true || src[b] === 'true') c[b] = true
    })
    c.bgmVolume = clamp(src.bgmVolume, 0, 1, DEFAULTS.bgmVolume)
    c.sfxVolume = clamp(src.sfxVolume, 0, 1, DEFAULTS.sfxVolume)
    c.glitch = clamp(src.glitch, 0, 1, DEFAULTS.glitch)
    return c
  }

  var cfg = normalize(window.__DSH_YOMI__)
  /* 预览/截图用：把序列直接停在某一幕，不自动往下走 */
  var PREVIEW_PHASE = window.__DSH_YOMI_PREVIEW_PHASE__ || ''
  var PREVIEW_CHARGE = typeof window.__DSH_YOMI_PREVIEW_CHARGE__ === 'number' ? window.__DSH_YOMI_PREVIEW_CHARGE__ : -1
  var PREVIEW_ECHO = typeof window.__DSH_YOMI_PREVIEW_ECHO__ === 'number' ? window.__DSH_YOMI_PREVIEW_ECHO__ : 0
  var PREVIEW_ORDER = String(window.__DSH_YOMI_PREVIEW_ORDER__ || '')
    .split(/[,>\s-]+/)
    .map(function (n) { return Number(n) - 1 })
    .filter(function (n) { return n >= 0 && n < 3 })
    .slice(0, 3)
  var reduced = window.__DSH_YOMI_FORCE_MOTION__ ? false
    : (cfg.reducedMotion || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches))
  var SPEED = cfg.speed
  function ms(base) { return Math.max(40, Math.round(base / SPEED)) }

  var FRAGMENTS = String(cfg.fragments).split('|').slice(0, 3)
  while (FRAGMENTS.length < 3) FRAGMENTS.push(['雷声之前', '她曾在此', '名字已归还'][FRAGMENTS.length])

  /* ── 三枚碎片的语义 / 六种顺序形态 ─────────────────────────────────────
   * 碎片 01 雷声之前：力量，红；碎片 02 她曾在此：记忆，紫；碎片 03 名字已归还：命名，金。
   * 点击顺序不是“收集进度”，而是把三种语义按先后压进主角体内，最后一次决定形态。
   * 因此六种排列必须有六种结局，而不是同一个结局换一句文案。 */
  var FRAGMENT_META = [
    { id: 'thunder', mark: '雷', label: '力量', color: cfg.colorA, pale: '#ffd7e2', eye: '#ff8fa8', dark: '#350915' },
    { id: 'memory', mark: '影', label: '记忆', color: cfg.colorB, pale: '#c9ddff', eye: '#a9c8ff', dark: '#110a35' },
    { id: 'name', mark: '名', label: '命名', color: '#ffcf7a', pale: '#fff3d0', eye: '#ffe6a6', dark: '#2c1a06' }
  ]

  var FORMS = {
    '0-1-2': {
      key: '0-1-2', name: '溯名者', en: 'THE NAME-TRACER', motif: 'crest', sigil: 0,
      quote: '雷声之前，她先叫出了自己的名字。',
      a: FRAGMENT_META[2].color, b: FRAGMENT_META[1].color, notes: [0, 4, 7]
    },
    '0-2-1': {
      key: '0-2-1', name: '执灯者', en: 'THE LAMPBEARER', motif: 'halo', sigil: 1,
      quote: '她先握住雷，再替旧影点了一盏灯。',
      a: FRAGMENT_META[2].color, b: FRAGMENT_META[0].color, notes: [0, 7, 12]
    },
    '1-0-2': {
      key: '1-0-2', name: '归雷者', en: 'THE THUNDER RETURNED', motif: 'storm', sigil: 2,
      quote: '旧影先认出她，雷才敢落下。',
      a: FRAGMENT_META[0].color, b: FRAGMENT_META[1].color, notes: [2, 5, 9]
    },
    '1-2-0': {
      key: '1-2-0', name: '拾忆者', en: 'THE MEMORY KEEPER', motif: 'ghost', sigil: 3,
      quote: '她把名字收好，才回头拾起那声雷。',
      a: FRAGMENT_META[1].color, b: FRAGMENT_META[2].color, notes: [3, 7, 10]
    },
    '2-0-1': {
      key: '2-0-1', name: '问名者', en: 'THE ASKER', motif: 'mirror', sigil: 4,
      quote: '名字先回来了，她却还在问：那是谁。',
      a: '#fff4dc', b: FRAGMENT_META[0].color, notes: [5, 8, 12]
    },
    '2-1-0': {
      key: '2-1-0', name: '余响者', en: 'THE AFTERECHO', motif: 'echo', sigil: 5,
      quote: '名字与旧影都散了，只剩雷声还在她身后。',
      a: FRAGMENT_META[2].pale, b: FRAGMENT_META[1].color, notes: [7, 10, 14]
    }
  }
  /* 形态本体：不是换文案，而是把她的轮廓按形态复制成持续残响。
     位置用页面宽高百分比，缩放/镜像交给 transform；透明度由 CSS 慢呼吸。 */
  var FORM_BODY_SPECS = {
    crest: [
      { x: 0, y: 0, o: 0.22, s: 1.055, delay: 0 }
    ],
    halo: [
      { x: 0, y: -0.008, o: 0.19, s: 1.06, delay: 0 }
    ],
    storm: [
      { x: -0.185, y: 0.004, o: 0.2, s: 1.04, delay: 0 },
      { x: 0.19, y: -0.006, o: 0.13, s: 1.05, delay: 110 }
    ],
    ghost: [
      { x: 0.11, y: 0.004, o: 0.33, s: 1.045, delay: 0 },
      { x: 0.205, y: -0.004, o: 0.2, s: 1.055, delay: 90 },
      { x: 0.3, y: 0.008, o: 0.1, s: 1.065, delay: 180 }
    ],
    mirror: [
      { x: 0.235, y: 0, o: 0.34, s: 1.05, sx: -1, delay: 0 },
      { x: -0.17, y: 0.004, o: 0.11, s: 1.045, sx: -1, delay: 120 }
    ],
    echo: [
      { x: 0.135, y: 0, o: 0.32, s: 1.045, delay: 0 },
      { x: 0.255, y: -0.004, o: 0.2, s: 1.055, delay: 80 },
      { x: -0.135, y: 0.003, o: 0.19, s: 1.05, delay: 160 },
      { x: -0.255, y: -0.003, o: 0.1, s: 1.06, delay: 240 }
    ]
  }
  var DEFAULT_FORM = FORMS['0-1-2']
  var sequence = []
  var currentForm = null

  function formFor(order) {
    var seq = (order && order.length ? order.slice(0, 3) : []).map(function (n) { return Number(n) })
    for (var i = 0; i < 3; i++) if (seq.indexOf(i) < 0) seq.push(i)
    return FORMS[seq.join('-')] || DEFAULT_FORM
  }
  function ensureForm() {
    for (var i = 0; i < 3; i++) if (sequence.indexOf(i) < 0) sequence.push(i)
    return formFor(sequence)
  }
  function setFormVars(form) {
    root.style.setProperty('--form-a', form.a)
    root.style.setProperty('--form-b', form.b)
    root.style.setProperty('--form-a-rgb', rgbCsv(form.a))
    root.style.setProperty('--form-b-rgb', rgbCsv(form.b))
    root.setAttribute('data-form', form.key)
    root.setAttribute('data-form-motif', form.motif)
    root.style.setProperty('--hero-eye', form.a)
  }

  var root = document.getElementById(ROOT_ID)
  if (!root) {
    root = document.createElement('div')
    root.id = ROOT_ID
    document.body.appendChild(root)
  }
  if (!cfg.enabled) {
    root.parentNode && root.parentNode.removeChild(root)
    document.documentElement.classList.remove('yomi-lock')
    return
  }

  /* 首屏接管：把应用本体压住，避免闪一帧登录界面 */
  root.className = 'yomi-root yomi-boot'
  document.documentElement.classList.add('yomi-lock')

  /* ── 小工具 ─────────────────────────────────────────────────────────── */
  function el(tag, cls, parent, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    if (parent) parent.appendChild(n)
    return n
  }
  function svgNode(tag, attrs, parent) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', tag)
    for (var k in attrs) n.setAttribute(k, attrs[k])
    if (parent) parent.appendChild(n)
    return n
  }
  function rnd(a, b) { return a + Math.random() * (b - a) }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }
  function smoothstep(edge0, edge1, value) {
    var t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0 || 1)))
    return t * t * (3 - 2 * t)
  }
  var wait = function (n) { return new Promise(function (r) { setTimeout(r, n) }) }
  var timers = []
  function later(fn, n) { var t = setTimeout(fn, n); timers.push(t); return t }
  function clearTimers() { timers.forEach(clearTimeout); timers = [] }

  var state = 'boot'
  var stateListeners = []
  function setState(s) {
    state = s
    root.setAttribute('data-yomi-state', s)
    stateListeners.forEach(function (f) { try { f(s) } catch (e) {} })
  }

  var HEX_A = cfg.colorA
  var HEX_B = cfg.colorB
  function hexToRgb(hex) {
    var h = String(hex || '').replace('#', '')
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
    var n = parseInt(h.slice(0, 6), 16)
    if (!Number.isFinite(n)) return { r: 255, g: 45, b: 85 }
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
  }
  function rgba(hex, a) {
    var c = hexToRgb(hex)
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')'
  }
  function rgbCsv(hex) {
    var c = hexToRgb(hex)
    return c.r + ',' + c.g + ',' + c.b
  }
  var RGB_A = hexToRgb(HEX_A)

  /* ── 声音（BGM + 合成音效）─────────────────────────────────────────── */
  var sound = (function () {
    var ac = null, analyser = null, freq = null, bgmEl = null, bgmStarted = false, sourceNode = null
    var voiceEls = {}, bgmFadeToken = 0, voiceToken = 0, voiceEndTimer = null
    var fakePhase = 0
    var chargeOsc = null, chargeGain = null, chargeFilter = null

    function ensureAudio() {
      try {
        if (!ac) {
          var AC = window.AudioContext || window.webkitAudioContext
          if (!AC) return null
          ac = new AC()
        }
        if (ac.state === 'suspended' && ac.resume) ac.resume()
        return ac
      } catch (e) { return null }
    }
    function attachBGM() {
      if (!cfg.bgm || !BGM_URL) return
      if (!bgmEl) {
        bgmEl = el('audio', 'yomi-bgm')
        bgmEl.src = BGM_URL
        bgmEl.loop = true
        bgmEl.preload = 'auto'
        bgmEl.volume = cfg.bgmVolume
        root.appendChild(bgmEl)
      }
      if (bgmStarted) return
      bgmStarted = true
      var p = bgmEl.play()
      if (p && p.catch) p.catch(function () { bgmStarted = false })
      try {
        var a = ensureAudio()
        if (a && !sourceNode) {
          sourceNode = a.createMediaElementSource(bgmEl)
          analyser = a.createAnalyser()
          analyser.fftSize = 128
          analyser.smoothingTimeConstant = 0.82
          sourceNode.connect(analyser)
          analyser.connect(a.destination)
          freq = new Uint8Array(analyser.frequencyBinCount)
        }
      } catch (e) { analyser = null }
    }
    function energy() {
      if (analyser && freq) {
        try {
          analyser.getByteFrequencyData(freq)
          var sum = 0
          for (var i = 0; i < 12; i++) sum += freq[i]
          return Math.min(1, sum / (12 * 190))
        } catch (e) { /* 掉回假拍 */ }
      }
      fakePhase += 0.016
      return 0.16 + 0.12 * (Math.sin(fakePhase * 1.7) * 0.5 + 0.5)
    }
    function rumble(strength) {
      var a = ensureAudio(); if (!cfg.sfx || !a) return
      try {
        var dur = 0.9 + strength * 0.5
        var buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate)
        var d = buf.getChannelData(0)
        for (var i = 0; i < d.length; i++) {
          var t = i / d.length
          d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.2)
        }
        var src = a.createBufferSource(); src.buffer = buf
        var lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160 + strength * 90
        var g = a.createGain(); g.gain.value = 0.5 * cfg.sfxVolume
        src.connect(lp); lp.connect(g); g.connect(a.destination)
        src.start()
      } catch (e) { /* 静默 */ }
    }
    function zap(strength) {
      var a = ensureAudio(); if (!cfg.sfx || !a) return
      try {
        var dur = 0.22
        var buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate)
        var d = buf.getChannelData(0)
        for (var i = 0; i < d.length; i++) {
          var t = i / d.length
          d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 1.6)
        }
        var src = a.createBufferSource(); src.buffer = buf
        var hp = a.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900
        var g = a.createGain(); g.gain.value = 0.22 * cfg.sfxVolume * (0.6 + strength * 0.4)
        src.connect(hp); hp.connect(g); g.connect(a.destination)
        src.start()
      } catch (e) {}
      var a2 = ensureAudio(); if (!a2) return
      try {
        var o = a2.createOscillator(); var g2 = a2.createGain()
        o.type = 'triangle'
        o.frequency.setValueAtTime(520, a2.currentTime)
        o.frequency.exponentialRampToValueAtTime(180, a2.currentTime + 0.18)
        g2.gain.setValueAtTime(0.09 * cfg.sfxVolume, a2.currentTime)
        g2.gain.exponentialRampToValueAtTime(0.0001, a2.currentTime + 0.24)
        o.connect(g2); g2.connect(a2.destination)
        o.start(); o.stop(a2.currentTime + 0.26)
      } catch (e) {}
    }
    function chime(step) {
      var a = ensureAudio(); if (!cfg.sfx || !a) return
      try {
        var notes = [523.25, 659.25, 783.99, 1046.5]
        for (var i = 0; i <= step; i++) {
          var o = a.createOscillator(); var g = a.createGain()
          var t0 = a.currentTime + i * 0.07
          o.type = 'sine'
          o.frequency.value = notes[Math.min(notes.length - 1, i)]
          g.gain.setValueAtTime(0.0001, t0)
          g.gain.exponentialRampToValueAtTime(0.11 * cfg.sfxVolume, t0 + 0.02)
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9)
          o.connect(g); g.connect(a.destination)
          o.start(t0); o.stop(t0 + 1.0)
        }
      } catch (e) {}
    }
    function click() {
      var a = ensureAudio(); if (!cfg.sfx || !a) return
      try {
        var o = a.createOscillator(); var g = a.createGain()
        var t = a.currentTime
        o.type = 'square'
        o.frequency.setValueAtTime(880, t)
        o.frequency.exponentialRampToValueAtTime(320, t + 0.09)
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(0.05 * cfg.sfxVolume, t + 0.008)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
        o.connect(g); g.connect(a.destination)
        o.start(t); o.stop(t + 0.14)
      } catch (e) {}
    }
    function tick(p) {
      var a = ensureAudio(); if (!cfg.sfx || !a) return
      try {
        var o = a.createOscillator(); var g = a.createGain()
        var t = a.currentTime
        o.type = 'sine'
        o.frequency.value = 1080 + p * 920
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(0.018 * cfg.sfxVolume, t + 0.006)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.055)
        o.connect(g); g.connect(a.destination)
        o.start(t); o.stop(t + 0.07)
      } catch (e) {}
    }
    function shimmer(strength) {
      var a = ensureAudio(); if (!cfg.sfx || !a) return
      try {
        var t = a.currentTime
        var notes = [1046.5, 1318.5, 1568, 2093]
        for (var i = 0; i < notes.length; i++) {
          var o = a.createOscillator(); var g = a.createGain()
          var t0 = t + i * 0.035
          o.type = 'sine'
          o.frequency.value = notes[i]
          g.gain.setValueAtTime(0.0001, t0)
          g.gain.exponentialRampToValueAtTime(0.032 * cfg.sfxVolume * strength, t0 + 0.02)
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9 + i * 0.12)
          o.connect(g); g.connect(a.destination)
          o.start(t0); o.stop(t0 + 1.1 + i * 0.12)
        }
      } catch (e) {}
    }
    function bell(strength) {
      var a = ensureAudio(); if (!cfg.sfx || !a) return
      try {
        var t = a.currentTime
        var freqs = [784, 1176, 1568]
        for (var i = 0; i < freqs.length; i++) {
          var o = a.createOscillator(); var g = a.createGain()
          o.type = i === 0 ? 'sine' : 'triangle'
          o.frequency.value = freqs[i]
          g.gain.setValueAtTime(0.0001, t)
          g.gain.exponentialRampToValueAtTime((0.05 / (i + 1)) * cfg.sfxVolume * strength, t + 0.008)
          g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8 + i * 0.2)
          o.connect(g); g.connect(a.destination)
          o.start(t); o.stop(t + 2.1)
        }
      } catch (e) {}
    }
    function proximity(step) {
      var a = ensureAudio(); if (!cfg.sfx || !a) return
      try {
        var o = a.createOscillator(); var g = a.createGain()
        var t = a.currentTime
        o.type = 'sine'
        o.frequency.setValueAtTime(92 + step * 10, t)
        o.frequency.exponentialRampToValueAtTime(58, t + 0.45)
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(0.055 * cfg.sfxVolume, t + 0.02)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7)
        o.connect(g); g.connect(a.destination)
        o.start(t); o.stop(t + 0.75)
      } catch (e) {}
    }
    function formChord(form) {
      var a = ensureAudio(); if (!cfg.sfx || !a) return
      try {
        var t = a.currentTime
        var roots = [261.63, 293.66, 329.63]
        for (var i = 0; i < 3; i++) {
          var semis = form && form.notes ? form.notes[i] : [0, 4, 7][i]
          var o = a.createOscillator(); var g = a.createGain()
          var t0 = t + i * 0.13
          o.type = 'sine'
          o.frequency.value = roots[i % roots.length] * Math.pow(2, semis / 12)
          g.gain.setValueAtTime(0.0001, t0)
          g.gain.exponentialRampToValueAtTime(0.075 * cfg.sfxVolume, t0 + 0.03)
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.2)
          o.connect(g); g.connect(a.destination)
          o.start(t0); o.stop(t0 + 2.3)
        }
      } catch (e) {}
    }
    /* 蓄能上升音：一条锯齿波 + 低通，随蓄能抬高频率与音量 */
    function startCharge() {
      var a = ensureAudio(); if (!cfg.sfx || !a || chargeOsc) return
      try {
        chargeOsc = a.createOscillator()
        chargeFilter = a.createBiquadFilter()
        chargeGain = a.createGain()
        chargeOsc.type = 'sawtooth'
        chargeOsc.frequency.value = 46
        chargeFilter.type = 'lowpass'
        chargeFilter.frequency.value = 220
        chargeFilter.Q.value = 9
        chargeGain.gain.value = 0.0001
        chargeGain.gain.setTargetAtTime(0.045 * cfg.sfxVolume, a.currentTime, 0.12)
        chargeOsc.connect(chargeFilter)
        chargeFilter.connect(chargeGain)
        chargeGain.connect(a.destination)
        chargeOsc.start()
      } catch (e) { chargeOsc = null }
    }
    function updateCharge(p) {
      if (!chargeOsc || !ac) return
      try {
        var t = ac.currentTime
        chargeOsc.frequency.setTargetAtTime(46 + p * 196, t, 0.06)
        chargeFilter.frequency.setTargetAtTime(220 + p * 1800, t, 0.08)
        chargeGain.gain.setTargetAtTime((0.028 + p * 0.075) * cfg.sfxVolume, t, 0.06)
      } catch (e) {}
    }
    function stopCharge() {
      if (!chargeOsc) return
      try {
        var t = ac.currentTime
        chargeGain.gain.cancelScheduledValues(t)
        chargeGain.gain.setTargetAtTime(0.0001, t, 0.045)
      } catch (e) {}
      var old = chargeOsc
      chargeOsc = null
      setTimeout(function () { try { old.stop() } catch (e) {} }, 300)
    }
    function fadeBgm(target, duration) {
      if (!bgmEl) return
      var token = ++bgmFadeToken
      try {
        var from = bgmEl.volume, t0 = performance.now(), dur = Math.max(80, duration || 900)
        ;(function fade() {
          if (token !== bgmFadeToken || !bgmEl) return
          var k = Math.min(1, (performance.now() - t0) / dur)
          bgmEl.volume = from + (target - from) * k
          if (k < 1) requestAnimationFrame(fade)
        })()
      } catch (e) {}
    }
    function duck(on, duration) {
      var level = on ? 0.35 : 1
      fadeBgm(cfg.bgmVolume * level, duration || (on ? 620 : 1200))
    }
    /* ECHO 与 REVEAL 各用一段独立语音（文件名即台词），从 0.02s 起播到自然结束。 */
    var VOICE_CUES = {
      echo: { start: 0.02 },
      reveal: { start: 0.02 }
    }
    function playVoice(kind) {
      var url = VOICE_URLS[kind] || VOICE_URLS.reveal
      if (!url) return
      var cue = VOICE_CUES[kind] || VOICE_CUES.reveal
      var token = ++voiceToken
      try {
        var voiceEl = voiceEls[kind]
        if (!voiceEl) {
          voiceEl = voiceEls[kind] = el('audio', 'yomi-voice')
          voiceEl.src = url
          voiceEl.preload = 'auto'
          voiceEl.volume = 0
          root.appendChild(voiceEl)
        }
        voiceEl.onerror = function () { if (token === voiceToken) duck(false, 900) }
        /* 同一时刻只允许一路语音：另一句若还在播，先停掉。 */
        Object.keys(voiceEls).forEach(function (k) {
          if (k === kind) return
          try { voiceEls[k].pause(); voiceEls[k].currentTime = 0 } catch (e) {}
        })
        if (voiceEndTimer) { clearTimeout(voiceEndTimer); voiceEndTimer = null }
        voiceEl.onended = function () {
          if (token !== voiceToken) return
          duck(false, 1200)
        }
        var begin = function () {
          if (token !== voiceToken) return
          try { voiceEl.currentTime = cue.start } catch (e) {}
          voiceEl.volume = 0
          duck(true, 620)
          var started = voiceEl.play()
          if (started && started.catch) started.catch(function () {
            if (token === voiceToken) duck(false, 900)
          })
          var t0 = performance.now(), dur = 700
          ;(function fadeIn() {
            if (token !== voiceToken) return
            var k = Math.min(1, (performance.now() - t0) / dur)
            try { voiceEl.volume = Math.min(0.92, k * 0.92) } catch (e) {}
            if (k < 1) requestAnimationFrame(fadeIn)
          })()
          /* timeupdate 在部分宿主里粒度很粗；定时器按实际时长兜底归还 BGM。 */
          var span = (Number.isFinite(voiceEl.duration) && voiceEl.duration > cue.start)
            ? (voiceEl.duration - cue.start) * 1000
            : 6000
          voiceEndTimer = setTimeout(function () {
            if (token !== voiceToken) return
            voiceToken += 1
            try { voiceEl.pause() } catch (e) {}
            duck(false, 1000)
          }, Math.max(450, span + 260))
        }
        if (voiceEl.readyState >= 1) begin()
        else voiceEl.addEventListener('loadedmetadata', begin, { once: true })
      } catch (e) { duck(false, 900) }
    }
    function stop() {
      stopCharge()
      Object.keys(voiceEls).forEach(function (k) {
        try { voiceEls[k].pause() } catch (e) {}
      })
      try { if (bgmEl) bgmEl.pause() } catch (e) {}
    }
    return {
      attachBGM: attachBGM, energy: energy, rumble: rumble, zap: zap, click: click,
      tick: tick, shimmer: shimmer, bell: bell, proximity: proximity, formChord: formChord,
      chime: chime, duck: duck, playVoice: playVoice, stop: stop, ensureAudio: ensureAudio,
      startCharge: startCharge, updateCharge: updateCharge, stopCharge: stopCharge
    }
  })()

  /* ── DOM 结构 ───────────────────────────────────────────────────────── */
  var stage = el('div', 'yomi-stage', root)

  /* 主角反应层：气焰 / 眼芒 / 印记 / 光柱 / 色散条 / 过曝 */
  var heroFx = el('div', 'yomi-hero', stage)
  var heroGhosts = el('div', 'yomi-hero-ghosts', stage)
  var formBody = el('div', 'yomi-form-body', stage)
  var heroAura = el('div', 'yomi-hero-aura', heroFx)
  var heroAura2 = el('div', 'yomi-hero-aura2', heroFx)
  var heroGround = el('div', 'yomi-hero-ground', heroFx)
  var heroRim = el('div', 'yomi-hero-rim', heroFx)
  var heroEyes = el('div', 'yomi-hero-eyes', heroFx)
  var eyeL = el('i', 'yomi-eye yomi-eye-l', heroEyes)
  var eyeR = el('i', 'yomi-eye yomi-eye-r', heroEyes)
  var heroSeed = el('span', 'yomi-hero-seed', heroFx)
  var heroSigil = el('div', 'yomi-hero-sigil', heroFx)
  var sigilSvg = svgNode('svg', { viewBox: '0 0 320 320', class: 'yomi-sigil-svg' }, heroSigil)
  var SIG = { cx: 160, cy: 160 }
  svgNode('circle', { cx: 160, cy: 160, r: 150, class: 'yomi-sigil-dash' }, sigilSvg)
  svgNode('circle', { cx: 160, cy: 160, r: 128, class: 'yomi-sigil-line' }, sigilSvg)
  svgNode('circle', { cx: 160, cy: 160, r: 92, class: 'yomi-sigil-line yomi-sigil-line2' }, sigilSvg)
  svgNode('circle', { cx: 160, cy: 160, r: 56, class: 'yomi-sigil-core' }, sigilSvg)
  var sigilTicks = svgNode('g', { class: 'yomi-sigil-ticks' }, sigilSvg)
  for (var si = 0; si < 48; si++) {
    var sa = (si / 48) * Math.PI * 2
    var sr1 = si % 4 === 0 ? 134 : 140
    svgNode('line', {
      x1: (160 + Math.cos(sa) * sr1).toFixed(2), y1: (160 + Math.sin(sa) * sr1).toFixed(2),
      x2: (160 + Math.cos(sa) * 150).toFixed(2), y2: (160 + Math.sin(sa) * 150).toFixed(2),
      class: si % 4 === 0 ? 'yomi-sigil-tick yomi-sigil-tick-major' : 'yomi-sigil-tick'
    }, sigilTicks)
  }
  /* 胸口的三枚语义刻印：点击顺序会决定它们亮起的顺序 */
  var crestThunder = svgNode('g', { class: 'yomi-crest-glyph yomi-crest-thunder', transform: 'translate(17.2 47.2) scale(0.58)' }, sigilSvg)
  svgNode('path', { d: 'M160 104 L144 154 L159 154 L147 198 L181 142 L164 142 L176 104 Z', class: 'yomi-crest-line' }, crestThunder)
  svgNode('path', { d: 'M128 128 Q118 160 128 192 M192 128 Q202 160 192 192', class: 'yomi-crest-arc' }, crestThunder)
  var crestMemory = svgNode('g', { class: 'yomi-crest-glyph yomi-crest-memory', transform: 'translate(67.2 67.2) scale(0.58)' }, sigilSvg)
  svgNode('path', { d: 'M118 160 A42 42 0 0 1 202 160 A42 42 0 0 1 118 160 Z', class: 'yomi-crest-line' }, crestMemory)
  svgNode('path', { d: 'M132 160 A28 28 0 0 1 188 160 A28 28 0 0 1 132 160 Z', class: 'yomi-crest-arc' }, crestMemory)
  svgNode('circle', { cx: 160, cy: 160, r: 8, class: 'yomi-crest-dot' }, crestMemory)
  var crestName = svgNode('g', { class: 'yomi-crest-glyph yomi-crest-name', transform: 'translate(117.2 47.2) scale(0.58)' }, sigilSvg)
  svgNode('path', { d: 'M160 106 L202 160 L160 214 L118 160 Z', class: 'yomi-crest-line' }, crestName)
  svgNode('path', { d: 'M160 122 L160 198 M128 160 L192 160', class: 'yomi-crest-arc' }, crestName)
  var heroHalo = el('div', 'yomi-hero-halo', heroFx)
  el('span', 'yomi-halo-ring yomi-halo-ring-a', heroHalo)
  el('span', 'yomi-halo-ring yomi-halo-ring-b', heroHalo)
  el('span', 'yomi-halo-ring yomi-halo-ring-c', heroHalo)
  var heroBeam = el('div', 'yomi-hero-beam', heroFx)
  var heroGlitch = el('div', 'yomi-hero-glitch', heroFx)
  var heroFlash = el('div', 'yomi-hero-flash', heroFx)
  var heroPillar = el('div', 'yomi-name-pillar', heroFx)

  /* 三种点击语言各有自己的物理事实：雷是裂痕与后坐，影是倒带与冻结，名是金色光柱。 */
  var memoryRewind = el('div', 'yomi-memory-rewind-layer', stage)
  for (var mw = 0; mw < 5; mw++) el('span', 'yomi-rewind-col', memoryRewind, '03 02 01 00 07 06 05')
  var crackLayer = el('div', 'yomi-crack-layer', root)
  el('span', 'yomi-crack yomi-crack-a', crackLayer)
  el('span', 'yomi-crack yomi-crack-b', crackLayer)

  var video = null
  var videoWrap = null
  var heroStill = null
  var posterImg = null
  var posterReady = false
  var canvas = el('canvas', 'yomi-canvas', root)
  var ctx2d = canvas.getContext('2d')
  var fxLayer = el('div', 'yomi-fx', root)

  var hud = el('div', 'yomi-hud', root)
  var hudTop = el('div', 'yomi-hud-top', hud)
  var brand = el('div', 'yomi-brand', hudTop)
  el('span', 'yomi-brand-cn', brand, '黄泉')
  el('span', 'yomi-brand-sep', brand, '/')
  el('span', 'yomi-brand-en', brand, 'YOMI')
  var status = el('div', 'yomi-status', hudTop)
  var statusDot = el('i', 'yomi-dot', status)
  var statusText = el('span', 'yomi-status-text', status, 'SIGNAL LOST')
  var skipBtn = el('button', 'yomi-skip', hudTop, '跳过 SKIP')
  skipBtn.type = 'button'
  if (!cfg.allowSkip) skipBtn.style.display = 'none'

  var hudBottom = el('div', 'yomi-hud-bottom', hud)
  var logBox = el('div', 'yomi-log', hudBottom)
  var syncBox = el('div', 'yomi-sync', hudBottom)
  el('div', 'yomi-sync-label', syncBox, 'SYNC')
  var syncNum = el('div', 'yomi-sync-num', syncBox, '00')
  var syncBar = el('div', 'yomi-sync-bar', syncBox)
  var syncFill = el('div', 'yomi-sync-fill', syncBar)
  var hudTicks = el('div', 'yomi-hud-ticks', syncBox)
  for (var ht = 0; ht < 3; ht++) el('i', 'yomi-hud-tick', hudTicks)
  var syncForm = el('div', 'yomi-sync-form', syncBox)
  el('span', 'yomi-sync-form-k', syncForm, 'FORM LOCKED')
  var syncFormName = el('span', 'yomi-sync-form-n', syncForm, '')

  var linkLayer = el('div', 'yomi-link', root)
  var linkEyebrow = el('div', 'yomi-eyebrow', linkLayer, 'SHE IS WAITING // 03 ECHOES')
  var linkTitle = el('div', 'yomi-link-title', linkLayer, '由你拾起')
  var linkSub = el('div', 'yomi-link-sub', linkLayer, 'LINK TO HER')
  var linkHint = el('div', 'yomi-link-hint', linkLayer, '三道残响，只等你接通。')

  /* ── 蓄能核心（这一幕唯一的主角）────────────────────────────────────── */
  var chargeWrap = el('div', 'yomi-charge', root)
  var core = el('button', 'yomi-core', chargeWrap)
  core.type = 'button'
  core.setAttribute('aria-label', '按住，听她回应')
  var coreAfford = el('span', 'yomi-core-afford', core)
  var chargeSvg = svgNode('svg', { viewBox: '0 0 240 240', class: 'yomi-charge-ring' }, core)
  svgNode('circle', { cx: 120, cy: 120, r: 104, class: 'yomi-charge-track' }, chargeSvg)
  var chargeArc = svgNode('circle', { cx: 120, cy: 120, r: 104, class: 'yomi-charge-arc' }, chargeSvg)
  var chargeOrbit = svgNode('circle', { cx: 120, cy: 120, r: 114, class: 'yomi-charge-orbit' }, chargeSvg)
  var chargeOrbit2 = svgNode('circle', { cx: 120, cy: 120, r: 88, class: 'yomi-charge-orbit yomi-charge-orbit2' }, chargeSvg)
  var chargeTicks = svgNode('g', { class: 'yomi-charge-ticks' }, chargeSvg)
  var chargeTickEls = []
  for (var ti = 0; ti < 36; ti++) {
    var ang = (ti / 36) * Math.PI * 2
    var r1 = ti % 3 === 0 ? 89 : 92
    var line = svgNode('line', {
      x1: (120 + Math.cos(ang) * r1).toFixed(2),
      y1: (120 + Math.sin(ang) * r1).toFixed(2),
      x2: (120 + Math.cos(ang) * 98).toFixed(2),
      y2: (120 + Math.sin(ang) * 98).toFixed(2),
      class: 'yomi-tick'
    }, chargeTicks)
    chargeTickEls.push(line)
  }
  var coreHalo = el('span', 'yomi-core-halo', core)
  var corePulse = el('span', 'yomi-core-pulse', core)
  var coreComet = el('span', 'yomi-core-comet', core)
  var coreBody = el('span', 'yomi-core-body', core)
  var coreText = el('span', 'yomi-core-text', core)
  var chargeCn = el('span', 'yomi-charge-cn', coreText, '按住')
  var chargePct = el('span', 'yomi-charge-pct', coreText, '0%')
  var chargeEn = el('span', 'yomi-charge-en', coreText, 'HOLD')
  var chargeHint = el('div', 'yomi-core-hint', chargeWrap, '按住，听她回应。')
  var chargeKeys = el('div', 'yomi-core-keys', chargeWrap, '左键 / 空格 / 回车')
  /* 测试与样式契约：保留旧类名的同名节点 */
  chargeSvg.classList.add('yomi-charge-ring')

  var echoLayer = el('div', 'yomi-echo', root)
  var echoHead = el('div', 'yomi-echo-head', echoLayer)
  el('div', 'yomi-eyebrow', echoHead, 'THREE ECHOES // YOUR ORDER')
  el('div', 'yomi-echo-title', echoHead, '三道残响')
  var echoSub = el('div', 'yomi-echo-sub', echoHead, '选择顺序。她会按你留下的方式回来。 · 00 / 03')
  var echoVoice = el('div', 'yomi-echo-voice', echoLayer)
  echoVoice.setAttribute('aria-live', 'polite')
  el('span', 'yomi-echo-voice-k', echoVoice, 'YOMI // 回应')
  var echoVoiceText = el('span', 'yomi-echo-voice-text', echoVoice, ECHO_LINE)
  var orderBox = el('div', 'yomi-order', root)
  el('span', 'yomi-order-label', orderBox, 'YOUR ORDER / 残响谱')
  var orderTrack = el('div', 'yomi-order-track', orderBox)
  var orderSlots = []
  for (var osi = 0; osi < 3; osi++) {
    var oslot = el('div', 'yomi-order-slot', orderTrack)
    var osMark = el('span', 'yomi-order-mark', oslot, '·')
    var osIdx = el('span', 'yomi-order-idx', oslot, '—')
    orderSlots.push({ el: oslot, mark: osMark, idx: osIdx })
  }
  var orderForm = el('div', 'yomi-order-form', orderBox, '顺序未定')

  var tetherSvg = svgNode('svg', { class: 'yomi-tethers' }, echoLayer)
  var tetherPaths = []
  var tetherGlows = []
  for (var tee = 0; tee < 3; tee++) {
    tetherGlows.push(svgNode('path', { class: 'yomi-tether-glow' }, tetherSvg))
    tetherPaths.push(svgNode('path', { class: 'yomi-tether' }, tetherSvg))
  }

  var nodesBox = el('div', 'yomi-nodes', echoLayer)
  var nodeEls = []
  var nodePos = [
    { x: 19, y: 47 },
    { x: 82, y: 40 },
    { x: 27, y: 79 }
  ]
  for (var ni = 0; ni < 3; ni++) {
    (function (idx) {
      var node = el('button', 'yomi-node', nodesBox)
      node.type = 'button'
      node.style.setProperty('--nx', nodePos[idx].x + '%')
      node.style.setProperty('--ny', nodePos[idx].y + '%')
      node.style.setProperty('--node-i', String(idx))
      node.style.setProperty('--node-color', FRAGMENT_META[idx].color)
      node.classList.add('yomi-node--' + FRAGMENT_META[idx].id)
      var orbit = el('span', 'yomi-node-orbit', node)
      var orbit2 = el('span', 'yomi-node-orbit2', node)
      var dia = el('span', 'yomi-node-dia', node)
      el('span', 'yomi-node-idx', dia, '0' + (idx + 1))
      var label = el('span', 'yomi-node-label', node, FRAGMENTS[idx])
      var meta = el('span', 'yomi-node-meta', node, 'FRAGMENT / 0' + (idx + 1))
      node.setAttribute('aria-label', '残响碎片 ' + (idx + 1) + ': ' + FRAGMENTS[idx])
      node.addEventListener('click', function (ev) {
        ev.stopPropagation()
        collectNode(idx)
      })
      node.addEventListener('pointerenter', function () {
        if (state !== 'echo') return
        root.classList.add('yomi-node-hover')
        root.style.setProperty('--preview-color', FRAGMENT_META[idx].color)
        root.classList.add('yomi-preview-' + FRAGMENT_META[idx].id)
        if (tetherPaths[idx]) tetherPaths[idx].classList.add('yomi-tether-hot')
        if (tetherGlows[idx]) tetherGlows[idx].classList.add('yomi-tether-glow-hot')
      })
      node.addEventListener('pointerleave', function () {
        root.classList.remove('yomi-node-hover')
        root.classList.remove('yomi-preview-thunder', 'yomi-preview-memory', 'yomi-preview-name')
        if (tetherPaths[idx]) tetherPaths[idx].classList.remove('yomi-tether-hot')
        if (tetherGlows[idx]) tetherGlows[idx].classList.remove('yomi-tether-glow-hot')
      })
      nodeEls.push({ node: node, dia: dia, label: label, meta: meta, orbit: orbit, done: false })
    })(ni)
  }

  var revealLayer = el('div', 'yomi-reveal', root)
  var revealPortal = el('div', 'yomi-reveal-portal', revealLayer)
  for (var rp = 0; rp < 3; rp++) el('span', 'yomi-portal-ring', revealPortal)
  var revealEyebrow = el('div', 'yomi-eyebrow', revealLayer, 'LINK ESTABLISHED')
  var revealHello = el('div', 'yomi-reveal-hello', revealLayer, '欢迎回来')
  var revealName = el('div', 'yomi-reveal-name', revealLayer, cfg.identity)
  var revealRule = el('div', 'yomi-reveal-rule', revealLayer)
  var revealRank = el('div', 'yomi-reveal-rank', revealLayer, cfg.rank)
  var revealIdentity = el('div', 'yomi-reveal-identity', revealLayer, '')
  var revealForm = el('div', 'yomi-reveal-form', revealLayer)
  var revealFormK = el('span', 'yomi-reveal-form-k', revealForm, 'FORM / 03')
  var revealFormName = el('span', 'yomi-reveal-form-name', revealForm, '')
  var revealFormEn = el('span', 'yomi-reveal-form-en', revealForm, '')
  var revealOrder = el('div', 'yomi-reveal-order', revealForm)
  var revealOrderSlots = []
  for (var ro = 0; ro < 3; ro++) revealOrderSlots.push(el('span', 'yomi-reveal-order-slot', revealOrder, '—'))
  var revealQuote = el('div', 'yomi-reveal-quote', revealLayer, '')
  var revealQuoteLines = []
  for (var rq = 0; rq < REVEAL_LINES.length; rq++) {
    revealQuoteLines.push(el('span', 'yomi-reveal-quote-line', revealQuote, REVEAL_LINES[rq]))
  }
  var revealEn = el('div', 'yomi-reveal-en', revealLayer, 'WELCOME BACK')

  var flash = el('div', 'yomi-flash', root)
  var scan = el('div', 'yomi-scan', root)
  var glitchBars = el('div', 'yomi-glitchbars', root)

  /* 视觉变量 */
  root.style.setProperty('--yomi-a', cfg.colorA)
  root.style.setProperty('--yomi-b', cfg.colorB)
  root.style.setProperty('--yomi-glitch', String(cfg.glitch))
  root.style.setProperty('--yomi-charge', '0')
  root.style.setProperty('--hero-x', '54.5%')
  root.style.setProperty('--hero-y', '56%')
  root.style.setProperty('--hero-eye', FRAGMENT_META[0].eye)
  root.style.setProperty('--hero-last', FRAGMENT_META[0].color)
  root.style.setProperty('--hero-last-rgb', rgbCsv(FRAGMENT_META[0].color))
  root.style.setProperty('--form-a', FRAGMENT_META[2].color)
  root.style.setProperty('--form-b', FRAGMENT_META[1].color)
  if (!cfg.scanlines) root.classList.add('yomi-no-scan')
  if (reduced) root.classList.add('yomi-reduced')

  /* 主角轮廓：供残影快照与头部呼吸层共用。
     用 objectBoundingBox 坐标，随视频/画布缩放自动跟随，而不是写死像素。 */
  var clipSvg = svgNode('svg', { class: 'yomi-clip-defs', width: '0', height: '0', 'aria-hidden': 'true' }, root)
  var clipDefs = svgNode('defs', {}, clipSvg)
  var heroClip = svgNode('clipPath', { id: 'yomi-hero-clip', clipPathUnits: 'objectBoundingBox' }, clipDefs)
  svgNode('path', {
    d: 'M0.50 0.065 L0.552 0.070 L0.585 0.108 L0.600 0.158 L0.608 0.220 L0.607 0.282 ' +
       'L0.598 0.342 L0.602 0.392 L0.614 0.452 L0.622 0.520 L0.624 0.582 L0.632 0.638 ' +
       'L0.641 0.690 L0.644 0.760 L0.642 0.840 L0.638 1.000 L0.600 1.000 L0.585 0.900 ' +
       'L0.574 1.000 L0.430 1.000 L0.414 0.890 L0.395 0.800 L0.374 0.730 L0.354 0.660 ' +
       'L0.342 0.580 L0.338 0.500 L0.342 0.420 L0.350 0.330 L0.365 0.250 L0.385 0.180 ' +
       'L0.415 0.120 L0.450 0.082 Z'
  }, heroClip)

  /* ── 视频母版 ───────────────────────────────────────────────────────── */
  function setupVideo() {
    /* 角色永久层：母版只是她的动态皮肤，不能因为解码失败把整个人删掉。
       海报先铺底；视频可用时覆盖在上，视频不可用时它继续承担 LINK/ECHO/终帧。 */
    videoWrap = el('div', 'yomi-video', stage)
    stage.insertBefore(videoWrap, heroFx)
    heroStill = el('img', 'yomi-hero-still', videoWrap)
    heroStill.alt = ''
    heroStill.draggable = false
    heroStill.setAttribute('aria-hidden', 'true')
    posterImg = heroStill
    heroStill.onload = function () {
      posterReady = true
      root.classList.add('yomi-still-live')
      if (currentForm) buildFormBody(currentForm)
    }
    heroStill.onerror = function () {
      posterReady = false
      root.classList.add('yomi-still-missing')
    }
    heroStill.src = POSTER_URL

    if (!cfg.video) {
      root.classList.add('yomi-no-video', 'yomi-video-off')
      return
    }

    video = el('video', 'yomi-video-el', videoWrap)
    video.poster = POSTER_URL
    video.muted = true
    video.loop = true
    video.autoplay = true
    video.playsInline = true
    video.setAttribute('muted', '')
    video.setAttribute('playsinline', '')
    video.setAttribute('aria-hidden', 'true')
    var sources = []
    var canMp4 = false
    try { canMp4 = !!video.canPlayType('video/mp4; codecs="avc1.42E01E"') } catch (e) {}
    if (canMp4) sources = [VIDEO_URL, VIDEO_WEBM_URL, VIDEO_FALLBACK_URL]
    else sources = [VIDEO_WEBM_URL, VIDEO_URL, VIDEO_FALLBACK_URL]
    sources = sources.filter(function (src, idx) { return !!src && sources.indexOf(src) === idx })
    var sourceTried = 0

    function failBase() {
      try { if (video && video.parentNode) video.parentNode.removeChild(video) } catch (e) {}
      video = null
      root.classList.remove('yomi-video-live')
      root.classList.add('yomi-no-video', 'yomi-video-failed')
    }

    function playSource() {
      if (!video) return
      try {
        video.load()
        var p = video.play()
        if (p && p.catch) p.catch(function () { /* 自动播放被拦时仍显示 poster/still */ })
      } catch (e) {}
    }

    function tryNextSource() {
      if (!video || sourceTried >= sources.length) { failBase(); return false }
      video.src = sources[sourceTried++]
      playSource()
      return true
    }

    video.addEventListener('error', function () {
      root.classList.remove('yomi-video-live')
      /* Electron 可能不认 H.264；依次尝试 WebM / 主母版 / 原始母版，最后保留海报本体。 */
      tryNextSource()
    })
    /* 只有一路视频解码。细小的呼吸感由 CSS 完成，避免双视频 timeupdate 漂移。 */
    video.addEventListener('loadeddata', function () {
      try {
        video.classList.add('yomi-video-live')
        root.classList.add('yomi-video-live')
      } catch (e) {}
    })
    tryNextSource()
  }
  setupVideo()

  /* ── Canvas：雷弧 / 粒子 / 冲击环 / 镜头抖动 ─────────────────────────── */
  var DPR = Math.min(2, window.devicePixelRatio || 1)
  var cw = 0, ch = 0
  var coreCenter = null
  function resize() {
    cw = window.innerWidth
    ch = window.innerHeight
    canvas.width = Math.floor(cw * DPR)
    canvas.height = Math.floor(ch * DPR)
    canvas.style.width = cw + 'px'
    canvas.style.height = ch + 'px'
    ctx2d.setTransform(DPR, 0, 0, DPR, 0, 0)
    measureCore()
    refreshTethers()
  }
  function measureCore() {
    if (!chargeWrap || state === 'boot') return
    try {
      var r = core.getBoundingClientRect()
      if (r.width > 0) coreCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 }
    } catch (e) { /* noop */ }
  }

  var particles = []
  var bolts = []
  var shockwaves = []
  var shake = 0
  var pointer = { x: 0.5, y: 0.5, active: false, down: false }
  var energy = 0.2
  var lastSpawn = 0
  var heroPulseT = 0
  var strandImpulse = 0
  var heroBeatT = 0
  var heroLastColor = HEX_A
  var tNow = 0
  var lastTs = 0
  var frame = 0

  function addParticle(p) {
    if (particles.length > 560) return
    particles.push(p)
  }
  function burst(x, y, opts) {
    opts = opts || {}
    var count = opts.count || 16
    var sp0 = opts.sp0 || 60
    var sp1 = opts.sp1 || 320
    var color = opts.color || HEX_A
    var kind = opts.kind || 'spark'
    for (var i = 0; i < count; i++) {
      var a = opts.dir != null ? opts.dir + rnd(-0.9, 0.9) : rnd(0, Math.PI * 2)
      var sp = rnd(sp0, sp1)
      addParticle({
        kind: kind,
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 1,
        decay: rnd(opts.decay0 || 1.2, opts.decay1 || 2.4),
        size: rnd(opts.size0 || 1, opts.size1 || 3.2),
        color: color,
        drag: opts.drag != null ? opts.drag : 1.4,
        grav: opts.grav != null ? opts.grav : 40,
        spin: rnd(-6, 6),
        rot: rnd(0, 6.28)
      })
    }
  }
  function shockwave(x, y, opts) {
    opts = opts || {}
    shockwaves.push({
      x: x, y: y,
      r: opts.r0 || 8,
      speed: opts.speed || 620,
      life: 1,
      decay: opts.decay || 1.15,
      width: opts.width || 2.2,
      color: opts.color || HEX_A,
      wobble: opts.wobble || 0
    })
  }
  function spawnBolt(x0, y0, x1, y1, strength, hue) {
    var pts = [], segs = 11
    for (var i = 0; i <= segs; i++) {
      var t = i / segs
      var jitter = (Math.random() - 0.5) * (1 - Math.abs(t - 0.5) * 1.15) * 130 * strength
      pts.push({
        x: x0 + (x1 - x0) * t + jitter,
        y: y0 + (y1 - y0) * t + (Math.random() - 0.5) * 34 * strength
      })
    }
    bolts.push({
      pts: pts,
      life: 1,
      decay: rnd(1.6, 2.9),
      width: rnd(0.9, 2.2),
      strength: strength,
      color: hue || HEX_A
    })
  }
  function spawnChain(x0, y0, x1, y1, strength) {
    spawnBolt(x0, y0, x1, y1, strength)
    var mx = (x0 + x1) / 2 + rnd(-90, 90)
    var my = (y0 + y1) / 2 + rnd(-90, 90)
    spawnBolt(x0, y0, mx, my, strength * 0.7)
    spawnBolt(mx, my, x1, y1, strength * 0.7)
  }

  function tracePath(pts) {
    ctx2d.beginPath()
    ctx2d.moveTo(pts[0].x, pts[0].y)
    for (var i = 1; i < pts.length; i++) ctx2d.lineTo(pts[i].x, pts[i].y)
  }
  function drawBolt(b) {
    var a = Math.pow(Math.max(0, b.life), 1.3)
    var forkCount = b.strength > 0.9 ? 3 : 2
    ctx2d.save()
    ctx2d.lineCap = 'round'
    ctx2d.lineJoin = 'round'
    ctx2d.globalCompositeOperation = 'lighter'
    ctx2d.shadowBlur = 18
    ctx2d.shadowColor = b.color
    ctx2d.strokeStyle = rgba(b.color, 0.26 * a)
    ctx2d.lineWidth = Math.max(2, b.width * 5)
    tracePath(b.pts)
    ctx2d.stroke()
    ctx2d.strokeStyle = 'rgba(255,240,248,' + (a * 0.9).toFixed(3) + ')'
    ctx2d.lineWidth = Math.max(0.7, b.width)
    tracePath(b.pts)
    ctx2d.stroke()
    for (var f = 0; f < forkCount; f++) {
      var startIdx = Math.floor(b.pts.length * (0.25 + f * 0.2))
      if (startIdx >= b.pts.length - 1) break
      var sp = b.pts[startIdx]
      var dir = Math.random() < 0.5 ? -1 : 1
      var bx = sp.x + dir * rnd(18, 80)
      var by = sp.y + rnd(20, 110)
      ctx2d.globalAlpha = a * 0.6
      ctx2d.strokeStyle = rgba(b.color, 0.7)
      ctx2d.lineWidth = Math.max(0.6, b.width * 0.65)
      ctx2d.beginPath()
      ctx2d.moveTo(sp.x, sp.y)
      ctx2d.lineTo(sp.x + (bx - sp.x) * 0.45, sp.y + (by - sp.y) * 0.35)
      ctx2d.lineTo(bx, by)
      ctx2d.stroke()
    }
    ctx2d.restore()
  }
  function drawShockwaves(dt) {
    for (var i = shockwaves.length - 1; i >= 0; i--) {
      var s = shockwaves[i]
      s.r += s.speed * dt
      s.life -= s.decay * dt
      if (s.life <= 0) { shockwaves.splice(i, 1); continue }
      var a = Math.pow(Math.max(0, s.life), 1.5)
      ctx2d.save()
      ctx2d.globalCompositeOperation = 'lighter'
      ctx2d.strokeStyle = rgba(s.color, 0.7 * a)
      ctx2d.shadowBlur = 18
      ctx2d.shadowColor = s.color
      ctx2d.lineWidth = Math.max(0.5, s.width * a)
      ctx2d.beginPath()
      if (s.wobble > 0) {
        for (var k = 0; k <= 40; k++) {
          var ang = (k / 40) * Math.PI * 2
          var rad = s.r + Math.sin(ang * 5 + s.r * 0.03) * s.wobble
          var px = s.x + Math.cos(ang) * rad
          var py = s.y + Math.sin(ang) * rad
          if (k === 0) ctx2d.moveTo(px, py); else ctx2d.lineTo(px, py)
        }
      } else {
        ctx2d.arc(s.x, s.y, s.r, 0, 6.283)
      }
      ctx2d.stroke()
      ctx2d.restore()
    }
  }

  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i]
      p.life -= p.decay * dt
      if (p.life <= 0) { particles.splice(i, 1); continue }
      if (p.kind === 'suck' && coreCenter) {
        var dx = coreCenter.x - p.x
        var dy = coreCenter.y - p.y
        var d = Math.sqrt(dx * dx + dy * dy) || 1
        var pull = (900 + 1100 * p.life) * dt
        p.vx += (dx / d) * pull
        p.vy += (dy / d) * pull
        p.vx *= Math.pow(0.02, dt)
        p.vy *= Math.pow(0.02, dt)
        if (d < coreCenter.r * 0.72) { p.life = 0; continue }
        p.rot += p.spin * dt
      } else {
        p.vx *= Math.pow(0.02 * p.drag, dt)
        p.vy = p.vy * Math.pow(0.02 * p.drag, dt) + p.grav * dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.rot += p.spin * dt
      }
      if (p.kind === 'suck') {
        p.x += p.vx * dt
        p.y += p.vy * dt
      }
    }
  }

  function drawParticles() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i]
      var a = Math.max(0, p.life)
      ctx2d.save()
      ctx2d.globalCompositeOperation = 'lighter'
      if (p.kind === 'mote') {
        ctx2d.fillStyle = rgba(p.color, 0.5 * a)
        ctx2d.beginPath()
        ctx2d.arc(p.x, p.y, p.size * (0.6 + a), 0, 6.283)
        ctx2d.fill()
      } else if (p.kind === 'suck') {
        ctx2d.strokeStyle = rgba(p.color, 0.85 * a)
        ctx2d.lineWidth = p.size * 0.7
        ctx2d.beginPath()
        ctx2d.moveTo(p.x, p.y)
        ctx2d.lineTo(p.x + p.vx * 0.012, p.y + p.vy * 0.012)
        ctx2d.stroke()
      } else {
        ctx2d.translate(p.x, p.y)
        ctx2d.rotate(p.rot)
        ctx2d.fillStyle = rgba(p.color, 0.8 * a)
        ctx2d.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6)
      }
      ctx2d.restore()
    }
  }

  /* 发丝 / 神经索：从主角的头与肩长出来，随蓄能与点击扬起。
     画在 Canvas 上而不是贴图，才能逐帧改变长度、弯曲和亮度。 */
  function drawHeroStrands(ts) {
    var live = state === 'link' ? chargeLevel : (state === 'echo' || state === 'sync' || state === 'reveal' ? 0.45 + echoStep * 0.18 : 0)
    if (live <= 0.02) return
    var power = Math.min(1.6, live + strandImpulse * 1.5)
    var color = heroLastColor
    var t = ts * 0.001
    var pts = [
      [0.49, 0.10, 0.45, 0.34, 0.40, 0.60],
      [0.55, 0.09, 0.60, 0.32, 0.645, 0.58],
      [0.42, 0.27, 0.36, 0.48, 0.36, 0.74],
      [0.61, 0.27, 0.67, 0.46, 0.665, 0.78],
      [0.47, 0.38, 0.42, 0.58, 0.44, 0.86],
      [0.58, 0.38, 0.63, 0.58, 0.61, 0.88],
      [0.51, 0.52, 0.48, 0.70, 0.49, 0.98],
      [0.56, 0.52, 0.59, 0.70, 0.57, 0.98]
    ]
    ctx2d.save()
    ctx2d.globalCompositeOperation = 'lighter'
    ctx2d.lineCap = 'round'
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i]
      var sway = Math.sin(t * (1.3 + i * 0.08) + i * 1.7) * (8 + power * 15)
      var sway2 = Math.sin(t * (2.1 + i * 0.05) + i) * (3 + power * 7)
      var x0 = cw * p[0], y0 = ch * p[1]
      var x1 = cw * p[2] + sway, y1 = ch * p[3]
      var x2 = cw * p[4] + sway2, y2 = ch * p[5]
      ctx2d.beginPath()
      ctx2d.moveTo(x0, y0)
      ctx2d.bezierCurveTo(x1, y1, x2 - sway * 0.3, y2 - 20, x2, y2)
      ctx2d.strokeStyle = rgba(color, 0.12 + power * 0.2)
      ctx2d.lineWidth = 0.6 + power * 0.8
      ctx2d.shadowBlur = 10 + power * 12
      ctx2d.shadowColor = color
      ctx2d.stroke()
      ctx2d.beginPath()
      ctx2d.arc(x2, y2, 1.1 + power * 0.9, 0, 6.283)
      ctx2d.fillStyle = rgba(color, 0.45 + power * 0.3)
      ctx2d.fill()
    }
    ctx2d.restore()
  }

  function draw(ts) {
    requestAnimationFrame(draw)
    if (document.hidden) return
    frame++
    tNow = ts || 0
    var dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016
    lastTs = ts
    energy = sound.energy()

    /* 磁吸：指针靠近蓄能核心时，核心向指针偏 4–8px，光环同步变亮。
       这是“想点”的冲动来源，不改变点击判定。 */
    if (state === 'link' && coreCenter && pointer.active && !reduced) {
      var pmx = pointer.x * cw - coreCenter.x
      var pmy = pointer.y * ch - coreCenter.y
      var pdist = Math.sqrt(pmx * pmx + pmy * pmy)
      var near = Math.max(0, Math.min(1, 1 - pdist / (coreCenter.r * 5.2)))
      var pull = near * near * 8
      root.style.setProperty('--core-mx', (pmx / (pdist || 1) * pull).toFixed(2) + 'px')
      root.style.setProperty('--core-my', (pmy / (pdist || 1) * pull).toFixed(2) + 'px')
      root.style.setProperty('--core-near', near.toFixed(3))
      root.classList.toggle('yomi-core-near', near > 0.22)
    } else if (frame % 20 === 0) {
      root.style.setProperty('--core-mx', '0px')
      root.style.setProperty('--core-my', '0px')
      root.style.setProperty('--core-near', '0')
      root.classList.remove('yomi-core-near')
    }

    ctx2d.clearRect(0, 0, cw, ch)

    /* 程序化背景只在既无视频、也无海报时铺底；海报已经加载时必须保持透明，
       否则不透明 Canvas 会从 z-index 3 把 stage 里的角色整层盖住。 */
    if (!video && !posterReady) {
      var g = ctx2d.createLinearGradient(0, 0, 0, ch)
      g.addColorStop(0, '#05030c')
      g.addColorStop(0.45, '#0d0826')
      g.addColorStop(1, '#04020a')
      ctx2d.fillStyle = g
      ctx2d.fillRect(0, 0, cw, ch)
      ctx2d.save()
      ctx2d.globalAlpha = 0.2 + energy * 0.25
      var sway = Math.sin(tNow * 0.0004) * cw * 0.03
      var rg = ctx2d.createRadialGradient(cw * 0.62 + sway, ch * 0.42, 20, cw * 0.62, ch * 0.5, ch * 0.78)
      rg.addColorStop(0, cfg.colorB)
      rg.addColorStop(0.55, 'rgba(40,18,80,0.55)')
      rg.addColorStop(1, 'rgba(0,0,0,0)')
      ctx2d.fillStyle = rg
      ctx2d.fillRect(0, 0, cw, ch)
      ctx2d.restore()
    }

    /* 环境雷暴：低频越强越密；揭幕让位给文字 */
    if (!reduced && state !== 'reveal' && state !== 'done' && tNow - lastSpawn > (2600 - energy * 1800)) {
      lastSpawn = tNow
      if (bolts.length < 2) {
        var bx = Math.random() < 0.5 ? rnd(cw * 0.02, cw * 0.26) : rnd(cw * 0.74, cw * 0.98)
        spawnBolt(bx, rnd(-40, ch * 0.14), rnd(cw * 0.08, cw * 0.92), rnd(ch * 0.5, ch * 0.98), rnd(0.35, 0.7))
        sound.rumble(0.38)
      }
    }

    /* 环境灰烬 */
    if (particles.length < 90 && Math.random() < 0.6) {
      addParticle({
        kind: 'mote',
        x: rnd(0, cw), y: rnd(ch * 0.5, ch * 1.08),
        vx: rnd(-12, 12), vy: rnd(-55, -16),
        life: 1, decay: rnd(0.1, 0.22),
        size: rnd(0.7, 2.1),
        color: Math.random() < 0.5 ? HEX_A : HEX_B,
        drag: 1, grav: -6, spin: 0, rot: 0
      })
    }

    /* 蓄能：粒子被核心吸进去 + 火花 */
    if (state === 'link' && coreCenter && (holdActive || chargeLevel > 0.015)) {
      var rate = Math.min(10, Math.max(1, Math.round((60 + chargeLevel * 260) * dt)))
      for (var ci = 0; ci < rate; ci++) {
        if (particles.length > 480) break
        var ca = rnd(0, 6.283)
        var cr = rnd(coreCenter.r * 2.2, coreCenter.r * 5.4)
        addParticle({
          kind: 'suck',
          x: coreCenter.x + Math.cos(ca) * cr,
          y: coreCenter.y + Math.sin(ca) * cr,
          vx: 0, vy: 0,
          life: 1, decay: rnd(0.5, 1.0),
          size: rnd(1, 2.6),
          color: Math.random() < 0.72 ? HEX_A : HEX_B,
          drag: 1, grav: 0, spin: 0, rot: 0
        })
      }
      if (Math.random() < 0.35) {
        shockwave(coreCenter.x, coreCenter.y, {
          r0: coreCenter.r * 1.05,
          speed: 120 + chargeLevel * 280,
          decay: 1.5,
          width: 1,
          color: HEX_A
        })
      }
      /* 指针处电火花 */
      if (pointer.active && Math.random() < 0.4) {
        burst(pointer.x * cw, pointer.y * ch, {
          count: 2, sp0: 30, sp1: 160, size0: 0.7, size1: 1.8,
          decay0: 1.6, decay1: 3, grav: 10, color: '#ffd9e5'
        })
      }
    }

    /* 蓄能与主角之间的可见因果：能量从核心一路爬到她胸口 */
    if (state === 'link' && coreCenter && chargeLevel > 0.16) {
      var chX = cw * 0.545, chY = ch * 0.56
      var wave = Math.sin(tNow * 0.006) * 18
      ctx2d.save()
      ctx2d.globalCompositeOperation = 'lighter'
      ctx2d.strokeStyle = rgba(HEX_A, 0.08 + chargeLevel * 0.34)
      ctx2d.lineWidth = 0.8 + chargeLevel * 2.2
      ctx2d.shadowBlur = 12 + chargeLevel * 20
      ctx2d.shadowColor = HEX_A
      ctx2d.beginPath()
      ctx2d.moveTo(coreCenter.x, coreCenter.y - coreCenter.r * 0.6)
      ctx2d.bezierCurveTo(
        coreCenter.x + wave, ch * 0.78,
        chX + wave * 1.4, ch * 0.66,
        chX, chY
      )
      ctx2d.stroke()
      ctx2d.restore()
      if (!reduced && Math.random() < 0.22 + chargeLevel * 0.5) {
        var k = Math.random()
        addParticle({
          kind: 'mote',
          x: coreCenter.x + (chX - coreCenter.x) * k + rnd(-10, 10),
          y: coreCenter.y + (chY - coreCenter.y) * k + rnd(-8, 8),
          vx: rnd(-6, 6), vy: rnd(-40, -14),
          life: 1, decay: rnd(0.8, 1.5),
          size: rnd(0.8, 2.2),
          color: HEX_A, drag: 1, grav: -4, spin: 0, rot: 0
        })
      }
    }

    /* 残响层：主角持续反应（醒来后的余波） */
    if ((state === 'echo' || state === 'sync') && echoStep > 0) {
      heroPulseT += dt
      heroBeatT += dt
      var hp = { x: cw * 0.545, y: ch * 0.56 }
      if (particles.length < 300) {
        var n = Math.min(6, Math.max(1, Math.round((20 + echoStep * 22) * dt)))
        for (var hi = 0; hi < n; hi++) {
          var ha = rnd(0, 6.283)
          var hr = rnd(90, 260)
          addParticle({
            kind: 'mote',
            x: hp.x + Math.cos(ha) * hr * 0.7,
            y: hp.y + Math.sin(ha) * hr,
            vx: rnd(-8, 8), vy: rnd(-70, -24),
            life: 1, decay: rnd(0.35, 0.7),
            size: rnd(0.8, 2.4),
            color: Math.random() < 0.65 ? heroLastColor : HEX_B,
            drag: 1, grav: -10, spin: 0, rot: 0
          })
        }
      }
      if (heroPulseT > (2.2 - echoStep * 0.38)) {
        heroPulseT = 0
        shockwave(hp.x, hp.y, {
          r0: 30 + echoStep * 10,
          speed: 150 + echoStep * 55,
          decay: 1.05,
          width: 1.2,
          color: echoStep >= 3 ? '#fff4df' : heroLastColor,
          wobble: echoStep >= 2 ? 12 : 0
        })
        if (echoStep >= 2 && !reduced) {
          spawnChain(rnd(cw * 0.2, cw * 0.8), rnd(0, ch * 0.2), hp.x, hp.y, 0.42)
        }
      }
      /* 心率感：光晕随点击次数加快 */
      var beat = Math.max(0, Math.sin(heroBeatT * (2.4 + echoStep * 1.1)))
      root.style.setProperty('--hero-beat', (0.25 + beat * 0.75).toFixed(3))
    }

    strandImpulse *= Math.pow(0.06, dt)
    if (!reduced) drawHeroStrands(ts)
    updateParticles(dt)
    drawShockwaves(dt)
    for (var m = bolts.length - 1; m >= 0; m--) {
      var b = bolts[m]
      b.life -= b.decay * dt
      if (b.life <= 0) { bolts.splice(m, 1); continue }
      drawBolt(b)
    }
    drawParticles()

    /* 光标电火花 */
    if (pointer.active && !reduced) {
      ctx2d.save()
      ctx2d.globalCompositeOperation = 'lighter'
      ctx2d.globalAlpha = 0.5 + chargeLevel * 0.5
      ctx2d.fillStyle = 'rgba(255,224,238,0.85)'
      ctx2d.shadowBlur = 12
      ctx2d.shadowColor = HEX_A
      ctx2d.beginPath()
      ctx2d.arc(pointer.x * cw, pointer.y * ch, 1.4 + energy * 2 + chargeLevel * 3, 0, 6.283)
      ctx2d.fill()
      ctx2d.restore()
    }

    /* 镜头抖动 */
    if (shake > 0.08) {
      var sx = rnd(-shake, shake)
      var sy = rnd(-shake, shake)
      stage.style.transform = 'translate3d(' + sx.toFixed(1) + 'px,' + sy.toFixed(1) + 'px,0) scale(1.012)'
      canvas.style.transform = 'translate3d(' + sx.toFixed(1) + 'px,' + sy.toFixed(1) + 'px,0)'
      shake *= Math.pow(0.0025, dt)
    } else if (shake !== 0) {
      shake = 0
      stage.style.transform = ''
      canvas.style.transform = ''
    }

    /* 音频律动驱动背景微呼吸 */
    if (frame % 5 === 0) root.style.setProperty('--yomi-beat', energy.toFixed(3))
  }

  resize()
  window.addEventListener('resize', resize)
  requestAnimationFrame(draw)

  /* ── 主角残影：点击瞬间冻结当前帧，按亮度抠出人物轮廓再做位移 ---------
   * 旧实现只给整帧盖一层 18% 色调，残影几乎看不见；这里用亮度阈值 + 软椭圆
   * 空间遮罩把暗背景剔掉，只留下她本人，再染成当前碎片的颜色。画布被跨源
   * 视频污染时 getImageData 会抛错，自动退回旧的整帧染色，不阻塞动效。 */
  function captureHeroFrame(color, opts) {
    opts = opts || {}
    var source = null, vw = 0, vh = 0
    if (video && video.readyState >= 2 && video.videoWidth) {
      source = video
      vw = video.videoWidth
      vh = video.videoHeight
    } else if (posterReady && posterImg && posterImg.naturalWidth) {
      source = posterImg
      vw = posterImg.naturalWidth
      vh = posterImg.naturalHeight
    }
    if (!source) return null
    var gw = Math.max(2, Math.min(1280, Math.floor(cw)))
    var gh = Math.max(2, Math.round(gw * ch / Math.max(1, cw)))
    var ghost = document.createElement('canvas')
    ghost.width = gw
    ghost.height = gh
    var g = ghost.getContext('2d')
    var scale = opts.scale || 1.06
    var cover = Math.max((gw * scale) / vw, (gh * scale) / vh)
    var dw = vw * cover, dh = vh * cover
    try { g.drawImage(source, (gw - dw) / 2, (gh - dh) / 2, dw, dh) } catch (e) { return null }
    var tint = hexToRgb(color || HEX_A)
    if (opts.silhouette) {
      try {
        var img = g.getImageData(0, 0, gw, gh)
        var d = img.data
        var cx = gw * 0.545, cy = gh * 0.56
        var rx = gw * 0.34, ry = gh * 0.68
        for (var p = 0; p < d.length; p += 4) {
          var lum = d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114
          var nx = ((p / 4) % gw - cx) / rx
          var ny = (Math.floor((p / 4) / gw) - cy) / ry
          var edge = 1 - smoothstep(0.72, 1.12, Math.sqrt(nx * nx + ny * ny))
          var alpha = smoothstep(30, 100, lum) * edge
          d[p] = Math.round(d[p] * 0.18 + tint.r * 0.82)
          d[p + 1] = Math.round(d[p + 1] * 0.18 + tint.g * 0.82)
          d[p + 2] = Math.round(d[p + 2] * 0.18 + tint.b * 0.82)
          d[p + 3] = Math.round(alpha * 235)
        }
        g.putImageData(img, 0, 0)
        return ghost
      } catch (e) { /* 跨源画布不可读，退回整帧染色 */ }
    }
    g.globalCompositeOperation = 'source-atop'
    g.fillStyle = rgba(color || HEX_A, 0.18)
    g.fillRect(0, 0, gw, gh)
    return ghost
  }

  function spawnHeroGhosts(id, step, soft) {
    if (!heroGhosts) return
    var meta = id === 'memory' ? FRAGMENT_META[1] : (id === 'name' ? FRAGMENT_META[2] : FRAGMENT_META[0])
    var specs
    if (id === 'memory') {
      specs = [
        { x: -0.032, y: 0.002, r: -0.6, s: 1.006, o: 0.52, d: 1050, delay: 0 },
        { x: 0.028, y: -0.004, r: 0.7, s: 1.01, o: 0.42, d: 1150, delay: 70 },
        { x: 0.004, y: -0.012, r: 0.2, s: 1.016, o: 0.34, d: 1250, delay: 140 }
      ]
    } else if (id === 'name') {
      specs = [
        { x: 0, y: -0.026, r: 0, s: 1.012, o: 0.55, d: 1200, delay: 0 },
        { x: 0, y: -0.012, r: 0, s: 1.02, o: 0.26, d: 1500, delay: 100 }
      ]
    } else {
      specs = [
        { x: -0.018, y: 0.012, r: -1.1, s: 1.01, o: 0.62, d: 620, delay: 0 },
        { x: 0.014, y: -0.006, r: 0.8, s: 1.006, o: 0.32, d: 760, delay: 40 }
      ]
    }
    if (soft) specs = specs.slice(0, 1)
    for (var i = 0; i < specs.length; i++) {
      (function (spec) {
        var ghost = captureHeroFrame(meta.color, { scale: 1.06, silhouette: true })
        if (!ghost) return
        ghost.className = 'yomi-hero-ghost yomi-ghost-' + id
        ghost.style.transformOrigin = '54% 56%'
        heroGhosts.appendChild(ghost)
        var anim = ghost.animate([
          { transform: 'translate3d(0,0,0) scale(1) rotate(0deg)', opacity: spec.o },
          { transform: 'translate3d(' + (spec.x * 100) + '%,' + (spec.y * 100) + '%,0) scale(' + spec.s + ') rotate(' + spec.r + 'deg)', opacity: 0 }
        ], {
          duration: spec.d,
          delay: spec.delay,
          easing: 'cubic-bezier(0.16,0.8,0.24,1)',
          fill: 'both'
        })
        var remove = function () { if (ghost.parentNode) ghost.parentNode.removeChild(ghost) }
        if (anim && anim.finished) anim.finished.then(remove).catch(remove)
        later(remove, spec.d + spec.delay + 120)
      })(specs[i])
    }
  }

  /* 终帧残像：拾忆者后拖、问名者镜像、余响者多重回声。 */
  function spawnFormAfterimages(form) {
    if (!heroGhosts || reduced || !form) return
    var color = form.a || HEX_A
    var specs = []
    if (form.motif === 'ghost') {
      specs = [
        { x: 0.075, y: 0.004, o: 0.6, sx: 1, sy: 1 },
        { x: 0.15, y: -0.004, o: 0.38, sx: 1, sy: 1 }
      ]
    } else if (form.motif === 'mirror') {
      specs = [
        { x: 0.16, y: 0, o: 0.55, sx: -1, sy: 1 }
      ]
    } else if (form.motif === 'echo') {
      specs = [
        { x: 0.095, y: 0.002, o: 0.5, sx: 1, sy: 1 },
        { x: 0.18, y: -0.004, o: 0.34, sx: 1, sy: 1 },
        { x: -0.075, y: 0.002, o: 0.22, sx: 1, sy: 1 }
      ]
    } else if (form.motif === 'crest') {
      specs = [
        { x: 0, y: 0, o: 0.26, sx: 1, sy: 1 }
      ]
    } else if (form.motif === 'halo') {
      specs = [
        { x: 0, y: -0.004, o: 0.24, sx: 1, sy: 1 }
      ]
    } else if (form.motif === 'storm') {
      specs = [
        { x: -0.01, y: 0, o: 0.32, sx: 1, sy: 1 },
        { x: 0.012, y: -0.002, o: 0.24, sx: 1, sy: 1 }
      ]
    }
    for (var i = 0; i < specs.length; i++) {
      var spec = specs[i]
      var ghost = captureHeroFrame(color, { scale: 1.045, silhouette: true })
      if (!ghost) continue
      ghost.className = 'yomi-form-afterimage yomi-form-afterimage-' + form.motif
      ghost.style.setProperty('--fx-x', (spec.x * 100).toFixed(2) + '%')
      ghost.style.setProperty('--fx-y', (spec.y * 100).toFixed(2) + '%')
      ghost.style.setProperty('--fx-o', String(spec.o))
      ghost.style.setProperty('--fx-sx', String(spec.sx))
      ghost.style.setProperty('--fx-sy', String(spec.sy))
      ghost.style.setProperty('--fx-delay', String(i * 90) + 'ms')
      heroGhosts.appendChild(ghost)
    }
  }

  /* ── 形态本体层：持续残响，不随动画结束消失 ─────────────────────────── */
  var formBodyTimer = null
  var formBodyRetry = 0
  function clearFormBody() {
    if (formBodyTimer) { clearTimeout(formBodyTimer); formBodyTimer = null }
    formBodyRetry = 0
    if (!formBody) return
    while (formBody.firstChild) formBody.removeChild(formBody.firstChild)
    formBody.removeAttribute('data-motif')
  }
  function buildFormBody(form) {
    if (!formBody || !form) return
    var specs = FORM_BODY_SPECS[form.motif] || []
    if (!specs.length) { clearFormBody(); return }
    var color = form.a || HEX_A
    var built = 0
    clearFormBody()
    formBody.setAttribute('data-motif', form.motif)
    for (var i = 0; i < specs.length; i++) {
      var spec = specs[i]
      var ghost = captureHeroFrame(color, { scale: spec.s || 1.05, silhouette: true })
      if (!ghost) continue
      ghost.className = 'yomi-form-body-el yomi-form-body-' + form.motif
      ghost.style.setProperty('--fb-x', (spec.x * 100).toFixed(2) + '%')
      ghost.style.setProperty('--fb-y', (spec.y * 100).toFixed(2) + '%')
      ghost.style.setProperty('--fb-o', String(spec.o))
      ghost.style.setProperty('--fb-s', String(spec.s || 1))
      ghost.style.setProperty('--fb-sx', String(spec.sx || 1))
      ghost.style.setProperty('--fb-sy', String(spec.sy || 1))
      ghost.style.setProperty('--fb-delay', String(spec.delay || 0) + 'ms')
      formBody.appendChild(ghost)
      built += 1
    }
    if (!built && formBodyRetry < 8) {
      formBodyRetry += 1
      formBodyTimer = later(function () {
        formBodyTimer = null
        if (currentForm === form) buildFormBody(form)
      }, 160)
    } else if (built) {
      formBodyRetry = 0
    }
  }

  /* ── 形态环境：storm 的持续落雷 / echo 的持续回响环 ─────────────────── */
  var formAmbientTimer = null
  function stopFormAmbient() {
    if (formAmbientTimer) { clearTimeout(formAmbientTimer); formAmbientTimer = null }
  }
  function startFormAmbient(form) {
    stopFormAmbient()
    if (reduced || !form) return
    var motif = form.motif
    if (motif !== 'storm' && motif !== 'echo') return
    var tick = 0
    ;(function pulse() {
      if (state !== 'reveal' && state !== 'sync') return
      var hx = cw * 0.545, hy = ch * 0.56
      if (motif === 'storm') {
        spawnBolt(rnd(cw * 0.30, cw * 0.76), rnd(ch * 0.02, ch * 0.24),
          hx + rnd(-110, 110), hy + rnd(-90, 40), 0.58)
        if (tick % 2 === 1) {
          shockwave(hx, hy, { r0: 42 + (tick % 3) * 10, speed: 210, decay: 0.9, width: 1.2, color: '#ff2d55', wobble: 8 })
        }
      } else {
        shockwave(hx, hy, { r0: 88 + (tick % 3) * 26, speed: 110, decay: 0.5, width: 1.0, color: form.a, wobble: 4 })
      }
      tick += 1
      formAmbientTimer = later(pulse, motif === 'storm' ? 480 : 760)
    })()
  }

  /* ── DOM 冲击波 / 碎片飞行 / 闪屏 / 故障条 ─────────────────────────── */
  function pulseAt(x, y, kind, color) {
    var p = el('span', 'yomi-pulse' + (kind ? ' yomi-pulse-' + kind : ''), fxLayer)
    p.style.left = x + 'px'
    p.style.top = y + 'px'
    if (color) p.style.setProperty('--pulse-color', color)
    later(function () { if (p.parentNode) p.parentNode.removeChild(p) }, 1200)
  }
  function flyShard(fromX, fromY, toX, toY, idx) {
    var s = el('span', 'yomi-shard-fly', fxLayer)
    s.style.left = fromX + 'px'
    s.style.top = fromY + 'px'
    s.style.setProperty('--shard-a', cfg.colorA)
    s.style.setProperty('--shard-b', cfg.colorB)
    var dx = toX - fromX
    var dy = toY - fromY
    var midX = dx * 0.55 + rnd(-40, 40)
    var midY = dy * 0.55 + rnd(-40, 40)
    var fallback = function () { if (s.parentNode) s.parentNode.removeChild(s) }
    try {
      var anim = s.animate([
        { transform: 'translate(-50%,-50%) scale(1) rotate(0deg)', opacity: 1 },
        { transform: 'translate(calc(-50% + ' + midX + 'px),calc(-50% + ' + midY + 'px)) scale(0.72) rotate(140deg)', opacity: 1, offset: 0.62 },
        { transform: 'translate(calc(-50% + ' + dx + 'px),calc(-50% + ' + dy + 'px)) scale(0.12) rotate(300deg)', opacity: 0 }
      ], { duration: reduced ? 120 : 560, easing: 'cubic-bezier(0.42,0,0.2,1)' })
      anim.onfinish = fallback
      later(fallback, 900)
    } catch (e) {
      fallback()
    }
    pulseAt(fromX, fromY, 'node', cfg.colorA)
  }
  function flashScreen(duration) {
    flash.classList.remove('yomi-flash-on')
    void flash.offsetWidth
    flash.style.setProperty('--yomi-flash-dur', duration + 'ms')
    flash.classList.add('yomi-flash-on')
    later(function () { flash.classList.remove('yomi-flash-on') }, duration + 60)
  }
  function screenGlitch(duration) {
    root.classList.remove('yomi-glitching')
    void root.offsetWidth
    root.classList.add('yomi-glitching')
    later(function () { root.classList.remove('yomi-glitching') }, duration)
  }
  function heroPulse() {
    root.classList.remove('yomi-hero-pulse')
    void heroFx.offsetWidth
    root.classList.add('yomi-hero-pulse')
    later(function () { root.classList.remove('yomi-hero-pulse') }, 1400)
  }
  function refreshTethers() {
    if (!tetherPaths.length || !cw) return
    var hx = cw * 0.545
    var hy = ch * 0.56
    for (var i = 0; i < nodeEls.length; i++) {
      var rec = nodeEls[i]
      if (!rec) continue
      var r
      try { r = rec.node.getBoundingClientRect() } catch (e) { r = null }
      if (!r || !r.width) continue
      var x = r.left + r.width / 2
      var y = r.top + r.height / 2
      var mx = (x + hx) / 2
      var my = (y + hy) / 2 - Math.min(130, Math.abs(x - hx) * 0.22)
      var d = 'M' + x.toFixed(1) + ' ' + y.toFixed(1) + ' Q' + mx.toFixed(1) + ' ' + my.toFixed(1) + ' ' + hx.toFixed(1) + ' ' + hy.toFixed(1)
      tetherPaths[i].setAttribute('d', d)
      tetherGlows[i].setAttribute('d', d)
    }
  }

  /* ── 顺序谱 / 形态 ───────────────────────────────────────────────────── */
  function updateOrderUI() {
    for (var i = 0; i < orderSlots.length; i++) {
      var rec = orderSlots[i]
      var frag = sequence[i]
      if (frag == null) {
        rec.el.classList.remove('yomi-order-filled')
        rec.mark.textContent = '·'
        rec.idx.textContent = '—'
        rec.el.style.removeProperty('--slot-color')
      } else {
        var meta = FRAGMENT_META[frag] || FRAGMENT_META[0]
        rec.el.classList.add('yomi-order-filled')
        rec.mark.textContent = meta.mark
        rec.idx.textContent = '0' + (frag + 1)
        rec.el.style.setProperty('--slot-color', meta.color)
      }
    }
    var done = sequence.length >= 3
    var form = done ? formFor(sequence) : null
    var last = sequence.length ? FRAGMENT_META[sequence[sequence.length - 1]] : null
    orderForm.textContent = form ? '形态 / ' + form.name : (last ? '还差 ' + (3 - sequence.length) + ' 道 · ' + last.label : '选择顺序')
    orderForm.style.setProperty('--order-accent', form ? form.a : (last ? last.color : 'rgba(255,255,255,0.4)'))
    orderBox.classList.toggle('yomi-order-complete', done)
  }
  function applyForm(form) {
    currentForm = form
    setFormVars(form)
    buildFormBody(form)
    root.classList.remove('yomi-motif-crest', 'yomi-motif-halo', 'yomi-motif-storm',
      'yomi-motif-ghost', 'yomi-motif-mirror', 'yomi-motif-echo')
    root.classList.add('yomi-motif-' + form.motif)
    syncFormName.textContent = form.name + ' / ' + form.en
    syncForm.classList.add('yomi-sync-form-on')
    orderForm.textContent = '形态 / ' + form.name
    updateOrderUI()
  }

  /* ── 幕一：DORMANT ─────────────────────────────────────────────────── */
  function enterDormant() {
    setState('boot')
    root.classList.add('yomi-phase-boot')
    statusText.textContent = 'SIGNAL LOST'
    sound.attachBGM()
    later(function () {
      root.classList.remove('yomi-phase-boot')
      enterLink()
    }, ms(820))
  }

  /* ── 幕二：LINK ─────────────────────────────────────────────────────── */
  var chargeLevel = 0
  var holdActive = false
  var holdStart = 0
  var lastChargeInput = 0
  var chargeRaf = null
  var chargeFrame = 0
  var linkDone = false
  var idleTimer = null
  var hintShown = false
  var lastChargeCopy = ''
  var lastChargeTick = -1
  var chargeSessions = 0

  function enterLink() {
    setState('link')
    root.classList.add('yomi-phase-link')
    measureCore()
    statusText.textContent = cfg.interaction === 'off' ? 'LINKING' : 'AWAITING SIGNAL'
    if (cfg.interaction === 'off') {
      chargeCn.textContent = '自动'
      chargeEn.textContent = 'AUTO'
      chargeHint.textContent = '自动接入中 · 无需操作'
      chargeKeys.textContent = '无需操作'
      linkSub.textContent = 'AUTO LINK'
      linkHint.textContent = '自动接入中 · 无需操作'
      beginAutoCharge(ms(1500))
      return
    }
    if (cfg.interaction === 'quick') {
      chargeCn.textContent = '单击'
      chargeEn.textContent = 'CLICK'
      chargeHint.textContent = '单击，让她听见。'
      chargeKeys.textContent = '左键 / 空格 / 回车'
      linkHint.textContent = '单击，让她听见。'
      linkSub.textContent = 'CLICK TO LINK'
      scheduleIdle()
      return
    }
    chargeCn.textContent = '按住'
    chargeHint.textContent = '按住，听她回应。'
    chargeKeys.textContent = '左键 / 空格 / 回车'
    linkHint.textContent = '三道残响，只等你接通。'
    scheduleIdle()
  }
  function scheduleIdle() {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = later(function () {
      if (state !== 'link' || linkDone || hintShown) return
      hintShown = true
      root.classList.add('yomi-core-idle')
      statusText.textContent = 'SIGNAL DRIFT'
      linkHint.textContent = '她还在等。按住，别松手。'
    }, ms(6500))
  }
  function chargeVoice(p) {
    var copy
    if (p >= 0.995) copy = '她听见了。'
    else if (p >= 0.66) copy = '别松手。'
    else if (p >= 0.36) copy = '她正在靠近。'
    else if (p >= 0.12) copy = '再近一点。'
    else if (p >= 0.01) copy = '别松手。'
    else copy = '按住，听她回应。'
    if (copy !== lastChargeCopy) {
      lastChargeCopy = copy
      chargeHint.textContent = copy
    }
    var tick = Math.floor(p * 10)
    if (tick > lastChargeTick && p < 0.995) {
      lastChargeTick = tick
      sound.tick(p)
    } else if (tick < lastChargeTick) {
      lastChargeTick = tick
    }
  }
  function paintCharge(p) {
    chargeLevel = Math.max(0, Math.min(1, p))
    root.style.setProperty('--yomi-charge', chargeLevel.toFixed(3))
    root.style.setProperty('--hero-charge', chargeLevel.toFixed(3))
    var C = 2 * Math.PI * 104
    chargeArc.style.strokeDasharray = C.toFixed(1)
    chargeArc.style.strokeDashoffset = (C * (1 - chargeLevel)).toFixed(1)
    chargePct.textContent = Math.round(chargeLevel * 100) + '%'
    chargeArc.setAttribute('stroke-dashoffset', (C * (1 - chargeLevel)).toFixed(1))
    var lit = Math.round(chargeLevel * chargeTickEls.length)
    for (var i = 0; i < chargeTickEls.length; i++) {
      if (i < lit) chargeTickEls[i].classList.add('yomi-tick-on')
      else chargeTickEls[i].classList.remove('yomi-tick-on')
    }
    if (chargeLevel > 0.66) root.classList.add('yomi-core-hot')
    else root.classList.remove('yomi-core-hot')
    if (chargeLevel >= 0.995) root.classList.add('yomi-core-full')
    else root.classList.remove('yomi-core-full')
    if (videoWrap) videoWrap.style.setProperty('--yomi-link', String(chargeLevel))
    /* 蓄能环与右下 SYNC 是同一份进度：百分比、刻度、填充条必须同步走。 */
    setSyncMeter(chargeLevel * 100, { live: true })
    if (cfg.interaction === 'full') chargeVoice(chargeLevel)
  }
  function addCharge(delta) {
    if (linkDone) return
    paintCharge(chargeLevel + delta)
    sound.updateCharge(chargeLevel)
    if (chargeLevel >= 1) finishLink()
  }
  function beginHold() {
    if (state !== 'link' || linkDone) return
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
    if (holdActive) return
    holdActive = true
    chargeSessions += 1
    holdStart = performance.now()
    lastChargeInput = holdStart
    root.classList.add('yomi-charging')
    root.classList.remove('yomi-core-idle', 'yomi-charge-fail')
    root.classList.add('yomi-core-press')
    later(function () { root.classList.remove('yomi-core-press') }, 260)
    chargeEn.textContent = 'HOLD'
    chargeHint.textContent = '别松手。'
    if (chargeLevel < 0.012) paintCharge(0.012)
    sound.startCharge()
    sound.click()
    if (coreCenter) {
      pulseAt(coreCenter.x, coreCenter.y, 'press', cfg.colorA)
      burst(coreCenter.x, coreCenter.y, {
        count: 22, sp0: 70, sp1: 320, size0: 0.8, size1: 2.8,
        decay0: 1.4, decay1: 2.8, grav: 0, color: HEX_A
      })
      shockwave(coreCenter.x, coreCenter.y, { r0: coreCenter.r * 0.9, speed: 420, decay: 1.9, width: 1.4, color: HEX_A })
      spawnBolt(coreCenter.x, coreCenter.y, cw * 0.53, ch * 0.58, 0.42)
    }
    sound.zap(0.28)
    if (!chargeRaf) { chargeFrame = 0; chargeRaf = requestAnimationFrame(chargeLoop) }
  }
  function endHold(kick) {
    if (!holdActive) return
    var dur = performance.now() - holdStart
    holdActive = false
    root.classList.remove('yomi-charging')
    sound.stopCharge()
    lastChargeInput = performance.now()
    if (kick && dur < 230 && state === 'link' && !linkDone && cfg.interaction === 'full') {
      tapKick()
    } else if (state === 'link' && !linkDone && chargeLevel < 0.995) {
      root.classList.add('yomi-charge-fail')
      chargeEn.textContent = 'HOLD'
      chargeHint.textContent = '信号回落，再按住。'
      later(function () { root.classList.remove('yomi-charge-fail') }, 520)
    }
  }
  function tapKick() {
    if (state !== 'link' || linkDone) return
    addCharge(0.14)
    root.classList.add('yomi-core-tap')
    later(function () { root.classList.remove('yomi-core-tap') }, 220)
    if (coreCenter) {
      pulseAt(coreCenter.x, coreCenter.y, 'tap', cfg.colorA)
      burst(coreCenter.x, coreCenter.y, {
        count: 12, sp0: 50, sp1: 220, size0: 0.7, size1: 2.2,
        decay0: 1.6, decay1: 3, grav: 0, color: '#ffd9e5'
      })
    }
    sound.click()
    if (!chargeRaf) { chargeFrame = 0; chargeRaf = requestAnimationFrame(chargeLoop) }
    scheduleIdle()
  }
  function chargeLoop(ts) {
    chargeRaf = null
    if (linkDone || state !== 'link') { chargeFrame = 0; return }
    /* 蓄能进度必须按真实时间走：低帧率（视频解码 / 弱显卡 / 后台标签）时
       rAF 会掉到个位数，若用「每帧固定步长」会蓄得比 1.8 秒慢得多。 */
    var dt = chargeFrame ? Math.min(0.3, (ts - chargeFrame) / 1000) : 0.016
    chargeFrame = ts
    if (holdActive) {
      addCharge((dt * 1000) / ms(1800))
    } else if (chargeLevel > 0.001) {
      var idleFor = performance.now() - lastChargeInput
      if (idleFor > 240) addCharge(-0.12 * dt)
    }
    if (linkDone) return
    if (holdActive || chargeLevel > 0.0015) chargeRaf = requestAnimationFrame(chargeLoop)
    else chargeFrame = 0
  }
  function beginAutoCharge(duration) {
    var t0 = performance.now()
    root.classList.add('yomi-charging')
    sound.startCharge()
    ;(function step() {
      if (linkDone || state !== 'link') return
      var k = Math.min(1, (performance.now() - t0) / duration)
      paintCharge(k)
      sound.updateCharge(k)
      if (k >= 1) finishLink()
      else requestAnimationFrame(step)
    })()
  }
  function finishLink() {
    if (linkDone) return
    linkDone = true
    holdActive = false
    if (idleTimer) clearTimeout(idleTimer)
    if (chargeRaf) { cancelAnimationFrame(chargeRaf); chargeRaf = null }
    sound.stopCharge()
    paintCharge(1)
    root.classList.remove('yomi-charging', 'yomi-core-idle')
    root.classList.add('yomi-link-done', 'yomi-core-done')
    root.classList.add('yomi-hero-charged')
    root.style.setProperty('--hero-eye', FRAGMENT_META[0].eye)
    statusText.textContent = 'LINK ESTABLISHED'
    if (coreCenter) {
      shockwave(coreCenter.x, coreCenter.y, { r0: 40, speed: 1300, decay: 1.2, width: 5, color: '#fff0f6', wobble: 16 })
      shockwave(coreCenter.x, coreCenter.y, { r0: 20, speed: 760, decay: 1.6, width: 3, color: HEX_A })
      burst(coreCenter.x, coreCenter.y, {
        count: 46, sp0: 120, sp1: 620, size0: 1, size1: 3.6,
        decay0: 0.9, decay1: 2, grav: 20, color: '#ffe9f2'
      })
      pulseAt(coreCenter.x, coreCenter.y, 'burst', '#ffffff')
    }
    shake = 9
    flashScreen(460)
    sound.zap(1)
    sound.rumble(0.9)
    spawnHeroGhosts('thunder', 1, true)
    root.classList.add('yomi-cut-hit-thunder')
    later(function () { root.classList.remove('yomi-cut-hit-thunder') }, 900)
    for (var i = 0; i < 4; i++) {
      later(function () {
        spawnBolt(rnd(cw * 0.15, cw * 0.85), 0, rnd(cw * 0.1, cw * 0.9), rnd(ch * 0.55, ch), 1.2)
      }, i * 80)
    }
    later(function () { root.classList.add('yomi-linkgone') }, ms(240))
    later(enterEcho, ms(680))
  }

  /* ── 幕三：ECHO（任意顺序）─────────────────────────────────────────── */
  var collected = 0
  var echoStep = 0
  function enterEcho() {
    setState('echo')
    root.classList.add('yomi-phase-echo')
    root.classList.remove('yomi-phase-link')
    root.classList.add('yomi-echo-voice-on')
    statusText.textContent = 'YOUR MOVE · THREE ECHOES'
    root.classList.add('yomi-echo-0')
    chargeWrap.classList.add('yomi-gone')
    if (!sequence.length) {
      collected = 0
      echoStep = 0
      currentForm = null
      root.classList.remove('yomi-has-thunder', 'yomi-has-memory', 'yomi-has-name')
      root.removeAttribute('data-order')
      root.removeAttribute('data-form')
      root.removeAttribute('data-form-motif')
      stopFormAmbient()
      clearFormBody()
    }
    root.setAttribute('data-echo', '0')
    orderBox.classList.remove('yomi-order-complete')
    orderBox.classList.add('yomi-order-live')
    updateOrderUI()
    /* 蓄能张力只属于 LINK 幕：进入残响层立刻收掉，否则整屏会压着一层暗红 */
    root.style.setProperty('--yomi-charge', '0')
    chargeLevel = 0
    updateSync()
    echoVoiceText.textContent = ECHO_LINE
    /* 第一句是“现在该怎么做”的交互台词，必须在她出场时就说。 */
    later(function () {
      if (state === 'echo') sound.playVoice('echo')
    }, ms(320))
    /* 等布局稳定后再画能量线 */
    later(refreshTethers, 60)
    later(refreshTethers, 420)
    if (cfg.interaction === 'off') {
      autoCollect()
    } else if (cfg.interaction === 'quick') {
      autoCollect()
    }
  }
  function autoCollect() {
    for (var i = 0; i < 3; i++) {
      (function (idx) {
        later(function () { collectNode(idx) }, idx * ms(540))
      })(i)
    }
  }
  function collectNode(idx) {
    var rec = nodeEls[idx]
    if (!rec || rec.done || state !== 'echo') return
    rec.done = true
    collected += 1
    echoStep = collected
    sequence.push(idx)
    var meta = FRAGMENT_META[idx] || FRAGMENT_META[0]
    root.style.setProperty('--hero-last', meta.color)
    root.style.setProperty('--hero-last-rgb', rgbCsv(meta.color))
    root.style.setProperty('--hero-eye', meta.eye)
    root.classList.add('yomi-has-' + meta.id)
    rec.node.classList.add('yomi-node-done')
    rec.dia.classList.add('yomi-crumble')
    rec.orbit.classList.add('yomi-node-orbit-open')
    addLog(FRAGMENTS[idx], idx)
    updateSync()
    updateOrderUI()
    root.classList.remove('yomi-echo-0')
    root.classList.add('yomi-echo-' + echoStep)
    root.setAttribute('data-echo', String(echoStep))
    root.setAttribute('data-order', sequence.join('-'))
    tetherPaths[idx].style.stroke = meta.color
    tetherGlows[idx].style.stroke = meta.color
    sound.zap(0.7)
    sound.chime(collected - 1)

    var hx = cw * 0.545
    var hy = ch * 0.56
    var rx = 0, ry = 0
    try {
      var rect = rec.node.getBoundingClientRect()
      rx = rect.left + rect.width / 2
      ry = rect.top + rect.height / 2
    } catch (e) {}
    if (!rx) { rx = cw * 0.5; ry = ch * 0.5 }

    flyShard(rx, ry, hx, hy, idx)
    heroReact(echoStep, idx, rx, ry, hx, hy)
    echoSub.textContent = '选择顺序。她会按你留下的方式回来。 · 0' + collected + ' / 03'
    if (collected >= 3) {
      var form = formFor(sequence)
      applyForm(form)
      later(enterSync, ms(760))
    }
  }
  function heroReact(step, idx, fromX, fromY, hx, hy) {
    var meta = FRAGMENT_META[idx] || FRAGMENT_META[0]
    var id = meta.id
    root.classList.remove('yomi-hit-thunder', 'yomi-hit-memory', 'yomi-hit-name', 'yomi-hero-hit')
    root.classList.remove('yomi-camera-recoil', 'yomi-memory-rewind', 'yomi-name-hit', 'yomi-eyes-raised')
    void heroFx.offsetWidth
    root.classList.add('yomi-hero-hit', 'yomi-hit-' + id)
    root.classList.add('yomi-has-' + id)
    root.style.setProperty('--hero-last', meta.color)
    root.style.setProperty('--hero-last-rgb', rgbCsv(meta.color))
    root.style.setProperty('--hero-eye', meta.eye)
    heroLastColor = meta.color
    strandImpulse = 1

    /* 主角本体：头部层偏头 + 轮廓残影；不是全屏光斑 */
    root.classList.remove('yomi-cut-hit-thunder', 'yomi-cut-hit-memory', 'yomi-cut-hit-name')
    void root.offsetWidth
    root.classList.add('yomi-cut-hit-' + id)
    later(function () { root.classList.remove('yomi-cut-hit-' + id) }, 980)
    spawnHeroGhosts(id, step)

    /* 眼芒：先炸开，再眨一下；金色「名」会多停一帧 */
    eyeL.classList.remove('yomi-eye-flare')
    eyeR.classList.remove('yomi-eye-flare')
    void eyeL.offsetWidth
    eyeL.classList.add('yomi-eye-flare')
    eyeR.classList.add('yomi-eye-flare')
    later(function () {
      eyeL.classList.remove('yomi-eye-flare')
      eyeR.classList.remove('yomi-eye-flare')
    }, id === 'name' ? 1500 : 1100)

    if (id === 'thunder') {
      spawnBolt(fromX, fromY, hx, hy, 1.35)
      spawnBolt(rnd(cw * 0.18, cw * 0.82), -30, hx, hy, 1.05)
      spawnChain(rnd(cw * 0.08, cw * 0.92), rnd(ch * 0.04, ch * 0.2), hx, hy, 0.85)
      shockwave(hx, hy, { r0: 22, speed: 820, decay: 1.25, width: 4.2, color: meta.color, wobble: 14 })
      burst(hx, hy, {
        count: 42, sp0: 120, sp1: 680, size0: 1, size1: 3.8,
        decay0: 0.9, decay1: 2.0, grav: 55, color: meta.pale
      })
      shake = Math.max(shake, 11)
      flashScreen(170)
      screenGlitch(180)
      root.classList.add('yomi-camera-recoil')
      later(function () { root.classList.remove('yomi-camera-recoil') }, 640)
      sound.zap(1)
      sound.rumble(1)
      pulseAt(hx, hy, 'thunder', meta.pale)
    } else if (id === 'memory') {
      /* 影不是“调灰”：母版先停一拍，数字层同时倒带。 */
      try {
        if (video && !video.paused) {
          video.pause()
          later(function () {
            if (state === 'echo' && video && video.paused) {
              var resumed = video.play()
              if (resumed && resumed.catch) resumed.catch(function () {})
            }
          }, 520)
        }
      } catch (e) {}
      spawnBolt(fromX, fromY, hx, hy, 0.62)
      shockwave(hx, hy, { r0: 34, speed: 360, decay: 0.95, width: 2.2, color: meta.color, wobble: 26 })
      burst(hx, hy, {
        count: 30, sp0: 40, sp1: 280, size0: 0.8, size1: 3.2,
        decay0: 0.5, decay1: 1.2, grav: -8, color: meta.pale
      })
      root.classList.add('yomi-timefreeze')
      later(function () { root.classList.remove('yomi-timefreeze') }, 380)
      screenGlitch(520)
      root.classList.add('yomi-memory-rewind')
      later(function () { root.classList.remove('yomi-memory-rewind') }, 1050)
      shake = Math.max(shake, 4)
      sound.shimmer(0.9)
      sound.rumble(0.42)
      pulseAt(hx, hy, 'memory', meta.pale)
    } else {
      spawnBolt(fromX, fromY, hx, hy, 0.9)
      shockwave(hx, hy, { r0: 20, speed: 520, decay: 1.1, width: 3.4, color: meta.color, wobble: 8 })
      shockwave(hx, hy, { r0: 60, speed: 300, decay: 0.8, width: 1.2, color: meta.pale, wobble: 0 })
      burst(hx, hy, {
        count: 34, sp0: 60, sp1: 420, size0: 1, size1: 3.2,
        decay0: 0.55, decay1: 1.5, grav: -34, color: meta.pale
      })
      root.classList.add('yomi-name-bloom')
      later(function () { root.classList.remove('yomi-name-bloom') }, 900)
      root.classList.add('yomi-name-hit', 'yomi-eyes-raised')
      later(function () {
        root.classList.remove('yomi-name-hit')
      }, 1200)
      later(function () { root.classList.remove('yomi-eyes-raised') }, 1450)
      shake = Math.max(shake, 4.5)
      sound.bell(0.9)
      sound.rumble(0.55)
      pulseAt(hx, hy, 'name', meta.pale)
    }
    if (step >= 3) sound.proximity(step)
    later(function () {
      root.classList.remove('yomi-hero-hit', 'yomi-hit-' + id)
    }, 1500)
  }
  function addLog(text, idx) {
    var line = el('div', 'yomi-log-line', logBox)
    el('span', 'yomi-log-idx', line, '0' + (idx + 1))
    el('span', 'yomi-log-text', line, '')
    var span = line.lastChild
    var n = 0
    ;(function type() {
      if (n > text.length) return
      span.textContent = text.slice(0, n)
      n++
      if (n <= text.length + 1) later(type, 34)
    })()
  }
  function setSyncMeter(value, options) {
    var pct = Math.max(0, Math.min(100, Number(value) || 0))
    syncNum.textContent = String(Math.round(pct)).padStart(2, '0')
    syncFill.style.width = pct.toFixed(1) + '%'
    root.style.setProperty('--yomi-sync', (pct / 100).toFixed(3))
    var lit = pct >= 99.5 ? 3 : Math.floor(pct / (100 / 3))
    var ticks = hudTicks.children
    for (var i = 0; i < ticks.length; i++) {
      if (i < lit) ticks[i].classList.add('yomi-hud-tick-on')
      else ticks[i].classList.remove('yomi-hud-tick-on')
    }
    if (options && options.live) root.classList.add('yomi-sync-live')
    else root.classList.remove('yomi-sync-live')
    if (!options || !options.pop) return
    syncBox.classList.remove('yomi-sync-pop')
    void syncBox.offsetWidth
    syncBox.classList.add('yomi-sync-pop')
  }
  function updateSync() {
    setSyncMeter((collected / 3) * 100, { pop: collected > 0 })
  }

  /* ── 幕四：SYNC ─────────────────────────────────────────────────────── */
  function enterSync() {
    if (state === 'sync' || state === 'reveal' || state === 'done') return
    setState('sync')
    root.classList.remove('yomi-echo-voice-on')
    echoVoiceText.textContent = ''
    root.classList.add('yomi-phase-sync')
    var form = currentForm || formFor(sequence)
    if (!currentForm) applyForm(form)
    statusText.textContent = 'FORM / ' + form.name
    root.style.setProperty('--yomi-charge', '0')
    chargeLevel = 0
    sound.chime(3)
    sound.formChord(form)
    sound.rumble(1)
    screenGlitch(ms(520))
    var hx = cw * 0.545
    var hy = ch * 0.56
    spawnHeroGhosts(form.motif === 'ghost' ? 'memory' : (form.motif === 'storm' ? 'thunder' : 'name'), echoStep, true)
    shockwave(hx, hy, { r0: 30, speed: 1500, decay: 0.9, width: 6, color: '#ffffff', wobble: 20 })
    shockwave(hx, hy, { r0: 10, speed: 900, decay: 1.2, width: 4, color: HEX_A })
    burst(hx, hy, { count: 70, sp0: 160, sp1: 900, size0: 1, size1: 4, decay0: 0.8, decay1: 1.8, grav: 30, color: '#ffe9f2' })
    shake = 12
    flashScreen(700)
    for (var i = 0; i < 6; i++) {
      later(function () {
        spawnBolt(rnd(cw * 0.1, cw * 0.9), 0, rnd(cw * 0.1, cw * 0.9), ch + 20, 1.3)
      }, i * 70)
    }
    later(function () { root.classList.add('yomi-sync-done') }, ms(120))
    later(enterReveal, ms(980))
  }

  /* ── 幕五：REVEAL ───────────────────────────────────────────────────── */
  var finished = false
  function renderRevealName(text) {
    revealName.textContent = ''
    var chars = String(text || '').split('')
    for (var i = 0; i < chars.length; i++) {
      var s = el('span', 'yomi-reveal-char', revealName, chars[i] === ' ' ? '\u00a0' : chars[i])
      s.style.setProperty('--i', String(i))
    }
    revealName.setAttribute('aria-label', String(text || ''))
    revealName.setAttribute('role', 'text')
  }
  function enterReveal() {
    if (finished) return
    setState('reveal')
    root.classList.remove('yomi-echo-voice-on')
    echoVoiceText.textContent = ''
    var form = currentForm || ensureForm()
    if (!currentForm) applyForm(form)
    root.classList.add('yomi-phase-reveal')
    root.classList.add('yomi-reveal-' + form.motif)
    statusText.textContent = 'LINK ONLINE · ' + form.name
    root.style.setProperty('--yomi-charge', '0')
    root.style.setProperty('--hero-eye', form.a)
    root.style.setProperty('--hero-last', form.a)
    root.style.setProperty('--hero-last-rgb', rgbCsv(form.a))
    heroLastColor = form.a
    chargeLevel = 0
    linkLayer.style.display = 'none'
    chargeWrap.classList.add('yomi-gone')
    echoLayer.classList.add('yomi-gone')
    bolts.length = 0
    particles.length = 0
    shockwaves.length = 0
    shake = 0
    stage.style.transform = ''
    heroSigil.classList.add('yomi-sigil-open')
    flash.classList.remove('yomi-flash-on')
    orderBox.classList.remove('yomi-order-live')
    revealName.textContent = ''
    renderRevealName(form.name)
    revealEyebrow.textContent = 'LINK ESTABLISHED // ORDER ACCEPTED'
    revealHello.textContent = '她按你留下的顺序回来了'
    revealRank.textContent = '欢迎回来，' + String(cfg.identity || 'OPERATOR')
    revealIdentity.textContent = cfg.rank || ''
    var formIndex = Object.keys(FORMS).indexOf(form.key) + 1
    revealFormK.textContent = 'FORM / 0' + formIndex
    revealFormName.textContent = form.en
    revealFormEn.textContent = 'THE SHAPE SHE RETURNED IN'
    for (var ro = 0; ro < revealOrderSlots.length; ro++) {
      var fragIdx = sequence[ro]
      var fragMeta = fragIdx == null ? null : FRAGMENT_META[fragIdx]
      var slot = revealOrderSlots[ro]
      slot.textContent = fragMeta ? ('0' + (fragIdx + 1) + ' ' + fragMeta.mark) : '—'
      slot.style.setProperty('--slot-color', fragMeta ? fragMeta.color : 'rgba(255,255,255,0.35)')
    }
    for (var rqi = 0; rqi < revealQuoteLines.length; rqi++) {
      revealQuoteLines[rqi].textContent = REVEAL_LINES[rqi]
      revealQuoteLines[rqi].style.setProperty('--line-i', String(rqi))
    }
    revealEn.textContent = 'WELCOME BACK, ' + String(cfg.identity || 'OPERATOR').toUpperCase() + ' · YOMI LINK ONLINE'
    spawnHeroGhosts(form.motif === 'ghost' ? 'memory' : (form.motif === 'storm' ? 'thunder' : 'name'), 3, true)
    spawnFormAfterimages(form)
    buildFormBody(form)
    startFormAmbient(form)
    flushDone()
    later(function () { sound.playVoice('reveal') }, ms(250))
    if (!PREVIEW_PHASE) later(finish, Math.max(ms(6200), 5600))
  }
  function flushDone() {
    /* 先让浏览器把状态写进去，刷新时按 mode 判断是否跳过 */
    try {
      sessionStorage.setItem('dsh-startup-yomi:shown', '1')
      if (cfg.mode === 'daily') localStorage.setItem('dsh-startup-yomi:day', new Date().toISOString().slice(0, 10))
    } catch (e) {}
  }
  function finish() {
    if (finished) return
    finished = true
    stopFormAmbient()
    setState('done')
    sound.duck(false)
    setTimeout(function () { sound.stop() }, 700)
    root.classList.add('yomi-exit')
    document.documentElement.classList.remove('yomi-lock')
    try { document.body.style.overflow = '' } catch (e) {}
    setTimeout(function () {
      if (root.parentNode) root.parentNode.removeChild(root)
      try { window.dispatchEvent(new CustomEvent('dsh-yomi:done')) } catch (e) {}
    }, 820)
    clearTimers()
  }

  /* ── 交互：指针 / 键盘 ──────────────────────────────────────────────── */
  function setPointer(ev) {
    if (!ev) return
    pointer.x = (ev.clientX || 0) / Math.max(1, window.innerWidth)
    pointer.y = (ev.clientY || 0) / Math.max(1, window.innerHeight)
    pointer.active = true
  }
  /* 事件目标可能不是 Node（合成事件 / 极端宿主环境），contains 前必须兜住 */
  function hit(target, node) {
    try { return !!(target && node && node.contains && node.contains(target)) } catch (e) { return false }
  }
  function primaryDown(ev) {
    setPointer(ev)
    pointer.down = true
    if (ev && hit(ev.target, skipBtn)) return
    if (state === 'link') {
      if (cfg.interaction === 'quick') {
        if (hit(ev.target, core)) return
        beginQuickLink()
        return
      }
      if (cfg.interaction === 'off') return
      beginHold()
      return
    }
  }
  function primaryUp(ev) {
    pointer.down = false
    if (state === 'link' && cfg.interaction === 'full') endHold(true)
  }
  window.addEventListener('pointermove', setPointer, { passive: true })
  window.addEventListener('pointerdown', primaryDown)
  window.addEventListener('pointerup', primaryUp)
  window.addEventListener('pointercancel', function () { pointer.down = false; endHold(false) })
  window.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); doSkip(); return }
    if (ev.key === ' ' || ev.key === 'Spacebar' || ev.key === 'Enter') {
      if (state === 'link' || state === 'boot') {
        ev.preventDefault()
        if (ev.repeat) return
        pointer.down = true
        if (cfg.interaction === 'quick') beginQuickLink()
        else if (cfg.interaction === 'full') beginHold()
      }
    }
  })
  window.addEventListener('keyup', function (ev) {
    if (ev.key === ' ' || ev.key === 'Spacebar' || ev.key === 'Enter') {
      pointer.down = false
      if (state === 'link' && cfg.interaction === 'full') endHold(true)
    }
  })
  skipBtn.addEventListener('click', function (ev) { ev.stopPropagation(); doSkip() })
  core.addEventListener('click', function (ev) {
    ev.stopPropagation()
    /* 鼠标按住由全局 pointerdown/up 处理；这里只兜住「快速档的单击」，
       以及键盘 Enter 在按钮上触发的 click，避免 full 档一次点击被记两次。 */
    if (state !== 'link' || linkDone) return
    if (cfg.interaction === 'quick') beginQuickLink()
  })

  var quickStarted = false
  function beginQuickLink() {
    if (quickStarted || linkDone || state !== 'link') return
    quickStarted = true
    root.classList.add('yomi-charging')
    sound.startCharge()
    sound.zap(0.5)
    var t0 = performance.now()
    ;(function step() {
      if (linkDone || state !== 'link') return
      var k = Math.min(1, (performance.now() - t0) / ms(520))
      paintCharge(k)
      sound.updateCharge(k)
      if (k >= 1) finishLink()
      else requestAnimationFrame(step)
    })()
  }

  /* ── 公共动作 ───────────────────────────────────────────────────────── */
  function previewOrder() {
    var seq = PREVIEW_ORDER.slice()
    for (var i = 0; i < 3; i++) if (seq.indexOf(i) < 0) seq.push(i)
    return seq
  }
  function previewJump(phase) {
    clearTimers()
    if (phase === 'echo' || phase === 'sync' || phase === 'reveal') {
      root.classList.remove('yomi-phase-boot')
      root.classList.add('yomi-phase-link', 'yomi-link-done')
      paintCharge(1)
      chargeWrap.classList.add('yomi-gone')
      if (phase === 'echo') {
        var echoOrder = previewOrder()
        sequence = PREVIEW_ECHO > 0 ? echoOrder.slice(0, Math.min(3, PREVIEW_ECHO)) : []
        collected = 0
        echoStep = 0
        enterEcho()
        later(function () {
          if (PREVIEW_ECHO > 0) previewEcho(PREVIEW_ECHO)
          refreshTethers()
        }, 120)
      } else if (phase === 'sync') {
        setState('echo')
        sequence = previewOrder()
        collected = 3
        echoStep = 3
        root.classList.add('yomi-echo-3')
        applyForm(formFor(sequence))
        updateSync()
        enterSync()
      } else {
        sequence = previewOrder()
        collected = 3
        echoStep = 3
        root.classList.add('yomi-echo-3')
        applyForm(formFor(sequence))
        updateSync()
        enterReveal()
      }
    } else if (phase === 'link') {
      root.classList.remove('yomi-phase-boot')
      enterLink()
      clearTimers()
      var p = PREVIEW_CHARGE >= 0 ? Math.max(0, Math.min(1, PREVIEW_CHARGE)) : 0
      paintCharge(p)
      if (p > 0) {
        root.classList.add('yomi-charging')
        chargeEn.textContent = 'HOLD'
        chargeHint.textContent = p >= 0.995 ? '她听见了。' : '别松手。'
      }
    } else {
      enterDormant()
    }
  }
  function previewEcho(n) {
    for (var i = 0; i < sequence.length && i < n; i++) {
      var fragIdx = sequence[i]
      var rec = nodeEls[fragIdx]
      if (!rec || rec.done) continue
      rec.done = true
      collected += 1
      var meta = FRAGMENT_META[fragIdx]
      root.classList.add('yomi-has-' + meta.id)
      root.style.setProperty('--hero-last', meta.color)
      root.style.setProperty('--hero-last-rgb', rgbCsv(meta.color))
      root.style.setProperty('--hero-eye', meta.eye)
      heroLastColor = meta.color
      if (tetherPaths[fragIdx]) {
        tetherPaths[fragIdx].style.stroke = meta.color
        tetherGlows[fragIdx].style.stroke = meta.color
      }
      rec.node.classList.add('yomi-node-done', 'yomi-node-preview-lit')
      addLog(FRAGMENTS[fragIdx], fragIdx)
    }
    echoStep = collected
    root.classList.add('yomi-echo-' + Math.max(1, echoStep))
    root.setAttribute('data-echo', String(echoStep))
    if (sequence.length) root.setAttribute('data-order', sequence.slice(0, collected).join('-'))
    if (collected >= 3) applyForm(formFor(sequence))
    updateOrderUI()
    updateSync()
    if (echoSub) echoSub.textContent = '选择顺序。她会按你留下的方式回来。 · 0' + collected + ' / 03'
  }
  function doSkip() {
    if (!cfg.allowSkip || finished) return
    if (state === 'reveal') return
    clearTimers()
    holdActive = false
    if (chargeRaf) cancelAnimationFrame(chargeRaf)
    sound.stopCharge()
    collected = 3
    echoStep = 3
    var form = currentForm || ensureForm()
    if (!currentForm) applyForm(form)
    updateSync()
    enterReveal()
  }
  function replay() {
    /* 预览重播：清掉「本次会话/今天已播」标记再刷新，否则会被 mode 判定挡住 */
    try { sessionStorage.removeItem('dsh-startup-yomi:shown') } catch (e) {}
    try { localStorage.removeItem('dsh-startup-yomi:day') } catch (e) {}
    try { window.location.reload() } catch (e) {}
  }
  window.__DSH_YOMI_API__ = {
    replay: replay,
    skip: doSkip,
    get state() { return state },
    get charge() { return chargeLevel },
    get echo() { return echoStep },
    get order() { return sequence.slice() },
    get form() { return currentForm ? currentForm.key : '' },
    get formName() { return currentForm ? currentForm.name : '' }
  }

  /* 首次用户手势时解锁音频 */
  function unlockAudio() {
    sound.ensureAudio()
    sound.attachBGM()
    window.removeEventListener('pointerdown', unlockAudio)
    window.removeEventListener('keydown', unlockAudio)
  }
  window.addEventListener('pointerdown', unlockAudio)
  window.addEventListener('keydown', unlockAudio)

  /* 启动 */
  paintCharge(0)
  updateSync()
  measureCore()
  /* 摘掉 boot 标记：宿主那支 8 秒看门狗只负责「splash.js 根本没跑起来」；
     这里既然已经接管，就不能再被它误杀。 */
  root.classList.remove('yomi-boot')
  if (PREVIEW_PHASE) previewJump(PREVIEW_PHASE)
  else enterDormant()
})()
