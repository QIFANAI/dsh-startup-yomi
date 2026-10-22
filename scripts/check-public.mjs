#!/usr/bin/env node
/**
 * 公开仓库门禁：个人路径、私有归档、未授权媒体、版本漂移、断链。
 * 需要 git 索引；CI 在 checkout 后执行。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'release.json'), 'utf8'))
const tracked = execFileSync('git', ['ls-files', '-z'], {
  cwd: ROOT,
  encoding: 'buffer',
}).toString('utf8').split('\0').filter(Boolean)

let passed = 0
const failures = []
function ok(name, fn) {
  try {
    fn()
    passed++
    console.log('PASS ' + name)
  } catch (error) {
    failures.push(name + ': ' + error.message)
    console.error('FAIL ' + name + ': ' + error.message)
  }
}

const textExtensions = /\.(?:md|json|js|mjs|css|html|yml|yaml|py|cmd|ps1|txt|gitignore|gitattributes|editorconfig)$/i
const textFiles = tracked.filter((file) => !['scripts/check-public.mjs', '.gitignore'].includes(file))
  .filter((file) => textExtensions.test(file) || !path.extname(file))
const privatePatterns = [
  [/E:\\dshdesign/i, '本机 E 盘路径'],
  [/C:\\Users\\[^\\\s]+/i, '本机用户目录'],
  [/26547/, '本机用户名'],
  [/_旧版本归档_/, '旧版本归档'],
  [/_开工简报/, '开工简报'],
  [/_install-verify-/, '本地安装验收记录'],
]
const mediaPattern = /^lib\/assets\/.+\.(?:mp4|webm|mp3|wav|jpg|jpeg|png|woff2)$/i

ok('没有把本机路径写进公开文件', () => {
  for (const file of textFiles) {
    const content = fs.readFileSync(path.join(ROOT, file), 'utf8')
    for (const [pattern, label] of privatePatterns) {
      if (pattern.test(content)) throw new Error(`${file} 命中 ${label}`)
    }
  }
})

ok('没有跟踪第三方声画素材', () => {
  const found = tracked.filter((file) => mediaPattern.test(file))
  if (found.length) throw new Error(found.join(', '))
})

ok('版本号在 package / release / 测试之间一致', () => {
  const version = pkg.version
  if (manifest.version !== version) throw new Error('release.json version 不一致')
  if (manifest.tag !== 'v' + version) throw new Error('release.json tag 不一致')
  const splashTest = fs.readFileSync(path.join(ROOT, 'test/smoke-splash.mjs'), 'utf8')
  if (!splashTest.includes(`assert.equal(pkg.version, '${version}')`)) {
    throw new Error('smoke-splash 的版本断言未同步')
  }
  for (const file of ['README.md', 'INSTALL.md', 'SPEC.md']) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8')
    if (!text.includes(version)) throw new Error(`${file} 未出现当前版本 ${version}`)
  }
})

ok('package.json 指向公开仓库与 Release', () => {
  if (!pkg.repository?.url?.includes('github.com/QIFANAI/dsh-startup-yomi')) {
    throw new Error('repository.url 不是公开仓库')
  }
  if (manifest.url !== `https://github.com/QIFANAI/dsh-startup-yomi/releases/download/${manifest.tag}/${manifest.asset}`) {
    throw new Error('release.json 下载地址不正确')
  }
  if (manifest.mediaIncluded !== false) throw new Error('release.json 必须声明 mediaIncluded=false')
})

ok('MIT 授权与上游声明完整', () => {
  const license = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8')
  if (!license.includes('MIT License')) throw new Error('缺少 MIT 正文')
  if (!license.includes('original dsh-startup-screen plugin')) throw new Error('缺少上游版权声明')
  const notice = fs.readFileSync(path.join(ROOT, 'NOTICE'), 'utf8')
  if (!notice.includes('derivative work')) throw new Error('NOTICE 缺少派生作品说明')
})

ok('第三方素材被 .gitignore 排除', () => {
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')
  for (const pattern of ['lib/assets/*.mp4', 'lib/assets/*.mp3', '!lib/assets/README.md']) {
    if (!ignore.includes(pattern)) throw new Error('缺少规则 ' + pattern)
  }
})

ok('Markdown 本地链接都能解析', () => {
  for (const file of tracked.filter((entry) => entry.endsWith('.md'))) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8')
    const base = path.dirname(path.join(ROOT, file))
    const linkPattern = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
    for (const match of text.matchAll(linkPattern)) {
      let target = match[1]
      if (/^(?:https?:|mailto:|#|[<$])/i.test(target)) continue
      if (target.includes('...') || target.includes('{')) continue
      target = target.split('#')[0].split('?')[0]
      if (!target) continue
      const resolved = path.resolve(base, decodeURIComponent(target))
      if (!fs.existsSync(resolved)) throw new Error(`${file} -> ${target}`)
    }
  }
})

ok('发布清单覆盖当前文件', () => {
  for (const entry of pkg.files) {
    const target = path.join(ROOT, entry)
    if (!fs.existsSync(target)) throw new Error('files 条目不存在: ' + entry)
  }
  if (pkg.files.includes('release.json')) throw new Error('release.json 不能进 npm 包（会形成哈希循环）')
})

if (failures.length) {
  console.error(`\n公开门禁失败 ${failures.length} 项 / PASS ${passed}`)
  process.exit(1)
}
console.log(`\ncheck-public: PASS ${passed} 项`)
