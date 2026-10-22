# 本地素材（不入库）

`lib/assets/` 里的大文件是**本地可选素材**，默认不随仓库或官方 Release 分发。
官方包没有它们时，插件仍会完整走 Canvas + WebAudio 降级链，不报错、不中断。

| 文件 | 必需 | 说明 |
|---|---|---|
| `hero-loop.mp4` | 否（首选） | 1920×1080，15.000 秒，30fps，H.264 / yuv420p，无音轨，建议首末帧接近以便循环 |
| `hero-loop.webm` | 否（编码回退） | 与主母版同尺寸/时长/帧率的 VP8 WebM；宿主不解码 H.264 或 MP4 加载失败时使用 |
| `hero.mp4` | 否（最终回退） | 1920×1080，约 16 秒，H.264 |
| `hero-poster.jpg` | 否 | 母版首帧，也是永久角色兜底层；视频失败时仍显示 |
| `bgm.mp3` | 否 | 循环 BGM，揭幕语音进入时压低；缺失时静默 |
| `voice-echo.mp3` | 否 | 第一句「三道残响，由你拾起。」 |
| `voice-reveal.mp3` | 否 | 第二句「顺序，就是我回来的样子。」 |
| `font-brush.woff2` | 否 | 标题毛笔字体；缺失时回落系统衬线 |
| `sfx-charge.mp3` | 否 | 蓄力音效；缺失时用现场合成音或静默 |

## 准备自己的素材

只使用**你有权使用**的视频、BGM 与语音。仓库提供的脚本不下载、不录屏、不抓取
第三方内容，只做转码、抽帧、响度归一和复制：

```bash
python scripts/prepare-assets.py \
  --video /path/to/your-hero.mov \
  --bgm /path/to/your-bgm.wav \
  --voice-echo /path/to/your-echo.wav \
  --voice-reveal /path/to/your-reveal.wav
```

脚本默认输出到 `lib/assets/`。需要 FFmpeg。常用参数：

- `--start 12.5`：从第 12.5 秒开始截循环段；
- `--duration 15`：`hero-loop` 时长；
- `--skip-webm`：不生成 WebM；
- `--poster`：使用自定义海报，而不是从视频抽帧。

## 缺失时的行为

- `hero-loop.mp4` 取不到或解码失败 → 自动回退 `hero-loop.webm`，再回退 `hero.mp4`；
- 三路视频都取不到 → 保留 `hero-poster.jpg` 的静态角色层，Canvas 只画透明雷弧特效；
- 连海报也取不到 → 回落到程序化 Canvas 背景，启动序列照常完整播放；
- `voice-echo.mp3` / `voice-reveal.mp3` 取不到 → 对应那句静默，BGM 恢复，不报错；
- `bgm.mp3` / `sfx-charge.mp3` / `font-brush.woff2` 缺失 → 对应能力静默降级，不报错。

## 为什么不入库

体积大，且可能涉及第三方版权。`.gitignore` 排除了
`lib/assets/*.{mp4,webm,jpg,jpeg,png,mp3,wav,woff2}`，只保留本 README。
