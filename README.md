# 智慧手碟 · Handpan Player

一个纯前端、单文件的手碟在线播放器：SVG 手碟可视化、Web Audio 实时合成音色、可编辑的两行文本乐谱。
支持从 PDF 导入并自动识别曲谱、乐谱可直接编辑修改、播放速度（BPM）可调、节拍器可开关。没有构建步骤，
没有依赖打包——除了导入 PDF 识谱时按需从 CDN 加载的 pdf.js。

![主界面截图](docs/screenshot-main.png)

## 在线体验

👉 https://www.wisehai.com/handpan-project/

在 iPhone/Android 上用 Safari/Chrome 打开后，可以"添加到主屏幕"，像原生 App 一样全屏使用（详见下方
PWA 部分）。

## 本地运行

不需要构建、不需要安装依赖，直接用浏览器打开：

```bash
xdg-open handpan-player.html   # macOS 上用: open handpan-player.html
```

## 功能

- 手碟 SVG 可视化，支持点击/触摸敲击，也支持多指同时按住多个音（真实和弦手感）
- 播放 / 循环 / 节拍器
- 两行文本乐谱格式（R: 右手 / L: 左手），可直接编辑
- 从 PDF 识别乐谱（仅支持带真实文字层的矢量 PDF，例如 Notepan 导出的谱子；扫描件/纯图形谱无法识别）
- 本地"曲库"（基于浏览器 `localStorage`），以及纯文本 `.txt` 导出/导入作为可靠的备用方案

## PWA（添加到主屏幕）

已经内置 `manifest.webmanifest`、iOS 专属 meta 标签和 Service Worker，支持离线使用：打开上面的在线
地址，用浏览器的"添加到主屏幕"即可，之后从主屏幕图标启动会是全屏体验，不再显示浏览器地址栏。

## 打包成 Android APK

`android-app/` 目录是基于 Capacitor 的 Android 工程，具体的重新构建步骤见
[`android-app/README.md`](android-app/README.md)。

## 已知限制

iPhone 侧边物理静音拨片打开时，页面里合成的声音会被系统静音——这是 WebKit 对纯 Web Audio API 输出
（没有真实 `<audio>`/`<video>` 播放过内容）的平台级限制，目前没有可靠的纯前端绕过方法。使用前请确认
手机不是静音状态。

## 项目结构与开发说明

给 AI 编程助手/开发者看的架构说明在 [`CLAUDE.md`](CLAUDE.md)。
