#!/usr/bin/env python3
"""从你有权使用的本地素材准备 lib/assets。

本脚本不下载、不录屏、不抓取任何第三方内容；只做转码、抽帧、响度归一和复制。
没有素材时插件仍可完整运行，只是走 Canvas / WebAudio 降级链。

示例：
  python scripts/prepare-assets.py --video D:\\media\\hero.mov --bgm D:\\media\\bgm.wav
  python scripts/prepare-assets.py --voice-echo D:\\media\\echo.wav --voice-reveal D:\\media\\reveal.wav
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "lib" / "assets"
VIDEO_FILTER = "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30,format=yuv420p"


def need_tool(name: str) -> str:
    path = shutil.which(name)
    if not path:
        sys.exit(f"[X] 找不到 {name}。请先安装 FFmpeg 并加入 PATH。")
    return path


def run(ffmpeg: str, args: list[str]) -> None:
    command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", *args]
    print("[..] " + " ".join(command))
    result = subprocess.run(command, check=False)
    if result.returncode:
        sys.exit(f"[X] ffmpeg 退出码 {result.returncode}")


def require_file(path: Path | None, label: str) -> Path | None:
    if path is None:
        return None
    if not path.is_file():
        sys.exit(f"[X] {label} 不存在: {path}")
    return path.resolve()


def main() -> None:
    parser = argparse.ArgumentParser(description="准备 dsh-startup-yomi 的本地声画素材")
    parser.add_argument("--video", type=Path, help="你有权使用的视频母版")
    parser.add_argument("--start", type=float, default=0.0, help="循环段起点（秒）")
    parser.add_argument("--duration", type=float, default=15.0, help="hero-loop 时长（秒）")
    parser.add_argument("--fallback-duration", type=float, default=16.0, help="hero.mp4 时长（秒）")
    parser.add_argument("--poster", type=Path, help="自定义海报；省略时从视频起点抽帧")
    parser.add_argument("--bgm", type=Path, help="你有权使用的 BGM")
    parser.add_argument("--bgm-duration", type=float, default=75.0, help="BGM 截取时长（秒）")
    parser.add_argument("--voice-echo", type=Path, help="ECHO 语音文件")
    parser.add_argument("--voice-reveal", type=Path, help="REVEAL 语音文件")
    parser.add_argument("--out", type=Path, default=ASSETS, help="输出目录（默认 lib/assets）")
    parser.add_argument("--skip-webm", action="store_true", help="不生成 hero-loop.webm")
    args = parser.parse_args()

    if not any([args.video, args.poster, args.bgm, args.voice_echo, args.voice_reveal]):
        parser.print_help()
        print("\n至少提供 --video / --poster / --bgm / --voice-echo / --voice-reveal 中的一项。")
        return

    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    ffmpeg = need_tool("ffmpeg")

    video = require_file(args.video, "--video")
    poster = require_file(args.poster, "--poster")
    bgm = require_file(args.bgm, "--bgm")
    voice_echo = require_file(args.voice_echo, "--voice-echo")
    voice_reveal = require_file(args.voice_reveal, "--voice-reveal")

    if video:
        loop_args = [
            "-ss", f"{max(0.0, args.start):.3f}", "-i", str(video),
            "-t", f"{max(0.1, args.duration):.3f}",
            "-vf", VIDEO_FILTER, "-an",
            "-c:v", "libx264", "-preset", "slow", "-crf", "18",
            "-movflags", "+faststart",
        ]
        run(ffmpeg, [*loop_args, str(out / "hero-loop.mp4")])
        if not args.skip_webm:
            run(ffmpeg, [
                "-ss", f"{max(0.0, args.start):.3f}", "-i", str(video),
                "-t", f"{max(0.1, args.duration):.3f}",
                "-vf", VIDEO_FILTER, "-an",
                "-c:v", "libvpx", "-b:v", "4M", "-crf", "10",
                "-deadline", "good", "-cpu-used", "2",
                str(out / "hero-loop.webm"),
            ])
        run(ffmpeg, [
            "-ss", f"{max(0.0, args.start):.3f}", "-i", str(video),
            "-t", f"{max(0.1, args.fallback_duration):.3f}",
            "-vf", VIDEO_FILTER, "-an",
            "-c:v", "libx264", "-preset", "medium", "-crf", "20",
            "-movflags", "+faststart",
            str(out / "hero.mp4"),
        ])

    if poster:
        shutil.copy2(poster, out / "hero-poster.jpg")
    elif video:
        run(ffmpeg, [
            "-ss", f"{max(0.0, args.start):.3f}", "-i", str(video),
            "-frames:v", "1", "-q:v", "2", str(out / "hero-poster.jpg"),
        ])

    if bgm:
        run(ffmpeg, [
            "-i", str(bgm), "-t", f"{max(0.1, args.bgm_duration):.3f}",
            "-af", "loudnorm=I=-18:TP=-1.5:LRA=11",
            "-c:a", "libmp3lame", "-b:a", "192k",
            str(out / "bgm.mp3"),
        ])

    for source, target in ((voice_echo, "voice-echo.mp3"), (voice_reveal, "voice-reveal.mp3")):
        if source:
            shutil.copy2(source, out / target)

    print("\n[OK] 本地素材已准备：")
    for file in sorted(out.iterdir()):
        if file.is_file() and file.name != "README.md":
            print(f"  {file.name:20s} {file.stat().st_size:,} B")
    print("\n这些文件只在你本机生效，默认被 .gitignore 排除。")


if __name__ == "__main__":
    main()
