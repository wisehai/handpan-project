# 悟碟 · Android 封装 (Capacitor)

把 `../handpan-player.html` 封装成 Android APK。`www/index.html` 是它的一份**普通拷贝**（不是软链接
——曾经用软链接图省事，但 `npx cap copy` 会把软链接原样复制到 `android/app/src/main/assets/public/`，
相对路径层级对不上，导致那边的链接是断的，Gradle 也不会因此报错，只会静默复用上一次的构建缓存，
改动完全不会进最终 APK。所以现在每次改完 `handpan-player.html` 都要重新拷贝一次，见下）。

## 环境

构建工具装在用户目录下，不影响系统环境：
- JDK 21（Gradle/AGP 要求）：`~/.jdk21/jdk-21.0.11+10`
- JDK 17（备用，未使用）：`~/.jdk/jdk-17.0.19+10`
- Android SDK：`~/Android/Sdk`（platform-tools、platforms;android-34、build-tools;34.0.0，
  Gradle 首次构建时又自动装了 build-tools 35 和 platform 36）
- Node 22（Capacitor CLI 8.x 要求 >=22，系统默认 node 是 20，装在 `~/.local-node/node-v22.14.0-linux-x64`）

## 重新构建 APK

`handpan-player.html` 每次改动后，先同步到 `www/index.html`，再让 Capacitor 把它拷进 Android
工程，然后才是 Gradle 构建——这三步缺一不可，尤其是前两步，Gradle 自己不会去检查网页源文件变没变：

```bash
export PATH=~/.local-node/node-v22.14.0-linux-x64/bin:$PATH   # npx 需要 node 22
export JAVA_HOME=~/.jdk21/jdk-21.0.11+10
export ANDROID_HOME=~/Android/Sdk
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

cd android-app
cp ../handpan-player.html www/index.html
npx cap copy android
cd android
./gradlew assembleDebug
# 产物：android-app/android/app/build/outputs/apk/debug/app-debug.apk
```

想确认这次构建是不是真的带上了最新改动，最直接的办法是解开 APK 核对一下：
```bash
unzip -p android-app/android/app/build/outputs/apk/debug/app-debug.apk assets/public/index.html \
  | diff - handpan-player.html && echo "APK 里的内容和源文件一致"
```

## 安装到手机

```bash
export ANDROID_HOME=~/Android/Sdk
$ANDROID_HOME/platform-tools/adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

或者直接把 `app-debug.apk` 拷到手机上安装（需要在系统设置里允许"安装未知来源应用"）。

## 备注

- 这是 **debug** 签名的 APK，仅用于自己安装测试。要发布到应用商店需要生成正式签名密钥并构建
  release 包（`./gradlew assembleRelease`），目前没有配置。
- 应用需要 `INTERNET` 权限（`AndroidManifest.xml` 已默认包含），因为"导入 PDF 识谱"功能会从
  CDN 按需加载 pdf.js；其余功能（播放、乐谱编辑、曲库）完全离线可用。
- `node_modules/`、`android/build/`、`android/app/build/`、`android/.gradle/`、
  `android/local.properties` 已在 `.gitignore` 里排除，不会被提交。
