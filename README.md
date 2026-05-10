# Han Burger Calendar

`Han Burger Calendar` 是給 `han-burger` 使用的本機優先日曆與提醒小工具。

## 功能

- 月曆檢視
- 新增、編輯、刪除提醒
- 當日行程清單
- 使用 `localStorage` 儲存在這台裝置
- 在 Han Burger Desktop 內可透過 Google Drive App Data Folder 同步事件資料，並提供手動上傳與下載
- 使用者允許通知後，可透過瀏覽器或桌面殼層發送提醒
- Android / iOS app 版可使用 Google 登入後同步同一份 Google Drive App Data Folder 資料
- Android / iOS app 版會在本機排程提醒；手機與電腦各自通知，不會互相取消
- 支援桌面與手機瀏覽器版面

## 發行檔案

`han-burger` 之後可以讀取 `hPPPf7/han-burger-calendar` 最新 GitHub Release，只要 release 內包含：

- `han-burger-calendar.zip`

這個 zip 解壓縮後應該直接放進安裝資料夾，至少需要包含：

- `index.html`
- `mobile-config.js`
- `mobile-bridge.js`

## 本機使用

可以直接用瀏覽器開啟 `index.html`，或把它打包成 release zip，讓 `han-burger` 下載並安裝成桌面工具。

## 手機版

手機版使用 Capacitor 共用同一份 Calendar UI，已建立：

- `android/`
- `ios/`
- `mobile-bridge.js`
- `mobile-config.js`

### Google OAuth 設定

手機端需要在 Google Cloud Console 另外建立 OAuth Client：

- Android：套件名稱 `com.hanburger.calendar`，並填入正式簽章的 SHA-1。
- iOS：Bundle ID `com.hanburger.calendar`。
- 範圍需包含 `https://www.googleapis.com/auth/drive.appdata`。

建立後把 client id 填入 `mobile-config.js`：

```js
window.HAN_BURGER_CALENDAR_MOBILE_CONFIG = {
  google: {
    androidClientId: "ANDROID_CLIENT_ID.apps.googleusercontent.com",
    iosClientId: "IOS_CLIENT_ID.apps.googleusercontent.com",
    redirectScheme: "com.hanburger.calendar"
  }
};
```

### 打包

```bash
npm install
npm run mobile:prepare
npx cap sync
```

Android 可在 Windows 使用 Android Studio 或 Gradle 打包。需要 Java 11 以上；目前這台機器是 Java 8，所以 `assembleDebug` 會被 Android Gradle Plugin 擋下。

iOS 需要 macOS 與 Xcode 打包：

```bash
npx cap open ios
```
