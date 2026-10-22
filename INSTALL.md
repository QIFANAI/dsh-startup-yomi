# 安装 / 升级 / 卸载 / 排错

> 适用版本 **0.3.2**。安装包与校验值以 [Releases](https://github.com/QIFANAI/dsh-startup-yomi/releases) 为准。

## 0. 前置

| 项 | 要求 |
|---|---|
| 平台 | DSH web profile **或** DeepSeek Harness Desktop |
| Node.js | >= 20（安装器与构建脚本；插件运行时零依赖） |
| 依赖 | 无 |
| 权限 | 能执行 `dsh plugin`，并能写入 `~/.dsh/profiles/<profile>` |
| 状态 | 安装前**完全退出** DSH（桌面端连托盘图标一起关） |

## 1. 安装 Release 包（推荐）

### 1.1 安装器

```bash
node scripts/install.mjs --profile desktop --version 0.3.2 --dry-run
node scripts/install.mjs --profile desktop --version 0.3.2
```

如果还没克隆仓库，先下载安装器：

```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/QIFANAI/dsh-startup-yomi/v0.3.2/scripts/install.mjs" -OutFile "install-yomi.mjs"
node install-yomi.mjs --profile desktop --version 0.3.2 --dry-run
node install-yomi.mjs --profile desktop --version 0.3.2
```

安装器会：

1. 读取 GitHub Release 的 `release.json` 与 `SHA256SUMS`；
2. 下载 `dsh-startup-yomi-0.3.2.tgz`；
3. 校验 SHA-256 与文件大小；
4. 调用 `dsh plugin --profile <profile> add <tgz>`。

`--dry-run` 只下载与校验，不安装。`--keep` 保留 tgz。找不到 `dsh` 时用
`--dsh <路径>` 指定。web profile 把 `desktop` 换成 `web`。

### 1.2 手动安装

1. 从 Release 下载 `dsh-startup-yomi-0.3.2.tgz`、`SHA256SUMS`、`release.json`。
2. 校验：

```powershell
(Get-FileHash .\dsh-startup-yomi-0.3.2.tgz -Algorithm SHA256).Hash.ToLower()
Get-Content .\SHA256SUMS
```

```bash
sha256sum -c SHA256SUMS
```

3. 安装并确认：

```bash
dsh plugin --profile desktop add ./dsh-startup-yomi-0.3.2.tgz
dsh plugin --profile desktop list
```

4. 重新打开 DSH。

### 1.3 版本与文件一致性

官方 Release 资产对所有用户是同一份文件：

- 版本：`0.3.2`
- 包名：`dsh-startup-yomi-0.3.2.tgz`
- 文件清单与 SHA-256 由 `release.json`、`SHA256SUMS` 固定；
- 包内不包含第三方声画素材，见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

如果你看到哈希不一致，不要安装，先删除下载文件并重试。

## 2. 从源码安装（开发）

```bash
git clone https://github.com/QIFANAI/dsh-startup-yomi.git
cd dsh-startup-yomi
npm test
dsh plugin --profile desktop add link:/absolute/path/to/dsh-startup-yomi
```

Windows 示例：

```powershell
dsh plugin --profile desktop add link:E:\path\to\dsh-startup-yomi
```

改完 `lib/splash.js`、`lib/splash.css`、`lib/client.js` 后刷新页面即可；
Host 半侧按文件 mtime 缓存，不需要重新打 tgz。

## 3. 验证（0.3.2）

- 启动时黑场约 1 秒 → 母版从虚焦里浮出；
- 左侧主标题为 **「由你拾起」**，底部中央只有一枚小核心；
- 按住鼠标左键 / Space / Enter 1.8 秒 → 雷弧炸开 → 三枚菱形碎片；
- 任意顺序点三枚，底部残响谱每次点击立即填色、填序号；
- SYNC 33/66/100 → 白闪 → 按点击顺序定型；
- 揭幕大标题为形态名（溯名者 / 执灯者 / 归雷者 / 拾忆者 / 问名者 / 余响者），
  `欢迎回来，<身份>` 在第二行；
- Esc 或右上 SKIP 可跳过；
- 设置页顶部版本号应为 `0.3.2`。

没有素材时，以上流程仍完整；只是人物视频、BGM 与两段语音会走降级链。
若需完整声画，按 [lib/assets/README.md](lib/assets/README.md) 放入你有权使用的素材，
并用 `npm run build:full` 生成仅供本机使用的完整包。

## 4. 升级

1. 完全退出 DSH；
2. 用安装器指定新版本，或手动 `dsh plugin --profile desktop add <新 tgz>`；
3. 重新启动，确认设置页版本号变化。

pnpm 的 profile lock 会记录 tgz 的 integrity。不要用同一版本号重新打包后覆盖旧包；
发版必须升版本号并由 CI 重新生成 `release.json`。

## 5. 卸载

```bash
dsh plugin --profile desktop remove dsh-startup-yomi
```

配置文件 `~/.dsh/dsh-startup-yomi.json` 可留可删；删除后回到默认值。

## 6. 常见问题

| 现象 | 处理 |
|---|---|
| 设置页没有「黄泉启动序列」 | 完全退出 DSH 再启动；检查 `dsh plugin --profile <profile> list` 是否含 `dsh-startup-yomi` |
| 启动层黑屏 / 直接跳过 | 看控制台是否有 `splash.js` 404；检查 `~/.dsh/dsh-startup-yomi.json` 是否 `"enabled": false` |
| 没有人物视频，只有雷弧背景 | 官方包不含第三方视频；把素材放进 `lib/assets/`，或接受 Canvas 降级 |
| 没有声音 / 没有台词 | 官方包不含 BGM 与语音；浏览器自动播放策略也会拦截，首次点击/按键后才会起播 |
| 锁定在 LINK，按不住 | 确认交互强度为「完整」；`快速` 是单击接入，`关闭` 是纯播放 |
| 动画太慢/太快 | 设置页「速度」0.6 – 2.0 |
| 和另一个启动动画叠在一起 | 同时启用了别的启动动画插件；只启用其中一个，或卸载另一个 |
| 桌面端提示 profile 被占用 | 先完全退出 DSH（含托盘图标），再执行 `dsh plugin ...` |

更多设计说明见 [SPEC.md](SPEC.md)，维护流程见 [MAINTAIN.md](MAINTAIN.md)。
