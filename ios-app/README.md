---
vmark:
  id: 019f8024-c3d5-7082-ae8b-090e48af9038
---
# 悟碟 · iOS 封装 (Capacitor)

把 `../handpan-player.html` 封装成 iOS App，走 App Store / TestFlight。

## 为什么这里没有 `android-app/android/` 那样提交进 git 的原生工程

`android-app/android/` 是提交到仓库里的，因为 Gradle 构建在普通 Linux 机器上就能跑。iOS 不一样：
`npx cap add ios` 内部会调用 CocoaPods / Xcode 命令行工具去生成和同步原生工程，这些工具只存在于
macOS 上——本地开发机（Linux）和现有的 2015 款 MacBook（装不了新版 Xcode）都跑不了这一步。

所以这里换了个策略：`ios/` 目录**完全不提交**，每次在 Codemagic 的云端 macOS 构建机上、从
`capacitor.config.json` + `assets/` 现生成一份全新的原生工程。这样保证结果始终和配置文件一致。

（更新：现在有了一台能跑完整 Xcode 的 Mac，本地也可以走一遍同样的生成流程调试，见下面"本地开发"
一节；但发正式 TestFlight 版本仍然走 Codemagic 云端流程，两者不冲突。）

## 本地开发（在能跑 Xcode 的 Mac 上）

```bash
npm install                                  # 会顺带链接 ../../handpan-native 这个私有插件仓库
mkdir -p www/vendor/pdfjs
cp ../handpan-player.html www/index.html
cp ../vendor/pdfjs/pdf.min.js www/vendor/pdfjs/pdf.min.js
cp ../vendor/pdfjs/pdf.worker.min.js www/vendor/pdfjs/pdf.worker.min.js
npx cap add ios                              # 现生成 ios/，和 Codemagic 每次做的事一样
plutil -replace NSMicrophoneUsageDescription \
  -string "跟弹模式需要使用麦克风识别你的手碟演奏" \
  ios/App/App/Info.plist                     # 手动补上下面"构建流程"第 3 步 Codemagic 会自动做的那一步
npx cap open ios                             # 在 Xcode 里跑模拟器或真机
```

`ios/` 每次用 `npx cap add ios` 重新生成时，上面的 `plutil` 步骤都要重新跑一次（生成的 Info.plist
不带这条，只有 Codemagic 流程里才会自动注入）。这一步不做的话，跟弹模式一请求麦克风权限 App 就会
被系统直接杀掉（iOS 对没有 `NSMicrophoneUsageDescription` 却访问麦克风的 App 是硬性拒绝，不是弹
提示）。

## 本地发布到 TestFlight（`scripts/release-ios-local.sh`）

`../codemagic.yaml` 云端构建拉不到私有仓库 `handpan-native`（`ios-app/package.json` 里
`capacitor-handpan-follow` 是 `file:../../handpan-native` 本地路径依赖，Codemagic 只 checkout
这个公开仓库，`npm ci` 会直接失败）。原生跟弹插件接进来之后，正式发布改成本地跑——本地正好两个仓库
都在，不存在这个问题，而且可以直接复用 `codemagic.yaml` 里已经调好的同一套工具链
（[`codemagic-cli-tools`](https://github.com/codemagic-ci-cd/cli-tools)，官方开源，独立于
Codemagic 云端也能跑）。

**一次性环境准备**：

```bash
pip3 install --user codemagic-cli-tools
gem install --user-install xcodeproj   # xcode-project 命令内部用 Ruby 改 .pbxproj 需要这个
```

**一次性 App Store Connect API Key 准备**（跟 `../codemagic.yaml` 用的是同一类 Key，但建议单独生成
一个专给本地用，别混用）：

1. App Store Connect → Users and Access → Integrations → Keys → 生成新 Key，角色 App Manager 即可

2. 下载 `.p8`（只能下一次），放到 `~/.appstoreconnect/private_keys/AuthKey_<KeyID>.p8`

3. 导出这两个环境变量（建议写进一个不提交进仓库的本地文件里，用的时候 `source` 一下）：

   ```bash
   export APP_STORE_CONNECT_ISSUER_ID="<Issuer ID>"
   export APP_STORE_CONNECT_KEY_IDENTIFIER="<Key ID>"
   ```

4. 首次在这台机器上拉取/生成 App Store 发布用的签名证书 + 描述文件：

   ```bash
   app-store-connect certificates list   # 先看看账号上已有哪些证书
   ```

   如果看到某个 `DISTRIBUTION`/`IOS_DISTRIBUTION` 证书本地拿不到私钥（比如是之前 Codemagic
   云端自动生成的，私钥只留在 Codemagic 服务器上），`fetch-signing-files` 会因为
   "Cannot save Signing Certificates without certificate private key" 卡住——这种证书本地永远用
   不了，需要先 `app-store-connect certificates delete <ID>` 吸销掉（对 Apple 开发者账号的真实操作，
   吸销前确认这个证书没有其他地方还在用）。确认账号上没有"本地拿不到私钥"的多余证书后：

   ```bash
   openssl genrsa -out ~/.appstoreconnect/certs/distribution.key 2048
   app-store-connect fetch-signing-files com.wisehai.handpan --type IOS_APP_STORE --create \
     --certificate-key "@file:$HOME/.appstoreconnect/certs/distribution.key"
   keychain add-certificates   # 把新证书连同私钥一起导入登录 Keychain，codesign 才找得到
   ```

   这一步只需要做一次；证书两年内、描述文件失效前都能重复用，不用每次发布都重新生成。

**发布**（以后每次发新 build，确认 5 一次性准备已经做过、环境变量已经 `source` 好之后）：

```bash
scripts/release-ios-local.sh          # 版本号取 codemagic.yaml 的 APP_VERSION，build 号自动 +1
scripts/release-ios-local.sh 1.3      # 或者显式指定 marketing version
```

脚本原样复刻 `../codemagic.yaml` 的每一步（拷贝 web 资源 → `cap add ios` → patch Info.plist →
限制 iPhone-only → 生成图标 → `cap sync ios` → 版本号 → 签名 → `xcode-project build-ipa` 打包 →
`app-store-connect publish` 上传），跑完后新 build 会出现在 App Store Connect 的 TestFlight
页面（账号自己就是内部测试员，不需要额外提交外部测试审核）。上传成功不代表立刻能装，Apple 处理一般
要几分钟到半小时，处理完状态会从"处理中"变成"可测试"。

## 构建流程（`../codemagic.yaml`，目前因为私有插件依赖跑不通，见上）

这一节描述的是云端流程本身（`scripts/release-ios-local.sh` 就是照这个流程原样搬到本地的），留着
供以后参考——比如哪天不需要私有插件依赖了，或者把 `handpan-native` 也接进 Codemagic 的多仓库权限，
想切回云端自动构建时，这里的步骤仍然是准的。

推到 GitHub 后，在 [Codemagic](https://codemagic.io) 面板里触发构建，流程是：

1. `npm ci`
2. 把 `../handpan-player.html` 拷贝成 `www/index.html`，并把 `../vendor/pdfjs/` 拷进
   `www/vendor/pdfjs/`（和 `android-app` 的同步方式一样，每次网页资源有改动都要靠这一步带进去，
   Codemagic 每次构建都会重新拷贝，不需要手动同步）
3. `npx cap add ios` —— 现生成原生工程；随后用 `plutil` 往生成的 Info.plist 注入
   `NSMicrophoneUsageDescription`（跟弹模式要用麦克风，而工程每次构建都重新生成，
   所以这一步必须写在 codemagic.yaml 里，手改无效）
4. 把 `TARGETED_DEVICE_FAMILY` 从 Capacitor 模板默认的 `"1,2"`（Universal，iPhone+iPad）改成
   `"1"`（仅 iPhone）——只上架 iPhone 版，不然 App Store Connect 会因为二进制包同时声明支持
   iPad 而强制要求上传 iPad 截图
5. `npx capacitor-assets generate --ios` —— 用 `assets/` 里的三张矢量图（复用自
   `android-app/assets/`，没有重新设计）生成 iOS 的 App 图标
6. `pod install`
7. Codemagic 自动签名（引用 App Store Connect API Key 集成，见下）
8. 打包 `.ipa`，上传到 App Store Connect 的 TestFlight 内测轨道

## 一次性手工准备（全部在浏览器里做，不需要 Xcode）

1. 在 [developer.apple.com](https://developer.apple.com) 注册 Apple Developer Program（\$99/年）。
2. 在 App Store Connect 建立 App 记录：Bundle ID `com.wisehai.handpan`、主语言 zh-Hans。
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

- PDF.js 随包放在 `vendor/pdfjs/`，PDF 识谱不会连接 CDN，也不会上传用户选择的 PDF 文件。
  其余功能（播放、乐谱编辑、曲库）同样离线可用。
- `handpan-player.html` 里已经修过 iOS Safari 静音拨片导致 Web Audio 被静音的问题（见根目录
  `README.md`"已知限制"一节和 `CLAUDE.md`），拷贝过来的 `www/index.html` 会自动带上这个修复，
  不需要额外处理。

