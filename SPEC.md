# dsh-startup-yomi — 设计规格（Single Source of Truth）

> 独立插件，自带视觉语言与交互逻辑。宿主注入机制参考 DSH 官方
> webServer tapIndex / config API / client settings section 的通用做法。

## 0. 身份

| 项 | 值 |
|---|---|
| 包名 | `dsh-startup-yomi` |
| 版本 | `0.3.3` |
| 中文名 | 黄泉启动序列 |
| 版本主题 | 由你拾起（主动版） |
| 插件命名空间 NS | `dsh-startup-yomi` |
| 路由前缀 | `/dsh-yomi` |
| 配置文件名 | `~/.dsh/dsh-startup-yomi.json` |
| 注入根节点 | `#dsh-yomi-root` |
| 锁屏 class | `yomi-lock`（挂在 `<html>`） |
| 全局配置对象 | `window.__DSH_YOMI__` |
| 全局 API | `window.__DSH_YOMI_API__`（`replay()` / `skip()` / `state` / `charge` / `echo` / `order` / `form` / `formName`） |
| localStorage / sessionStorage | `dsh-startup-yomi:day` / `dsh-startup-yomi:shown` |

## 1. 视觉

- 全屏动态母版：优先 `lib/assets/hero-loop.mp4`（1920×1080，15.000s，30fps，H.264，无音轨，首末帧 SSIM `0.90462`）；H.264 不可用或加载失败时回退 `hero-loop.webm`（VP8），再回退 `hero.mp4`（1920×1080，16s）；三路视频都失败仍显示 `hero-poster.jpg` 角色层，只有海报也缺失才回落程序化 Canvas。
- 叠加层：Canvas 2D 画雷弧 / 粒子 / 扫描线；CSS 做暗角、色散、扫描线、噪点。
- 主色 `colorA`（默认 `#ff2d55` 电光红）、副色 `colorB`（默认 `#7a5cff` 残响紫）。
- 字体：标题用 `"Noto Serif SC", "Source Han Serif SC", "Songti SC", "STSong", serif`；正文用
  `ui-monospace, "Cascadia Mono", Consolas, monospace`；中文说明用 `"Noto Sans SC", "Microsoft YaHei", sans-serif`。
- 文字方向：中文大字 + 英文全大写等宽小字。**禁止**出现旧插件的橙色强调色、暖白底、环形准星。
- 当前布局（0.3.3 沿用 0.3.1 的空间关系）：
  - LINK：左侧「由你拾起」碑文，底部中央一枚约 `128–152px` 的可按住核心；核心下方显示小号实时百分比，`HOLD` 保留为无障碍文本。角色母版随蓄能从暗到明显影，右下 `SYNC` 数字、刻线与进度条同步。
  - ECHO：左侧「三道残响」标题；底部中央独立残响谱，三槽进入即全部显示，点击立即填色与序号。
  - REVEAL：左侧以形态名为主标题，`欢迎回来，<身份>` 与称号退为第二层；只显示第二句台词。
- HUD 元素：左上 `黄泉 / YOMI`，右上 `SKIP`，底部 `SYNC 00%` 进度刻线。
- 六种顺序形态会持久改写主角本体：轮廓残影、镜像、光环、胸印与雷压各不相同，不是只换文案或色温。

## 2. 交互逻辑（全新，非线性）

配置 `interaction` 三档：

- `off`：不要求输入，`dormant → link → echo → reveal`（蓄力与三枚收集自动进行）。
- `quick`：单击一次完成接入，随后自动收集三枚碎片。
- `full`（默认）：
  1. **HOLD 接入**：按住鼠标左键 / Space / Enter，蓄力环 1.8s 充满；松开未满则回落。
     蓄力时画面从虚焦去饱和逐渐清晰，雷弧跟随指针；核心只显示「按住」。
  2. **三枚残响碎片**：蓄满后出现 3 个节点，**可任意顺序点击**，每点一枚：
     - 底部残响谱立即填入该碎片的语义色与序号；
     - `SYNC` 增加 33%，节点碎裂消失，打字机日志写入；
     - 三种点击各有独立语言（见 2.2）。
  3. 3/3 后按完整顺序定型（六种排列之一），自动进入 `reveal`。
- 任何阶段：Esc 或右上 SKIP 直接 reveal（`allowSkip=true` 时）。
- 无输入超时：`full` 档静置 6.5s 只把提示改成「她还在等。按住，别松手。」，
  **不自动降级、不自动退出、不自行蓄能**。宿主侧 8s 看门狗只负责
  `splash.js` 根本没跑起来的黑屏兜底，不参与正常序列。

### 2.1 六种顺序形态

碎片索引固定为：`0` 雷声之前（力量）、`1` 她曾在此（记忆）、`2` 名字已归还（命名）。
点击顺序写入残响谱，3/3 后按完整排列定型；六种排列必须产生六种不同的主角本体状态。

| 顺序 | 形态 | motif | 本体变化 |
|---|---|---|---|
| `0-1-2` | 溯名者 THE NAME-TRACER | `crest` | 近景、金色胸印与轮廓线 |
| `0-2-1` | 执灯者 THE LAMPBEARER | `halo` | 人物略抬、头后月白光环展开 |
| `1-0-2` | 归雷者 THE THUNDER RETURNED | `storm` | 宽景、左右双影退开、持续落雷 |
| `1-2-0` | 拾忆者 THE MEMORY KEEPER | `ghost` | 人物左收、向右三层冷蓝拖影 |
| `2-0-1` | 问名者 THE ASKER | `mirror` | 右侧镜像、镜面缝成为中轴 |
| `2-1-0` | 余响者 THE AFTERECHO | `echo` | 人物停正中、左右四层对称余响 |

实现约定：`data-form` 记录顺序键，`data-form-motif` 记录形态；`.yomi-form-body` 用本地母版/海报捕获的轮廓做持续残响。`prefers-reduced-motion` 下停掉漂移与抖动，只保留静态本体差异；母版视频本身继续播放，角色与背景的连续呼吸不被静态海报替换。

### 2.2 三种点击语言

| 碎片 | 视觉 | 镜头 / 本体 | 声音 |
|---|---|---|---|
| 雷（力量） | 白闪、两道裂痕、红色冲击波 | 镜头后坐 640ms、头部受击残影 | `zap(1)` + `rumble(1)` |
| 影（记忆） | 去饱和、数字列倒带、时间冻结 380ms | 母版暂停 520ms 后恢复，头部慢速摆动 | `shimmer(0.9)` + `rumble(0.42)` |
| 名（命名） | 金色光柱、两次同心冲击、眼睛上抬 | 头部抬起 1.2s、金瞳停留 1.5s | `bell(0.9)` + `rumble(0.55)` |

### 2.3 分段台词

```
三道残响，由你拾起。
顺序，就是我回来的样子。
```

- `voice-echo.mp3`：3.480s / 320 kbps / 48 kHz，第一句「三道残响，由你拾起。」；
- `voice-reveal.mp3`：3.672s / 320 kbps / 48 kHz，第二句「顺序，就是我回来的样子。」；
  两段均为独立完整语音，文件名即台词，从 `0.02s` 起播到自然结束。
- 语音进入时 BGM 用 `sound.duck(true, 620)` 压到 35%，播完后恢复；
  语音加载失败或被自动播放策略拦截时，`duck(false, 900)` 恢复 BGM。
- ECHO 出场即显示第一句「三道残响，由你拾起。」，约 `320ms` 后播放 `voice-echo.mp3`；进入 SYNC／REVEAL 时清除该句 DOM。
- REVEAL 只显示第二句「顺序，就是我回来的样子。」，约 `250ms` 后播放 `voice-reveal.mp3`。

## 3. 配置字段（Host 侧 DEFAULTS 与此严格一致）

```js
{
  enabled: true,
  mode: 'session',        // session | always | daily
  speed: 1,               // 0.6 – 2.0
  interaction: 'full',    // full | quick | off
  allowSkip: true,
  identity: 'OPERATOR',   // 揭幕第二行身份，最多 24 字
  rank: '雷鸣的残响',      // 称号，最多 24 字
  fragments: '雷声之前|她曾在此|名字已归还', // 三段，| 分隔，最多 3 段
  colorA: '#ff2d55',
  colorB: '#7a5cff',
  video: true,            // 关掉视频仍保留海报角色；视频失败按 WebM/回退母版/海报顺序降级
  bgm: true,
  bgmVolume: 0.35,
  sfx: true,
  sfxVolume: 0.6,
  scanlines: true,
  reducedMotion: false,   // 关整幅位移/残影/雷暴，但保留母版视频
  glitch: 0.6             // 0 – 1，揭幕故障强度
}
```

## 4. 宿主半侧（lib/index.js）职责

1. `inject = ['webServer', 'connection']`；`apply(ctx)` 用
   `webServer.register(...)` + `webServer.tapIndex((html) => ...)` 注入。
2. `tapIndex` 注入内容：
   - 关键 CSS：`html.yomi-lock` 锁滚动，`#dsh-yomi-root{position:fixed;inset:0;z-index:2147483000;background:#000}`
   - `<div id="dsh-yomi-root" class="yomi-boot"></div>`
   - `<script>window.__DSH_YOMI__=<config>;window.__DSH_YOMI_VERSION__=...;` + 兜底 JS（关闭 / 8s 超时放行）
   - `<link rel="stylesheet" href="/dsh-yomi/splash.css">`
   - `<script defer src="/dsh-yomi/splash.js"></script>`
3. 路由：
   - `GET /dsh-yomi/splash.css`、`GET /dsh-yomi/splash.js`（带 mtime 缓存）
   - `GET /dsh-yomi/config`、`POST /dsh-yomi/config`（JSON，白名单字段 + 区间夹取，原子写）
   - `GET /dsh-yomi/asset/:name`：只允许白名单
     `hero-loop.mp4`、`hero-loop.webm`、`hero.mp4`、`hero.webm`、`hero-poster.jpg`、`bgm.mp3`、
     `voice-echo.mp3`、`voice-reveal.mp3`、`font-brush.woff2`、`sfx-charge.mp3`。
     必须支持 **HTTP Range**（206 + Content-Range），视频才能稳定播放；
     不存在时返回 404（不抛异常）。
4. 配置持久化到 `~/.dsh/dsh-startup-yomi.json`，读取失败回落 DEFAULTS。
5. 客户端半侧自举：`client.js` 注册 `settings.section`，id 必须等于 `dsh-startup-yomi`。
6. 不要采集旧插件那套「真实事实」（profile/模型/插件数）；新插件不需要。

## 5. 设置页（lib/client.js）

`settings.section` 标题「黄泉启动序列」，字段分组：

- 播放：启用 / 显示模式 / 速度 / 交互强度 / 允许跳过
- 角色：身份名称 / 称号 / 三段残响文案（单个输入框，`|` 分隔）
- 视觉：主色 / 副色 / 扫描线 / 故障强度
- 声音：动态母版开关 / BGM / BGM 音量 / 音效 / 音效音量

顶部显示版本号与「预览」按钮（`window.open('/dsh-yomi/preview')` 可留空）。
保存按钮 POST 到 `/dsh-yomi/config`，成功后提示「已保存」，改动下次启动生效。
样式必须用 DSH 设置页 CSS 变量，不要自定义大面积背景。

## 6. 素材（本地，不入库）

`lib/assets/` 下：

- `hero-loop.mp4`（主母版，1920×1080 / 15.000s / 30fps / H.264 / 无音轨，首末帧 SSIM `0.90462`）
- `hero-loop.webm`（动态兼容回退，1920×1080 / 15.000s / 30fps / VP8）
- `hero.mp4`（回退母版，1920×1080 / 16s / H.264）
- `hero-poster.jpg`（首帧，必须）
- `bgm.mp3`（可选，75s 循环片段）
- `voice-echo.mp3`（第一句，3.480s，文件名即台词）
- `voice-reveal.mp3`（第二句，3.672s，文件名即台词）
- `font-brush.woff2`（可选）
- `sfx-charge.mp3`（可选）

这些文件加入根 `.gitignore`；`lib/assets/README.md` 说明来源与自制方法。
`splash.js` 必须先建立永久 `.yomi-hero-still` 海报层，再尝试视频源；`error` 事件只移除
`<video>`，不得删除角色层。视频顺序为 `hero-loop.mp4 → hero-loop.webm → hero.mp4`，
播放器不支持 H.264 时优先 WebM；全部失败时继续显示海报，海报也失败才走程序化背景。

## 7. 测试与交付

- `test/smoke-host.mjs`：起最小 fake webServer，断言注入 HTML 含根节点/配置/脚本，
  版本为 `0.3.3`，路由可用，`hero.mp4` / `hero-loop.mp4` / `hero-loop.webm` Range 与
  `voice-echo.mp3` / `voice-reveal.mp3` GET 生效，404 优雅。
- `test/smoke-splash.mjs`：vm + 静态契约，断言 `splash.js` 可编译、创建 DOM、
  API `replay/skip` 存在，**不含 `90000`**，海报永久层、多源回退、SYNC 联动与分段语音存在，
  三处配置字段对齐，素材白名单包含 `hero-loop.mp4` / `hero-loop.webm` / `voice-echo.mp3` / `voice-reveal.mp3`。
- `preview/index.html`：独立打开即可预览，支持 `?phase=`、`?charge=`、`?echo=`、
  `?order=`、`?novideo=1`、`?reduced=1`、`?clean=1`。
- `README.md`（安装/设置/素材）、`INSTALL.md`、`THIRD-PARTY-NOTICES.md`、`cordis.patch.yml`。
- 构建：`scripts/build.cmd` 或 `npm pack` 产出 `releases/dsh-startup-yomi-<ver>.tgz`。
- 截图验收：`scripts/shots.mjs` 在 1600×900 与 1920×1080 下覆盖 LINK、ECHO 早帧、
  SYNC、REVEAL、`?novideo=1` 与六种终帧；manifest 的 `state/charge/nodeDone/formBody`
  必须与预期一致，且无视频场景仍能通过像素统计确认角色海报存在。

## 8. 开源发布与安装

- 公开仓库：`https://github.com/QIFANAI/dsh-startup-yomi`。
- 代码 MIT；`lib/assets/` 的第三方声画不入库、不进官方 Release。
- `scripts/build-release.mjs --mode source` 只复制 `git ls-files`，保证公开包不含本地素材。
- `release.json` 固定版本、资产名、大小与 SHA-256/512；官方 Release 同时提供
  `SHA256SUMS`、`SHA512SUMS` 与 `release.json`。
- `scripts/install.mjs` 先校验再调用 `dsh plugin`；`--dry-run` 只下载校验。
- 干净克隆测试允许跳过素材用例；本机完整素材下仍须 39 + 145 项 PASS。
- `npm run check` 检查本机路径、未授权媒体、版本漂移与 Markdown 本地断链。
