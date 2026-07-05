# 智音手碟 · Wise-Handpan

伯牙鼓琴，子期知音。一个手碟的电子仿真软件：SVG 手碟可视化、Web Audio 实时合成音色。
支持从 PDF 导入并自动识别曲谱、乐谱可直接编辑修改、播放速度（BPM）可调、节拍器可开关。

![主界面截图](docs/screenshot-main.png)

## 在线体验

👉 https://www.wisehai.com/handpan-project/

在 iPhone/Android 上用 Safari/Chrome 打开后，可以"添加到主屏幕"，像原生 App 一样全屏使用（详见下方
PWA 部分）。

## 本地运行

直接用浏览器打开`handpan-player.html`


## 功能

- 手碟 SVG 可视化，支持点击/触摸敲击，也支持多指同时按住多个音（真实和弦手感）
- 播放 / 循环 / 节拍器
- 两行文本乐谱格式（R: 右手 / L: 左手），可直接编辑
- 从 PDF 识别乐谱（仅支持带真实文字层的矢量 PDF，扫描件/纯图形谱目前无法识别）

## PWA（添加到主屏幕）

已经内置 `manifest.webmanifest`、iOS 专属 meta 标签和 Service Worker，支持离线使用：打开上面的在线
地址，用浏览器的"添加到主屏幕"即可，之后从主屏幕图标启动会是全屏体验，不再显示浏览器地址栏。

## 打包成 Android APK

`android-app/` 目录是基于 Capacitor 的 Android 工程，具体的重新构建步骤见
[`android-app/README.md`](android-app/README.md)。

## 打包成 iOS App

`ios-app/` 目录同样是基于 Capacitor 的封装工程，但构建完全在 Codemagic 云端 macOS 机器上进行
（本地不需要 Mac/Xcode），流程见根目录 [`codemagic.yaml`](codemagic.yaml) 和
[`ios-app/README.md`](ios-app/README.md)。

## 已知限制

iPhone 侧边物理静音拨片打开时，页面里合成的声音会被系统静音——这是 WebKit 对纯 Web Audio API 输出
（没有真实 `<audio>`/`<video>` 播放过内容）的平台级限制，目前没有可靠的纯前端绕过方法。使用前请确认
手机不是静音状态。

## 项目结构与开发说明

给 AI 编程助手/开发者看的架构说明在 [`CLAUDE.md`](CLAUDE.md)。
