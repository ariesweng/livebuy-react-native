# Changelog

All notable changes to `livebuy-react-native` (distributed via this mirror repository) will be
documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Distribution.** This package is served as a public git dependency
> (`git+https://github.com/ariesweng/livebuy-react-native.git#v<ver>`). The published `<ver>` is
> read from this package's own `package.json` `version` field at release time; the channel itself
> is version-agnostic.

## [2.4.0] - 2026-09-13

> **core（`livebuy-react-native`），minor，零 BREAKING。** 自 `2.3.0` 以來累積 5 個內容
> commit + 1 輪 Android bridge core pin 追新，主軸是加購前登入攔截、`CART_ADD_REQUEST`
> 補回傳加購數量、觀看人數死接線修復、回放聊天室主播身分判斷修復，以及一輪例行 pin bump
> （`4.18.0`→`4.19.0`）。

### Added

- **加購前本地攔截未登入使用者**（`rn-add-to-cart-login-gate-core`）：新增全域設定
  `requireLoginForAddToCart`（default `false`，additive），parity iOS/Android。
- **`CART_ADD_REQUEST` 事件補回傳加購數量**（`cart-add-request-num-rn-core`，`num`），additive
  欄位，parity iOS/Android。

### Fixed

- **觀看人數死接線修復**（`rn-viewer-count-bridge-core`）：native bridge 補上觀看人數轉發，
  core 層資料早已到位、僅欠這一步接線。
- **回放聊天室主播身分改用 `kind` 優先判斷**（`fix-rn-comment-kind-wire-priority-core`），修
  復既有以 `name` 是否非空推導方向相反的 bug，parity iOS/Android/Flutter。
- **Android bridge core pin 例行追新 `4.18.0` → `4.19.0`**（`react-native/android/build.gradle`，
  `rn-android-bridge-core-pin-4-19-0`，已核對 `livebuy-android-sdk/CHANGELOG.md` 的 `[4.19.0]`
  條目確認本輪 `:livebuy` core 模組零 BREAKING、且新增的兩項（`requireLoginForAddToCart` 純
  JS/TS 側實作不經過 native bridge、`CART_ADD_REQUEST.num` 走整包泛型透傳不需 bridge Kotlin
  跟著改）皆與本 bridge 原始碼無關，回到例行維護，不需符號級驗證）。

### Deprecated

- **`addToCart` 的 `ids`（批次結帳模式）標記淘汰**（`deprecate-cart-purchase-ids-mode`）：查證
  零呼叫端使用，加 doc comment 說明，預告下一個四端同步的 major 版本移除。零執行期行為改變，
  parity 四端。

## [2.3.0] - 2026-09-11

> **core（`livebuy-react-native`），minor，含 1 項 ⚠️ BREAKING。** 自 `2.2.0` 以來累積 13 個內容
> commit（另 5 個 sample/CI 工具鏈 docs-only 不列入），主軸是 bridge 補齊多項 channel 資料轉發
> 欄位（公告/訪客留言/推薦影片/介紹中商品/搶購旗標/回放聊天漸進式揭露）、真機測試修復三個
> Android 播放崩潰/黑屏 bug，以及三輪 Android bridge core pin 追新
> （`4.11.0`→`4.16.0`→`4.17.0`→`4.18.0`）。

### Added

- **channel 資料轉發批次**：頻道公告文字（`rn-channel-notice-bridge-core`，`notice`/`sysNotice`）、
  訪客留言（`rn-guest-comment-channel-bridge-core`，parity Flutter）、下一支推薦影片
  （`rn-endscreen-next-bridge-core`，`channel.next[]`，為 EndScreen 倒數變體鋪路）、介紹中商品/
  商品袋（`rn-moment-products-bridge-core`，`onMomentStateChange` 補轉發 `products`/
  `narratingProduct`）、搶購旗標（`channel-flash-sale-flag-core-rn`，`isFlashSale`）、回放聊天室
  原生漸進式揭露事件轉發（`fix-rn-replay-chat-progressive-reveal-core`，`onReplayChatRevealed`，
  parity iOS/Android 既有 seam；reference-ui 容器接線見 `livebuy-react-native-reference-ui` 套件）。
- **`isMuted()` 查詢出口**（`mute-preference-persist-across-session-rn-core`）：讓 host/template
  層能查詢所包覆原生 Player（iOS/Android）目前實際的靜音狀態。
- **`LivebuySDK.currentShopId()` 讀回介面**（`rn-live-now-pill-auto-shopid-turnkey-core`），
  parity iOS/Android/Flutter，為 reference-ui 消費端（現正直播 pill 自動 shopId fallback）鋪路。

### Fixed

- **真機測試發現的三個 Android 播放崩潰/黑屏 bug**（`android-live-playback-real-device-fixes-core`）：
  `LivebuyRNModule` 缺 `@ReactModule` annotation 導致開播放器必然 crash、core SDK media3
  版本被 host app 自身依賴覆蓋讓已修過的黑屏 bug 用新機制復發、IVS render surface 在 RN 的
  Yoga-driven view tree 裡量到 0×0（真正的黑屏根因）。三者皆已在實機（Samsung SM-G887F）驗證
  修復有效。
- **Android bridge core pin 追新 `4.17.0` → `4.18.0`**（`react-native/android/build.gradle`，
  `rn-android-bridge-core-pin-4-18-0`）——**非純例行維護**：已核對 `livebuy-android-sdk/CHANGELOG.md`
  的 `[4.18.0]` 條目，確認 `:livebuy` core 模組這輪新增 `LivebuyPlayerView` public read-only
  `isMuted` getter（`mute-preference-persist-across-session-android-core`），而 bridge
  `LivebuyRNModule.kt:502`（`isMuted` Promise accessor，`mute-preference-persist-across-session-rn-core`
  已於更早的 change 接上）已經呼叫 `view?.isMuted ?: false`——pin 落在 `4.17.0`（該版 core 無此
  getter）期間，這個呼叫對其宣告版本理論上編譯不過；本次 bump 正是補上這個符號缺口的必要條件。
  其餘 `[4.18.0]` core 項目（主播斷線重試耗盡後的確認式恢復、開場片 `setMuted` 延續到主播放、
  `PollManager` 首輪 poll 改立即發送〔Android-only，修復進直播間訊息延遲、追平 iOS 既有行為〕）皆
  不影響既有 bridge 呼叫點簽章；其餘全部項目皆為 reference-ui/template 層，與本次 pin bump 無
  關。除了既有的 import 級核對，本輪額外以 `javap` 反組譯確認 `isMuted` getter 真的存在於新 AAR
  內。
- **Android bridge core pin 例行追新 `4.16.0` → `4.17.0`**（`react-native/android/build.gradle`，
  `rn-android-bridge-core-pin-4-17-0`，已核對 `livebuy-android-sdk/CHANGELOG.md` 的 `[4.17.0]`
  條目確認本輪 `:livebuy` core 模組零改動——全部 Added/Changed/Fixed 項目皆為
  reference-ui-internal/template 範圍，唯一相關項目是新增一支 Robolectric regression test，純測試
  無生產程式碼變動；本次只跨 1 個版本、發版後很快就被跟進，非重蹈上一輪 5 個月落後的覆轍）。
- **Android bridge core pin 例行追新 `4.11.0` → `4.16.0`**（`react-native/android/build.gradle`，
  `rn-android-bridge-core-pin-4-16-0`，已逐版核對 v4.12.0-4.16.0 系列所有 BREAKING 項皆為
  reference-ui-internal/template 範圍、不影響 bridge 原始碼，純例行維護——落後 5 個小版本、耗時
  5 個月才被跟進，對照組 Flutter 同款依賴這段期間持續有人 bump）。

### ⚠️ BREAKING

- **`LBConfigOptions.apiKey` 型別 `number` → `string`**（`rn-configure-apikey-string-type-core`）
  ——修正一個從 bridge 誕生以來就存在、必然 crash 的型別 bug：原生 Android bridge
  `LivebuyRNModule.configure(apiKey: String, ...)` 一直要求字串，兩份既有 spec
  （`sdk/react-native.md`、`rn-integration-guide/spec.md`）也一直寫的是 `apiKey: string`，唯獨
  `.ts` 型別宣告寫成 `number`；照著這個（錯誤）型別傳數字時，JS number 序列化成 native
  `Double`，原生端 `ReadableNativeArray.getString()` 讀取時直接擲出
  `java.lang.Double cannot be cast to java.lang.String`，`configure()` 當下 crash（實機驗證：
  Samsung SM-G887F）。同時在 `configure()` 呼叫 native bridge 前的 chokepoint 加上防禦性
  `String(options.apiKey)`，即使呼叫端繞過型別檢查也不會讓非字串值跨過 bridge。既有呼叫端如果
  傳數字字面量（如 `123`）需要改成字串（如 `'123'`）；執行期行為只會變得更正確，不是劣化。

## [2.2.0] - 2026-09-08

> **core（`livebuy-react-native`），minor，非 BREAKING。** 自 `2.1.0` 以來累積 1 個 commit，
> 補齊 Flutter 同源的 channel 資料橋接缺口。

### Added

- **`LBPlayerChannelInfo.shopIntro?: string`**（`channel-shop-intro-bridge-core-rn`，additive、
  非 BREAKING）——iOS/Android 原生 core 早已透傳店家簡介文字，RN 這端此前從未橋接，導致
  reference-ui 的直播資訊面板店家簡介欄位恆空。本次補上 wire 欄位 + 去重快照同步（parity
  Flutter 同批修復）。

## [2.1.0] - 2026-09-07

> **core（`livebuy-react-native`），minor，含 1 項 ⚠️ BREAKING。** 自 `2.0.2` 以來累積 5 個
> commit，與 v4.14.0 iOS/Android/Flutter 同源的四端 parity 補課批次之 core bridge 部分。

### Added

- **`LBVideoItem.goods?: LBFeaturedGood`**（video-linked-goods-core-rn，additive、非
  BREAKING）——iOS / Android 原生 core 的 `LBVideoItem` 早已帶 `goods: LBFeaturedGood?`（widget
  輪播卡縮圖下方的連結商品價格預覽卡，`/sdk/widget` / `/sdk/widget/live` 既有欄位），RN 這端此前
  從未接上，是純粹的橋接缺口。本次補上：新增 `export interface LBFeaturedGood`（`name` / `pic` /
  `price` / `originalPrice`: `string`，`soldOut` / `stock` / `status`: `number`）；`LBVideoItem`
  新增 optional `goods?` 欄位；兩支原生 bridge 的 `serializeVideoItem`（`fetchLatestLive` 與
  `fetchWidget` `videos[]` 共用）新增 `goods` 序列化（無連結商品時省略 key，非 JS `null`）；
  `fetchLatestLive` 的回傳路徑對 `goods` 子欄位做容錯反序列化（缺 / `null` / 型別不符皆為
  `undefined`，不拋例外）。`fetchWidget` 維持既有 raw passthrough 契約不變。
- `channel.type` bridge 欄位（additive，供回放版型判斷消費）。
- header chrome 三欄位 `shopName`/`shopLogo`/`shareUrl` bridge 補傳（additive）。
- `enableDirectCloseButton` 全域預設設定新增（additive，見下方 BREAKING 段其預設值）。

### ⚠️ BREAKING

- **`enableDirectCloseButton` 全域預設值 `false → true`**（`rn-player-direct-close-button-
  default-true`）——與 iOS/Android/Flutter 同批對等變更，行為面 BREAKING、非源碼相容面：既有
  `configure()` call site 不帶此參數仍可編譯，但省略時的解析預設值、以及模組尚未呼叫過
  `configure()` 時的初始狀態，皆從「兩段式關閉（先收合再點懸浮小卡關閉鈕）」改為「一鍵直接
  關閉」。想維持舊行為的 host 需明確傳 `enableDirectCloseButton: false`。

## [2.0.2] - 2026-09-02

### Fixed

`2.0.1` fixed the originally-reported iOS compile error, but the same and a neighboring native
bridge file had never actually compiled far enough for several other pre-existing bugs to
surface. This release fixes all of them, found by actually compiling the real native bridge
source against the real, currently-published core SDK end-to-end:

- **iOS**: two more bugs in the widget bridge (a type-inference issue in the widget-response
  event emitter; a model no longer decodable via `JSONDecoder`).
- **iOS**: the main player bridge (`LivebuyRNBridge.swift`) had never compiled successfully
  against a real SDK at all — three more non-decodable-model issues, 26 sub-component command
  handlers reaching into now-inaccessible internal SDK properties (rewired to the SDK's public
  action API), an `apiKey` type mismatch, and one missing forwarding method.
- **Android**: no changes — `2.0.1` already fixed everything reported there.

If you installed `2.0.1` (iOS) and it still didn't compile, upgrade to `2.0.2` — no other changes,
no migration needed. If you hit a *different* native compile error after installing `2.0.2`,
please report it.

---

> **既有紀錄補正**（本次發版盤點時發現，非本輪造成）：`livebuy-react-native`（主橋接套件）
> 自身的 `[2.0.2]` 發版當時，實際還一併包含了以下 2 項內容，先前未列入該版 CHANGELOG——已
> 外部核實 `github.com/ariesweng/livebuy-react-native` tag `v2.0.2` 的已發佈原始碼確實含這
> 兩項：①`activeEvents()`/`LBActiveEvent` 底層新增 VOD 正在介紹中商品訊號同批的
> `LBPlaybackProgress`/`togglePlayPause`/`seekBy` playback-progress bridge API（core，
> parity iOS/Android，`rn-vod-playback-progress-core`）；②Android bridge core pin 例行追新
> `4.10.0` → `4.11.0`（`rn-android-bridge-core-pin-4-11-0`，已確認 v4.11.0 唯一 BREAKING 項
> 不影響 bridge 原始碼）。兩項皆已真實隨 `v2.0.2` 對外發布，不影響任何版號判定，純文件補記。

## [2.0.1] - 2026-09-01

### Fixed

- **iOS bridge failed to compile** — `LivebuyWidgetViewManager.swift` referenced a bare
  `LivebuyWidget` type that no longer exists in the `LivebuySDK` module (renamed to
  `LivebuyWidgetCore` upstream); every 4.x core SDK version hit
  `error: cannot find type 'LivebuyWidget' in scope`. Fixed by updating the reference to
  `LivebuyWidgetCore` — behavior and signature are unchanged.
- **Android bridge failed to compile** — three command handlers in
  `LivebuyPlayerViewManager.kt` (`load` / `sendChat` / `requestEventJoin`) passed a nullable
  `String?` where the core SDK requires non-null `String`, producing `Argument type mismatch`
  errors. Fixed with the same null-handling already used by sibling commands in the same file.
- **Android bridge failed to compile on newer React Native** — `LivebuyRNModule.kt` called an
  unqualified `currentActivity`, which no longer resolves on React Native versions where the
  base `ReactContextBaseJavaModule` class was rewritten in Kotlin (observed on RN 0.85+,
  including 0.87.1 with the New Architecture). Fixed by using `reactContext.currentActivity`.

If you installed `2.0.0` and hit any of the errors above, upgrade to `2.0.1` — no other changes,
no migration needed.

## [2.0.0] - 2026-09-01

### Added

First real release of the `livebuy-react-native` mirror repository. Headless core bridge for
iOS/Android (native `LivebuyRNBridge` + `LivebuyPlayerView`), request signing, polling, and the
unified event bus. See the [React Native partner integration
quickstart](https://github.com/ariesweng/livebuy-react-native/blob/main/README.md) or request the
**component-contracts** document from your Livebuy contact for the full API surface and event
catalogue.
