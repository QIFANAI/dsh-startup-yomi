# 维护手册 · 升级 / 发布 / 回滚

> 设计口径以 [SPEC.md](SPEC.md) 为唯一源；安装与排错以 [INSTALL.md](INSTALL.md) 为准。
> 本页只管「以后怎么改、怎么发、怎么退」。

## 1. 目录职责

| 路径 | 职责 | 改完如何生效 |
|---|---|---|
| `lib/index.js` | Host 半侧：`/dsh-yomi/*` 路由、客户端注入、配置读写 | 重启 DSH |
| `lib/client.js` | 设置页「黄泉启动序列」 | 刷新客户端 |
| `lib/splash.js`、`lib/splash.css` | 启动序列画面、交互与六种形态 | 刷新客户端 |
| `lib/assets/` | 本地声画素材（不入库、不进官方 Release） | 刷新客户端 |
| `preview/index.html` | 离线预览：`?phase=`、`?order=`、`?novideo=1`、`?clean=1` | 双击即看 |
| `test/` | 两套冒烟断言 | `npm test` |
| `scripts/build-release.mjs` | 可复现 source 包 / 本地 full 包 | `npm run build` / `build:full` |
| `scripts/check-public.mjs` | 公开仓库门禁 | `npm run check` |
| `scripts/install.mjs` | Release 下载、校验、交给 `dsh plugin` | `node scripts/install.mjs` |
| `scripts/prepare-assets.py` | 从自有素材转码、抽帧、响度归一 | 见 assets README |
| `.github/workflows/` | CI 与 tag 发布 | push / tag |
| `release.json` | 当前 Release 的版本、大小、SHA-256/512 | 构建后写回并提交 |

## 2. 本地开发

```bash
npm test
npm run check
node scripts/build-release.mjs --mode full   # 仅本机完整声画
```

无素材时测试会跳过素材用例；带素材时跑完整 39 + 145 项。两种都必须 PASS。

## 3. 发版流程（按序执行）

1. **升版本号**：`package.json` 的 `version`；同步 `README.md`、`INSTALL.md`、
   `SPEC.md`、`test/smoke-splash.mjs` 的版本断言。
2. `npm test`：全 PASS。
3. `npm run check`：公开门禁全 PASS。
4. `npm run build`：只打包 git 已跟踪文件；产物 `releases/dsh-startup-yomi-<ver>.tgz`。
5. `npm run build -- --write-manifest`：重建并写 `release.json`。
6. `git add -A && git commit`，确认工作区干净。
7. `git tag v<ver> && git push origin main --tags`。
8. GitHub Actions 的 `release` 工作流会重新建包、比对 `release.json`，然后创建 Release。
9. 用安装器做一次真实安装验收：

```bash
node scripts/install.mjs --profile desktop --version <ver> --dry-run
```

**不要**手动上传 `releases/*-full.tgz`。它包含第三方声画，只许本机自用。

## 4. 可复现构建

- source 模式只复制 `git ls-files` 的结果；
- 文件 mtime 统一为 1985-10-26，npm 打包时排序固定；
- Release 工作流固定使用 npm 11.19.0，与本地生成 `release.json` 的环境一致；
- CI 重建后必须与 `release.json` 的 `size` 与 `sha256` 完全一致，否则失败。
- 远端安装器把 tgz 缓存在 `~/.dsh/cache/dsh-startup-yomi/`；发布验收必须包含
  `pnpm install --offline`，确认缓存路径在安装后仍可解析。

本地若 npm 版本不同，先执行 `npm install -g npm@11.19.0` 再写 manifest。

## 5. 回滚

- 装回旧版：从旧 Release 下载 tgz，按 [INSTALL.md](INSTALL.md) 安装；
- 恢复默认设置：删除 `~/.dsh/dsh-startup-yomi.json`；
- 源码回滚：`git checkout <旧 tag>` 后重新 `dsh plugin ... add link:<仓库绝对路径>`。

## 6. 已知事项

- 不要与其他启动动画插件同时启用（两层启动层会叠加）；
- 完整档静置 6.5 秒只改提示，不会自动退出；
- 素材降级链：`hero-loop.mp4` → `hero-loop.webm` → `hero.mp4` → `hero-poster.jpg` → Canvas；
- 语音缺失或被浏览器拦截时静默并恢复 BGM；
- 官方 Release 是 source-only，不含第三方角色视频、商业 BGM 与揭幕语音。
