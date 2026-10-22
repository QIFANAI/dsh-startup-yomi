/* dsh-startup-yomi — 运行时 / 样式 / 预览 / 素材的静态结构测试
 *
 * 这一层不做浏览器渲染（那由 headless Edge 截图验收），只做三件事：
 *   1) 运行时脚本能编译，契约字符串齐全；
 *   2) 新插件没有混入旧插件 dsh-startup-screen 的任何命名与文案；
 *   3) 宿主、运行时、设置页三处配置字段完全对齐；素材文件真实存在且体积合理。
 *
 * 运行：node test/smoke-splash.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const ROOT = path.resolve(import.meta.dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(ROOT, rel))

let pass = 0
const failures = []
function ok(name, fn) {
  try {
    fn()
    pass++
  } catch (err) {
    failures.push(name + ': ' + (err && err.message ? err.message : String(err)))
  }
}
function skip(name, why) {
  console.log('SKIP: ' + name + '（' + why + '）')
}

const splash = read('lib/splash.js')
const css = read('lib/splash.css')
const index = read('lib/index.js')
const client = read('lib/client.js')
const preview = read('preview/index.html')
const pkg = JSON.parse(read('package.json'))

/* ── 1. 运行时可编译 + 契约 ─────────────────────────────────────────── */
ok('splash.js 能被 vm 编译', () => {
  new vm.Script(splash, { filename: 'splash.js' })
})
ok('splash.js 用 IIFE 且带重复加载保护', () => {
  assert.match(splash, /__DSH_YOMI_BOOTED__/)
  assert.match(splash, /\(function \(\) \{/)
})
for (const token of [
  'dsh-yomi-root',
  '__DSH_YOMI__',
  '__DSH_YOMI_API__',
  'dsh-startup-yomi:shown',
  'dsh-startup-yomi:day',
  'yomi-lock',
  'hero-loop.mp4',
  'hero-loop.webm',
  'hero.mp4',
  'hero-poster.jpg',
  'bgm.mp3',
  'voice-echo.mp3',
  'voice-reveal.mp3',
  'REVEAL_LINES',
  '由你拾起',
  '三道残响，由你拾起。',
  '顺序，就是我回来的样子。',
  'yomi-core-keys',
  'yomi-order-live',
  'yomi-memory-rewind',
  'yomi-memory-rewind-layer',
  'yomi-name-pillar',
  'yomi-reveal-quote-line',
  'yomi-reveal-identity',
  'yomi-video-el',
  'yomi-hero-still',
  'ECHO_LINE',
  'setSyncMeter',
  'WELCOME BACK',
  '__DSH_YOMI_PREVIEW_PHASE__'
]) {
  ok('splash.js 含契约 ' + token, () => assert.ok(splash.includes(token), '缺少 ' + token))
}
ok('splash.js 有视频加载失败回落', () => {
  assert.match(splash, /addEventListener\('error'/)
  assert.match(splash, /yomi-no-video/)
})
ok('splash.js 有 reducedMotion 分支', () => {
  assert.match(splash, /prefers-reduced-motion/)
  assert.match(splash, /reducedMotion/)
})
ok('减弱动态仍保留母版视频（角色与背景动效不被静态海报替换）', () => {
  const start = css.indexOf('/* ── 减弱动态')
  const end = css.indexOf('/* ============================================================================\n * 形态本体层', start)
  assert.ok(start >= 0 && end > start, '找不到减弱动态样式段')
  const block = css.slice(start, end)
  assert.match(block, /\.yomi-reduced \.yomi-video-el \{ display: block !important; animation: none !important; \}/)
  assert.equal(/\.yomi-reduced\s+\.yomi-video-el\s*,/.test(block), false, 'video 不能进入 display:none 组')
  assert.match(block, /\.yomi-reduced \.yomi-hero-ghosts,[\s\S]*?display: none !important;/)
})
ok('splash.js 不再有 90 秒无条件退出', () => assert.equal(splash.includes('90000'), false))
ok('splash.js 主母版失败时回退 hero.mp4', () => {
  assert.match(splash, /var VIDEO_URL = ASSET \+ 'hero-loop\.mp4'/)
  assert.match(splash, /var VIDEO_WEBM_URL = ASSET \+ 'hero-loop\.webm'/)
  assert.match(splash, /var VIDEO_FALLBACK_URL = ASSET \+ 'hero\.mp4'/)
  assert.match(splash, /if \(canMp4\) sources = \[VIDEO_URL, VIDEO_WEBM_URL, VIDEO_FALLBACK_URL\]/)
  assert.match(splash, /function tryNextSource\(\)/)
})
ok('splash.js 揭幕语音与 BGM 压低', () => {
  assert.match(splash, /function playVoice\(/)
  assert.match(splash, /function duck\(/)
  assert.match(splash, /sound\.playVoice\('echo'\)/)
  assert.match(splash, /sound\.playVoice\('reveal'\)/)
})
ok('角色海报是永久层，视频失败只移除 video', () => {
  assert.match(splash, /heroStill = el\('img', 'yomi-hero-still', videoWrap\)/)
  const setupAt = splash.indexOf("heroStill = el('img', 'yomi-hero-still', videoWrap)")
  const videoAt = splash.indexOf("video = el('video', 'yomi-video-el', videoWrap)")
  assert.ok(setupAt >= 0 && videoAt > setupAt, '海报必须先于 video 建立')
  const failBlock = splash.match(/function failBase\(\) \{([\s\S]*?)\n    \}/)
  assert.ok(failBlock, '缺少 failBase')
  assert.match(failBlock[1], /removeChild\(video\)/)
  assert.equal(failBlock[1].includes('videoWrap'), false, 'failBase 不得删除角色层')
  assert.match(splash, /if \(!video && !posterReady\)/)
})
ok('蓄能进度同时驱动核心、SYNC 数字、进度条与刻度', () => {
  assert.match(splash, /function setSyncMeter\(value, options\)/)
  assert.match(splash, /syncNum\.textContent = String\(Math\.round\(pct\)\)\.padStart\(2, '0'\)/)
  assert.match(splash, /syncFill\.style\.width = pct\.toFixed\(1\) \+ '%'/)
  assert.match(splash, /root\.style\.setProperty\('--yomi-sync', \(pct \/ 100\)\.toFixed\(3\)\)/)
  assert.match(splash, /paintCharge[\s\S]{0,1200}setSyncMeter\(chargeLevel \* 100, \{ live: true \}\)/)
  const liveFill = css.match(/\.yomi-root\.yomi-sync-live \.yomi-sync-fill \{([\s\S]*?)\}/)
  assert.ok(liveFill, '缺少 .yomi-root.yomi-sync-live .yomi-sync-fill 规则')
  assert.match(liveFill[1], /transition: none;/, '实时蓄能时进度条不能再有 width transition')
})
ok('ECHO 开场就说第一句，REVEAL 只留第二句', () => {
  const echoBlock = splash.match(/function enterEcho\(\) \{([\s\S]*?)\n  \}/)
  assert.ok(echoBlock, '缺少 enterEcho')
  assert.match(echoBlock[1], /root\.classList\.add\('yomi-echo-voice-on'\)/)
  assert.match(echoBlock[1], /sound\.playVoice\('echo'\)/)
  assert.match(splash, /var ECHO_LINE = '三道残响，由你拾起。'/)
  assert.match(splash, /var REVEAL_LINES = \['顺序，就是我回来的样子。'\]/)
  const syncBlock = splash.match(/function enterSync\(\) \{([\s\S]*?)\n  \}/)
  const revealBlock = splash.match(/function enterReveal\(\) \{([\s\S]*?)\n  \}/)
  assert.ok(syncBlock && revealBlock, '缺少 enterSync / enterReveal')
  assert.match(syncBlock[1], /echoVoiceText\.textContent = ''/)
  assert.match(revealBlock[1], /echoVoiceText\.textContent = ''/)
})
ok('角色海报、ECHO 台词与核心百分比都有可见样式', () => {
  assert.match(css, /\.yomi-hero-still \{ z-index: 1; \}/)
  assert.match(css, /\.yomi-root\.yomi-echo-voice-on \.yomi-echo-voice/)
  assert.match(css, /\.yomi-charge-pct \{[^}]*clip-path: none;[^}]*opacity: 1;/)
})
ok('splash.js 单视频层，不再使用双视频呼吸', () => {
  assert.match(splash, /el\('video', 'yomi-video-el'/)
  assert.equal(splash.includes('yomi-video-breathe'), false)
})
ok('splash.js 有 skip / replay API', () => {
  assert.match(splash, /skip: doSkip/)
  assert.match(splash, /replay: replay/)
})
ok('客户端半侧带桌面端自举（Host tapIndex 失效时兜底）', () => {
  assert.match(client, /function selfBoot\(/)
  assert.match(client, /function injectBoot\(/)
  assert.match(client, /splash\.js\?t=/)
  assert.match(client, /yomi-boot/)
})
ok('replay 会清掉已播标记再重播', () => {
  assert.match(splash, /removeItem\('dsh-startup-yomi:shown'\)/)
  assert.match(splash, /removeItem\('dsh-startup-yomi:day'\)/)
})
ok('splash.js 三个碎片任意顺序（点击处理器按索引调用 collectNode）', () => {
  assert.match(splash, /collectNode\(idx\)/)
  assert.match(splash, /addEventListener\('click'/)
})
ok('splash.js 定义六种顺序形态与本体层', () => {
  for (const key of ['0-1-2', '0-2-1', '1-0-2', '1-2-0', '2-0-1', '2-1-0']) {
    assert.ok(splash.includes("'" + key + "':"), '缺少形态 ' + key)
  }
  for (const motif of ['crest', 'halo', 'storm', 'ghost', 'mirror', 'echo']) {
    assert.match(splash, new RegExp("motif: '" + motif + "'"), '缺少 motif ' + motif)
  }
  assert.match(splash, /FORM_BODY_SPECS/)
  assert.match(splash, /function buildFormBody\(/)
  assert.match(splash, /data-form-motif/)
})
ok('splash.js 不依赖外部库', () => {
  assert.equal(/import\s+.*from|require\(/.test(splash), false)
})

/* ── 2. 新插件不得混入旧插件命名/文案 ─────────────────────────────── */
const OLD_TOKENS = [
  'dsh-startup-screen',
  '需要访问许可',
  '身份资料确认',
  '接收访问需求',
  '读取完毕',
  'JOYCE MOORE',
  '暖白',
  'dsu-',
  'POWERED BY DEEPSEEK'
]
for (const token of OLD_TOKENS) {
  ok('没有旧插件痕迹 ' + token, () => {
    for (const [file, text] of [['splash.js', splash], ['splash.css', css], ['client.js', client], ['index.js', index], ['preview', preview]]) {
      assert.equal(text.includes(token), false, file + ' 出现 ' + token)
    }
  })
}

/* ── 3. 样式契约 ────────────────────────────────────────────────────── */
for (const sel of [
  '.yomi-root',
  '.yomi-video',
  '.yomi-canvas',
  '.yomi-charge-ring',
  '.yomi-node',
  '.yomi-reveal-name',
  '.yomi-phase-reveal',
  '.yomi-no-video',
  '.yomi-reduced',
  '.yomi-scan'
]) {
  ok('splash.css 含 ' + sel, () => assert.ok(css.includes(sel), '缺少 ' + sel))
}
ok('splash.css 为六种 motif 提供本体层样式', () => {
  assert.match(css, /\.yomi-form-body\b/)
  for (const motif of ['crest', 'halo', 'storm', 'ghost', 'mirror', 'echo']) {
    assert.ok(css.includes('data-motif="' + motif + '"'), '缺少 motif 样式 ' + motif)
  }
})
ok('splash.css 主色走 CSS 变量', () => {
  assert.match(css, /--yomi-a:/)
  assert.match(css, /--yomi-b:/)
})
ok('splash.css 有扫描线但默认半透明，不是实心遮罩', () => {
  const scan = css.slice(css.indexOf('.yomi-scan'))
  assert.match(scan, /repeating-linear-gradient/)
})

/* ── 4. 预览页 ──────────────────────────────────────────────────────── */
ok('preview 同时支持 file:// 与 http://', () => {
  assert.match(preview, /location\.protocol === 'file:'/)
  assert.match(preview, /'\/dsh-yomi\/'/)
  assert.match(preview, /__DSH_YOMI_ASSET_BASE__/)
  assert.match(preview, /splash\.js/)
  assert.match(preview, /splash\.css/)
  assert.match(preview, /<div id="dsh-yomi-root"><\/div>/)
})
ok('preview 带 phase 强制开关', () => assert.match(preview, /__DSH_YOMI_PREVIEW_PHASE__/))

/* ── 5. 宿主 / 设置页 / 三处配置字段对齐 ───────────────────────────── */
const CONFIG_KEYS = [
  'enabled', 'mode', 'speed', 'interaction', 'allowSkip', 'identity', 'rank',
  'fragments', 'colorA', 'colorB', 'video', 'bgm', 'bgmVolume', 'sfx',
  'sfxVolume', 'scanlines', 'reducedMotion', 'glitch'
]
for (const key of CONFIG_KEYS) {
  ok('宿主 DEFAULTS 含 ' + key, () => {
    const block = index.slice(index.indexOf('const DEFAULTS'), index.indexOf('const BOOL_KEYS'))
    assert.ok(block.includes(key + ':'), 'index.js DEFAULTS 缺少 ' + key)
  })
  ok('运行时 DEFAULTS 含 ' + key, () => {
    const block = splash.slice(splash.indexOf('var DEFAULTS'), splash.indexOf('function clamp'))
    assert.ok(block.includes(key + ':'), 'splash.js DEFAULTS 缺少 ' + key)
  })
  ok('设置页含 ' + key, () => assert.ok(client.includes(key), 'client.js 缺少 ' + key))
}
ok('宿主注册了预览路由', () => {
  assert.match(index, /ROUTE_BASE \+ '\/preview'/)
  assert.match(index, /readPreviewHtml/)
})
ok('素材白名单含主母版/回退/海报/音频/语音', () => {
  assert.match(index, /'hero-loop\.mp4'/)
  assert.match(index, /'hero-loop\.webm'/)
  assert.match(index, /'hero\.mp4'/)
  assert.match(index, /'hero-poster\.jpg'/)
  assert.match(index, /'bgm\.mp3'/)
  assert.match(index, /'voice-echo\.mp3'/)
  assert.match(index, /'voice-reveal\.mp3'/)
})
ok('设置页注册 id 与插件同名', () => {
  assert.match(client, /load\(\{\s*\n?\s*id: 'dsh-startup-yomi'/)
  assert.match(index, /const name = 'dsh-startup-yomi'|const NS = 'dsh-startup-yomi'/)
})
ok('package.json 名称/版本/入口正确', () => {
  assert.equal(pkg.name, 'dsh-startup-yomi')
  assert.equal(pkg.version, '0.3.2')
  assert.equal(pkg.main, 'lib/index.js')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'))
})
ok('cordis.patch.yml 有 insert 条目', () => {
  const yml = read('cordis.patch.yml')
  assert.match(yml, /insert:/)
  assert.match(yml, /dsh-startup-yomi/)
})

/* ── 6. 素材 ────────────────────────────────────────────────────────── */
const ASSETS = [
  ['lib/assets/hero-loop.mp4', 500 * 1024],
  ['lib/assets/hero-loop.webm', 500 * 1024],
  ['lib/assets/hero.mp4', 500 * 1024],
  ['lib/assets/hero-poster.jpg', 20 * 1024],
  ['lib/assets/bgm.mp3', 100 * 1024],
  ['lib/assets/voice-echo.mp3', 10 * 1024],
  ['lib/assets/voice-reveal.mp3', 10 * 1024]
]
for (const [rel, min] of ASSETS) {
  if (!exists(rel)) {
    skip(rel, '素材不入库，本地未生成')
    continue
  }
  ok(rel + ' 体积合理', () => {
    const size = fs.statSync(path.join(ROOT, rel)).size
    assert.ok(size > min, rel + ' 只有 ' + size + ' 字节，低于 ' + min)
  })
}
for (const rel of ['lib/assets/hero-loop.mp4', 'lib/assets/hero.mp4']) {
  if (!exists(rel)) continue
  ok(rel + ' 不是空壳（存在 ftyp 结构）', () => {
    const fd = fs.openSync(path.join(ROOT, rel), 'r')
    const head = Buffer.alloc(64)
    fs.readSync(fd, head, 0, 64, 0)
    fs.closeSync(fd)
    assert.ok(head.includes(Buffer.from('ftyp')), '缺少 ftyp box')
  })
}
if (exists('lib/assets/hero-loop.webm')) {
  ok('hero-loop.webm 是 WebM/EBML 容器', () => {
    const fd = fs.openSync(path.join(ROOT, 'lib/assets/hero-loop.webm'), 'r')
    const head = Buffer.alloc(4)
    fs.readSync(fd, head, 0, 4, 0)
    fs.closeSync(fd)
    assert.deepEqual([...head], [0x1a, 0x45, 0xdf, 0xa3], '缺少 EBML 头：' + head.toString('hex'))
  })
}
for (const rel of ['lib/assets/voice-echo.mp3', 'lib/assets/voice-reveal.mp3']) {
  if (!exists(rel)) continue
  ok(rel + ' 是 MP3（ID3 或 MPEG 帧同步）', () => {
    const fd = fs.openSync(path.join(ROOT, rel), 'r')
    const head = Buffer.alloc(4)
    fs.readSync(fd, head, 0, 4, 0)
    fs.closeSync(fd)
    const id3 = head.toString('latin1').startsWith('ID3')
    const sync = head[0] === 0xFF && (head[1] & 0xE0) === 0xE0
    assert.ok(id3 || sync, '既不是 ID3 也不是 MPEG 帧同步：' + head.toString('hex'))
  })
}
ok('assets/README.md 说明了素材来源与不入库', () => {
  const md = read('lib/assets/README.md')
  assert.match(md, /不入库|不随仓库|本地/)
})

if (failures.length) {
  console.error('\nFAIL ' + failures.length + ' / PASS ' + pass)
  for (const f of failures) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log('smoke-splash: PASS ' + pass + ' 项')
