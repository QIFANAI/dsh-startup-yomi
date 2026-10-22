# 贡献指南

## 先读什么

- 设计口径：[SPEC.md](SPEC.md) 是唯一源；
- 安装与排错：[INSTALL.md](INSTALL.md)；
- 版权边界：[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

## 开发环境

- Node.js >= 20；
- 不需要安装依赖（项目零运行时依赖）；
- Windows 11 + Edge/Electron 是当前主要实机环境；其他平台欢迎补验证记录。

```bash
npm test
npm run check
```

`npm test` 在没有第三方素材的干净克隆上会跳过素材用例；带素材时跑完整 39 + 145 项。

## 可以提交什么

- 代码、样式、文案、测试、文档改进；
- 程序化 Canvas/WebAudio 降级链改进；
- 安装器、构建可复现性、CI、排错文档；
- 你有明确授权、且能证明授权的素材（默认不接收第三方角色视频/商业 BGM）。

## 不要提交什么

- `lib/assets/` 下的第三方视频、音频、海报；
- 本机路径、用户名、profile 快照、日志、安装验收记录；
- 未经验证的「修复」或只改断言让测试变绿的补丁；
- 与启动序列无关的依赖或全局脚本。

## 修改约定

1. 先复现/定位，再改代码；不要用关闭断言的方式绕过失败。
2. 改动时间线、交互或六种形态时，同步检查 `test/smoke-splash.mjs` 的契约断言。
3. 改版本号时同步：
   - `package.json`
   - `release.json`
   - `README.md` / `INSTALL.md` / `SPEC.md`
   - `test/smoke-splash.mjs` 的版本断言
4. 改公开文件后跑 `npm run check`，确保没有本机路径、断链或媒体混入。
5. 提交说明用简体中文，写清「改了什么 / 为什么 / 怎么验证」。

## Pull Request 检查表

- [ ] `npm test` 全 PASS
- [ ] `npm run check` 全 PASS
- [ ] 没有新增第三方素材
- [ ] 没有本机绝对路径或敏感日志
- [ ] 版本号与文档同步
- [ ] 视觉改动附 1600×900 / 1920×1080 截图或说明为何不需要

## 发布

维护者流程见 [MAINTAIN.md](MAINTAIN.md)。Release 由 tag 触发 CI 构建；
不要手动上传 `-full.tgz`。
