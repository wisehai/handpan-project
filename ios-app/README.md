# 智慧手碟 · iOS 封装 (Capacitor)

把 `../handpan-player.html` 封装成 iOS App，走 App Store / TestFlight。

## 为什么这里没有 `android-app/android/` 那样提交进 git 的原生工程

`android-app/android/` 是提交到仓库里的，因为 Gradle 构建在普通 Linux 机器上就能跑。iOS 不一样：
`npx cap add ios` 内部会调用 CocoaPods / Xcode 命令行工具去生成和同步原生工程，这些工具只存在于
macOS 上——本地开发机（Linux）和现有的 2015 款 MacBook（装不了新版 Xcode）都跑不了这一步。

所以这里换了个策略：`ios/` 目录**完全不提交**，每次在 Codemagic 的云端 macOS 构建机上、从
`capacitor.config.json` + `assets/` 现生成一份全新的原生工程。这样保证结果始终和配置文件一致，
也意味着本地和这台旧 Mac 上永远不需要打开 Xcode——所有构建、签名、打包都在云端完成。

## 构建流程（由 `../codemagic.yaml` 驱动，不是本地命令）

推到 GitHub 后，在 [Codemagic](https://codemagic.io) 面板里触发构建，流程是：

1. `npm ci`
2. 把 `../handpan-player.html` 拷贝成 `www/index.html`（和 `android-app` 的同步方式一样，每次
   `handpan-player.html` 有改动都要靠这一步带进去，Codemagic 每次构建都会重新拷贝，不需要手动同步）
3. `npx cap add ios` —— 现生成原生工程
4. `npx capacitor-assets generate --ios` —— 用 `assets/` 里的三张矢量图（复用自
   `android-app/assets/`，没有重新设计）生成 iOS 的 App 图标
5. `pod install`
6. Codemagic 自动签名（引用 App Store Connect API Key 集成，见下）
7. 打包 `.ipa`，上传到 App Store Connect 的 TestFlight 内测轨道

## 一次性手工准备（全部在浏览器里做，不需要 Xcode）

1. 在 [developer.apple.com](https://developer.apple.com) 注册 Apple Developer Program（$99/年）。
2. 在 App Store Connect 建立 App 记录：Bundle ID `com.handpan.player`、名称"智慧手碟"、主语言
   zh-Hans。
3. App Store Connect → Users and Access → Integrations → Keys，生成一个 API Key（`.p8` 只能
   下载一次，记下 Key ID 和 Issuer ID）。
4. 注册 Codemagic，用 GitHub 账号连上这个仓库，把第 3 步的 API Key 作为签名集成加到 Codemagic
   团队设置里——之后证书和描述文件由 Codemagic 自动申请/续期，不需要手动导出 `.p12`。
5. 确认 `../codemagic.yaml` 里的签名集成名字和第 4 步在 Codemagic 里起的名字一致，然后在
   Codemagic 面板里手动触发第一次构建。

## 验证

第一次构建成功后，产物会自动进 TestFlight。找一台 iPhone（借用也行）装 TestFlight 客户端安装
这个内测版，实际点一遍：敲击发声、乐谱编辑/应用、播放/循环/节拍器、PDF 导入，和线上网页版、
已有的 Android APK 做对比确认行为一致。TestFlight 验证没问题之后，再回 App Store Connect 补
文案/截图/隐私问卷，提交正式审核——这是独立于构建流程的后续步骤。

## 备注

- 应用需要网络权限来按需加载 pdf.js（PDF 识谱功能），iOS 默认允许 HTTPS 出站请求，不需要额外
  的 `Info.plist` 配置；其余功能（播放、乐谱编辑、曲库）完全离线可用。
- `handpan-player.html` 里已经修过 iOS Safari 静音拨片导致 Web Audio 被静音的问题（见根目录
  `README.md`"已知限制"一节和 `CLAUDE.md`），拷贝过来的 `www/index.html` 会自动带上这个修复，
  不需要额外处理。
