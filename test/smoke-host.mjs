/* dsh-startup-yomi — 宿主半侧冒烟测试
 *
 * 不监听端口：起一个最小 fake webServer，把 apply(ctx) 注册的路由与 tapIndex
 * 注入函数抓出来，直接驱动 handler(req,res)。这样测的是真实代码路径。
 *
 * 运行：node test/smoke-host.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'

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
async function okAsync(name, fn) {
  try {
    await fn()
    pass++
  } catch (err) {
    failures.push(name + ': ' + (err && err.message ? err.message : String(err)))
  }
}
function eq(a, b, msg) {
  assert.deepEqual(a, b, msg)
}

/* 临时 DSH_HOME：配置写在里面，不碰用户真实目录 */
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-yomi-home-'))
process.env.DSH_HOME = tmpHome

const { apply, inject, name } = await import('../lib/index.js')

assert.equal(name, 'dsh-startup-yomi', '导出 name 必须是插件命名空间')
assert.deepEqual(inject, ['webServer', 'connection'], 'inject 必须声明 webServer/connection')

const routes = []
const indexFns = []
const effects = []
const server = {
  register(route) {
    routes.push(route)
    return () => {}
  },
  tapIndex(fn) {
    indexFns.push(fn)
    return () => {}
  }
}
const ctx = {
  logger: { warn() {} },
  get(n) {
    if (n === 'webServer') return server
    if (n === 'connection') return { requestRejection: () => null }
    return undefined
  },
  effect(fn) {
    effects.push(fn)
    return () => {}
  }
}

apply(ctx)

ok('注册了 5 个路由（样式/脚本/预览/配置/素材）', () => {
  eq(routes.length, 5)
  const paths = routes.map((r) => r.path).sort()
  eq(paths, [
    '/dsh-yomi/asset',
    '/dsh-yomi/config',
    '/dsh-yomi/preview',
    '/dsh-yomi/splash.css',
    '/dsh-yomi/splash.js'
  ].sort())
})
ok('注册了 1 个 index 注入函数', () => eq(indexFns.length, 1))
ok('注册了 effect 清理', () => eq(typeof effects[0], 'function'))

function routeByPath(p) {
  return routes.find((r) => r.path === p) || routes.find((r) => r.kind === 'prefix' && p.startsWith(r.path + '/'))
}
function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: undefined,
    writeHead(code, headers) {
      this.statusCode = code
      if (headers) Object.assign(this.headers, headers)
      return this
    },
    end(chunk) {
      this.body = chunk
      this.ended = true
    }
  }
}
function makeReq({ method = 'GET', url = '/', headers = {}, body = null } = {}) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = headers
  if (body !== null) {
    process.nextTick(() => {
      req.emit('data', Buffer.from(body))
      req.emit('end')
    })
  }
  return req
}
async function call(routePath, options) {
  const route = routeByPath(routePath)
  if (!route) throw new Error('route not registered: ' + routePath)
  const res = makeRes()
  await route.handler(makeReq(Object.assign({}, options, { url: routePath })), res)
  return res
}

/* ── tapIndex 注入 ───────────────────────────────────────────────────── */
const PAGE = '<!doctype html><html><head><title>DSH</title></head><body><div id="app"></div></body></html>'
let injected = ''
ok('tapIndex 可调用', () => {
  injected = indexFns[0](PAGE)
  assert.equal(typeof injected, 'string')
})
ok('注入含根节点 #dsh-yomi-root', () => assert.match(injected, /<div id="dsh-yomi-root"[^>]*><\/div>/))
ok('注入含关键 CSS', () => {
  assert.match(injected, /dsh-yomi-critical/)
  assert.match(injected, /html\.yomi-lock/)
  assert.match(injected, /#dsh-yomi-root\{position:fixed/)
})
ok('注入含配置对象', () => {
  assert.match(injected, /window\.__DSH_YOMI__=/)
  assert.match(injected, /"identity":"OPERATOR"/)
  assert.match(injected, /"fragments":"雷声之前\|她曾在此\|名字已归还"/)
})
const pkgVersion = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
ok('注入含版本号', () => assert.ok(injected.includes(`window.__DSH_YOMI_VERSION__="${pkgVersion}"`)))
ok('注入含运行时脚本 defer', () => assert.match(injected, /<script defer src="\/dsh-yomi\/splash\.js"><\/script>/))
ok('注入含样式表链接', () => assert.match(injected, /<link rel="stylesheet" href="\/dsh-yomi\/splash\.css">/))
ok('注入含 8 秒兜底', () => assert.match(injected, /8000/))
ok('注入含 sessionStorage 键', () => assert.match(injected, /dsh-startup-yomi:shown/))
ok('注入含 daily 键', () => assert.match(injected, /dsh-startup-yomi:day/))
ok('重复注入幂等（检测到 splash.js 就不再插）', () => eq(indexFns[0](injected), injected))
ok('无 </head> 时插到最前面', () => {
  const out = indexFns[0]('<html><body>x</body></html>')
  assert.match(out, /^<link rel="stylesheet"/)
})

/* ── splash.css / splash.js / preview ────────────────────────────────── */
for (const [p, type] of [
  ['/dsh-yomi/splash.css', 'text/css'],
  ['/dsh-yomi/splash.js', 'application/javascript'],
  ['/dsh-yomi/preview', 'text/html']
]) {
  await okAsync(p + ' 返回 200 且非空', async () => {
    const res = await call(p)
    eq(res.statusCode, 200)
    assert.match(String(res.headers['Content-Type']), new RegExp(type))
    assert.ok(res.body && String(res.body).length > 100, 'body 太小')
  })
}
await okAsync('preview 是完整 HTML 且含根节点', async () => {
  const res = await call('/dsh-yomi/preview')
  assert.match(String(res.body), /<div id="dsh-yomi-root"><\/div>/)
  assert.match(String(res.body), /__DSH_YOMI_ASSET_BASE__/)
})

/* ── config ─────────────────────────────────────────────────────────── */
await okAsync('GET config 返回默认值', async () => {
  const res = await call('/dsh-yomi/config')
  eq(res.statusCode, 200)
  const body = JSON.parse(String(res.body))
  eq(body.ok, true)
  eq(body.config.interaction, 'full')
  eq(body.config.speed, 1)
  eq(body.config.fragments, '雷声之前|她曾在此|名字已归还')
  eq(body.config.colorA, '#ff2d55')
  assert.equal(typeof body.file, 'string')
})
await okAsync('POST 合法 patch 落盘并夹取', async () => {
  const res = await call('/dsh-yomi/config', {
    method: 'POST',
    body: JSON.stringify({ speed: 99, glitch: -5, fragments: 'a|b|c|d|e', identity: '鸣', colorA: 'not-a-color' })
  })
  eq(res.statusCode, 200)
  const body = JSON.parse(String(res.body))
  eq(body.config.speed, 2)
  eq(body.config.glitch, 0)
  eq(body.config.fragments, 'a|b|c')
  eq(body.config.identity, '鸣')
  eq(body.config.colorA, '#ff2d55')
  assert.ok(fs.existsSync(path.join(tmpHome, 'dsh-startup-yomi.json')))
})
await okAsync('POST 非法 JSON → 400', async () => {
  const res = await call('/dsh-yomi/config', { method: 'POST', body: '{oops' })
  eq(res.statusCode, 400)
  eq(JSON.parse(String(res.body)).ok, false)
})
await okAsync('POST reset 恢复默认', async () => {
  const res = await call('/dsh-yomi/config', { method: 'POST', body: JSON.stringify({ action: 'reset' }) })
  eq(res.statusCode, 200)
  eq(JSON.parse(String(res.body)).config.identity, 'OPERATOR')
})
await okAsync('GET 非白名单方法 → 405', async () => {
  const res = await call('/dsh-yomi/config', { method: 'DELETE' })
  eq(res.statusCode, 405)
})

/* ── asset 白名单 / Range ───────────────────────────────────────────── */
const heroPath = path.join(process.cwd(), 'lib', 'assets', 'hero.mp4')
const haveHero = fs.existsSync(heroPath)
if (haveHero) {
  const heroSize = fs.statSync(heroPath).size
  await okAsync('hero.mp4 整份 GET 200', async () => {
    const res = await call('/dsh-yomi/asset/hero.mp4')
    eq(res.statusCode, 200)
    eq(res.headers['Content-Type'], 'video/mp4')
    eq(res.headers['Accept-Ranges'], 'bytes')
    eq(Number(res.headers['Content-Length']), heroSize)
  })
  await okAsync('hero.mp4 Range 0-99 → 206 且字节数正确', async () => {
    const res = await call('/dsh-yomi/asset/hero.mp4', { headers: { range: 'bytes=0-99' } })
    eq(res.statusCode, 206)
    eq(res.headers['Content-Range'], 'bytes 0-99/' + heroSize)
    eq(Number(res.headers['Content-Length']), 100)
    eq(Buffer.isBuffer(res.body) ? res.body.length : String(res.body).length, 100)
  })
  await okAsync('hero.mp4 开放区间 bytes=100- → 206', async () => {
    const res = await call('/dsh-yomi/asset/hero.mp4', { headers: { range: 'bytes=100-' } })
    eq(res.statusCode, 206)
    eq(res.headers['Content-Range'], 'bytes 100-' + (heroSize - 1) + '/' + heroSize)
  })
  await okAsync('hero.mp4 末尾区间 bytes=-50 → 206', async () => {
    const res = await call('/dsh-yomi/asset/hero.mp4', { headers: { range: 'bytes=-50' } })
    eq(res.statusCode, 206)
    eq(res.headers['Content-Range'], 'bytes ' + (heroSize - 50) + '-' + (heroSize - 1) + '/' + heroSize)
  })
  await okAsync('不可满足 Range → 416', async () => {
    const res = await call('/dsh-yomi/asset/hero.mp4', { headers: { range: 'bytes=999999999-' } })
    eq(res.statusCode, 416)
    eq(res.headers['Content-Range'], 'bytes */' + heroSize)
  })
  await okAsync('HEAD hero.mp4 → 200 无 body', async () => {
    const res = await call('/dsh-yomi/asset/hero.mp4', { method: 'HEAD' })
    eq(res.statusCode, 200)
    eq(Number(res.headers['Content-Length']), heroSize)
    assert.ok(res.body === undefined || res.body === null)
  })
} else {
  console.log('SKIP: lib/assets/hero.mp4 不存在，跳过 Range 用例（素材不入库属预期）')
}

const heroLoopPath = path.join(process.cwd(), 'lib', 'assets', 'hero-loop.mp4')
if (fs.existsSync(heroLoopPath)) {
  const loopSize = fs.statSync(heroLoopPath).size
  await okAsync('hero-loop.mp4 Range 0-99 → 206 且字节数正确', async () => {
    const res = await call('/dsh-yomi/asset/hero-loop.mp4', { headers: { range: 'bytes=0-99' } })
    eq(res.statusCode, 206)
    eq(res.headers['Content-Type'], 'video/mp4')
    eq(res.headers['Content-Range'], 'bytes 0-99/' + loopSize)
    eq(Number(res.headers['Content-Length']), 100)
    eq(Buffer.isBuffer(res.body) ? res.body.length : String(res.body).length, 100)
  })
} else {
  console.log('SKIP: lib/assets/hero-loop.mp4 不存在，跳过主母版 Range 用例')
}

const heroWebmPath = path.join(process.cwd(), 'lib', 'assets', 'hero-loop.webm')
if (fs.existsSync(heroWebmPath)) {
  const webmSize = fs.statSync(heroWebmPath).size
  await okAsync('hero-loop.webm Range 0-99 → 206 且类型正确', async () => {
    const res = await call('/dsh-yomi/asset/hero-loop.webm', { headers: { range: 'bytes=0-99' } })
    eq(res.statusCode, 206)
    eq(res.headers['Content-Type'], 'video/webm')
    eq(res.headers['Content-Range'], 'bytes 0-99/' + webmSize)
    eq(Number(res.headers['Content-Length']), 100)
    eq(Buffer.isBuffer(res.body) ? res.body.length : String(res.body).length, 100)
  })
} else {
  console.log('SKIP: lib/assets/hero-loop.webm 不存在，跳过 WebM 回退 Range 用例')
}

for (const voiceFile of ['voice-echo.mp3', 'voice-reveal.mp3']) {
  const voicePath = path.join(process.cwd(), 'lib', 'assets', voiceFile)
  if (!fs.existsSync(voicePath)) {
    console.log('SKIP: lib/assets/' + voiceFile + ' 不存在，跳过语音素材用例')
    continue
  }
  const voiceSize = fs.statSync(voicePath).size
  await okAsync(voiceFile + ' 整份 GET 200，类型与字节数正确', async () => {
    const res = await call('/dsh-yomi/asset/' + voiceFile)
    eq(res.statusCode, 200)
    eq(res.headers['Content-Type'], 'audio/mpeg')
    eq(Number(res.headers['Content-Length']), voiceSize)
    eq(Buffer.isBuffer(res.body) ? res.body.length : String(res.body).length, voiceSize)
  })
}
await okAsync('未知文件名 → 404', async () => {
  const res = await call('/dsh-yomi/asset/nope.mp4')
  eq(res.statusCode, 404)
})
await okAsync('路径穿越 → 404', async () => {
  const res = await call('/dsh-yomi/asset/..%2Fpackage.json')
  eq(res.statusCode, 404)
})
await okAsync('非白名单文件（README.md）→ 404', async () => {
  const res = await call('/dsh-yomi/asset/README.md')
  eq(res.statusCode, 404)
})
await okAsync('POST 素材 → 405', async () => {
  const res = await call('/dsh-yomi/asset/hero.mp4', { method: 'POST' })
  eq(res.statusCode, 405)
})
await okAsync('资源不存在时 config 仍可用（优雅降级）', async () => {
  const res = await call('/dsh-yomi/config')
  eq(res.statusCode, 200)
})

/* ── 清理 ───────────────────────────────────────────────────────────── */
fs.rmSync(tmpHome, { recursive: true, force: true })

if (failures.length) {
  console.error('\nFAIL ' + failures.length + ' / PASS ' + pass)
  for (const f of failures) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log('smoke-host: PASS ' + pass + ' 项')
