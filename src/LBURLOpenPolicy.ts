// LBURLOpenPolicy — url-open-policy-rn（core 層 / React Native parity）
//
// `## Depends On: url-open-policy-and-host-routing-core`（iOS lead，已 archive）。
// 規則、求值順序、安全不變式、外送允許清單全部由 lead 定案，權威在
// `openspec/specs/url-open-policy/spec.md`。本檔鏡射其**語意**，不逐字照抄 Swift。
//
// 「一個網址該用 app 內瀏覽器還是外部瀏覽器開」的四端共用裁決規則。
//
// 這裡**只裁決、不開啟**。RN core 維持 headless：本檔 MUST NOT `import 'react-native'`、
// MUST NOT 觸碰 `Linking` / `NativeModules` / 任何 bridge command。實際呈現由 view-model 層 /
// reference-ui 層依 `target` 選擇既有的開啟機制（RN：bridge command `openInAppBrowser` /
// `Linking.openURL`）。
//
// **消費端已接線，且集中在各層的單一 URL 出口。** 接線由 `url-open-host-routing-template-rn`
// （view-model 層）與 `rb-rn-win-claim-footer-links`（reference-ui 層）落地：view-model 層
// `DefaultTemplate` 的唯一 URL 出口、以及 reference-ui 層中獎元件的法務連結路由，都是先呼叫
// `decide()`、再依 `target` 分流。
// ⚠️ 這兩層在 RN 是**獨立的頂層套件目錄**（`react-native-ui/` 與 `react-native-reference-ui/`，
// **不在** `react-native/` 底下）——只在本套件目錄內 grep 消費者會得到「無消費者」的假陰性。
//
// ⚠️ **reference-ui 層仍有不經本策略的既有 outbound 出口**——例如
// `react-native-reference-ui/src/widget/ExternalLive.ts` 的外部直播平台卡，直接
// `Linking.openURL(url)`，不呼叫 `decide()`。那是**待收斂的債、不是已定案的例外**，屬
// reference-ui 層另案。因此 **MUST NOT** 從上一段推得「所有開啟都已由本策略裁決」。
//
// ⚠️ 「消費端已接線」那一段刻意寫成「**層 + 單一出口**」而非消費者清單或數量：走既有出口的
// 新消費點不會使它過期，而繞過出口的消費點本來就該在 review 被擋下。**MUST NOT** 改寫成
// 「目前有 N 個消費者」這類快照式敘述——本檔頭的前一版正是那樣寫的（「可被呼叫但尚無
// production 消費者」），並在接線落地的**同一天**就成為假敘述。（點名的 change id 是
// **接線來源的歷史事實**、不會翻面，與會翻面的消費者普查不同。）
//
// ⚠️ **層別邊界不變**：core 只裁決、不開啟；接線與呈現一律屬上層（I7 單層規則：core change
// 不得改 view-model / reference-ui capability）。

/**
 * 一個網址的開啟方式。
 *
 * 兩個值的語意是**契約**，不是提示——呈現端必須照這個語意實作：
 * - `'inApp'`：以平台原生 in-app browser 呈現（RN：bridge command `openInAppBrowser`，
 *   iOS 端 `SFSafariViewController` / Android 端 Custom Tabs），使用者留在 App 內。
 * - `'external'`：**交給系統 URL router**（RN：`Linking.openURL`）。呈現端 **MUST NOT** 把
 *   `'external'` 的網址載進任何 WebView（例如 `react-native-webview`）——那會讓該網址在
 *   **當前已載入頁面的 origin** 下被求值，把「送出去」變成「在自己家裡執行」。
 */
export type LBURLOpenTarget = 'inApp' | 'external';

/**
 * 一則已裁決的開啟請求：**要開的網址** + **怎麼開**。
 *
 * 「不可開」不由本型別表達，而由 {@link decide} 回傳 `null` 表達——`'inApp'` / `'external'`
 * 兩態都必然帶著一個可開的網址，第三態必然沒有，所以「有沒有東西可開」交給 `null`、
 * 「怎麼開」交給 `target`，呼叫端得以一次 falsy 檢查完成安全 no-op。
 */
export interface LBURLOpenDecision {
  /**
   * 要開啟的網址。
   *
   * RN 沒有平台 URL value type，且 bridge 與 `Linking.openURL` 都吃字串，因此這裡是
   * `string`——**去除前後空白後的原始輸入**。策略自身不改寫它：不補 scheme、不改 host、
   * 不動 path / query。
   *
   * ⚠️ 因為入口有 trim，`url === 輸入字串` **不成立**，實作與測試 MUST NOT 寫這種斷言。
   *
   * ⚠️ **呈現端 MUST 直接使用這個值，MUST NOT 拿原始字串另跑一套 parser 重新取 host** ——
   * 判定是對本模組解出的 host 做的，換一套 parser 就換了一組解析差異（parser differential）。
   * RN 端最終仍由原生側再解析一次這個字串才開啟，而那個差異之所以無害，靠的是**兩道機制**：
   * {@link BACKSLASH} 的 fail-closed（拒絕兩大 parser 家族**在 authority 本體邊界上**唯一分歧
   * 的字元，使各家看到的 authority 逐字相同，決定「檢查哪一段」）加上
   * {@link NON_PLAIN_HOST_CHARACTER}（決定「那一段合不合格」）。
   * ⚠️ 「在 authority 本體邊界上」這個限定 **MUST 保留**：拿掉限定後該句為假——獨立驗收實測，
   * 兩家對 host 結論不同的 ASCII 字元有 **34 個**（tab/LF/CR、`"`、`` ` ``、`{`、`}`、A–Z…），
   * 只是它們不改變 authority 的**邊界**。前綴分隔字元另有分歧，見 {@link AUTHORITY_PREFIX}。
   * 🔴 只有後者是不夠的——藏在 userinfo 段的 `\` 對字元集完全隱形；而只把邊界對齊**某一家**
   * parser 也不夠——那會讓另一家曝險。兩者都是實測抓到的繞過，見 {@link BACKSLASH}。
   */
  url: string;
  /** 開啟方式。 */
  target: LBURLOpenTarget;
}

/**
 * 判為 app 內開啟的註冊域。此網域**與其任意層子網域**皆走 app 內。
 *
 * 公開的理由：四端各只有這一處字面量，host（Tier 0）與 reference-ui 都讀它，
 * 而不是各自再寫一次 `'livebuy.tv'`。
 */
export const LB_URL_IN_APP_DOMAIN = 'livebuy.tv';

/** 會進入 host 判定的 scheme。 */
const WEB_SCHEMES: ReadonlySet<string> = new Set(['http', 'https']);

/**
 * **外送允許清單**：只有這些 scheme 會得到裁決，其餘一律 `null`（不可開）。
 *
 * 這是**正面允許清單，不是黑名單**，理由是餵進 {@link decide} 的字串主要來自
 * **後端可控欄位**（`LBProduct.diversionUrl` / `LBShop.serviceLink`）。黑名單式的
 * 「非 http(s) 就交給 OS」在 Android 上是實質風險：`intent://…#Intent;…;end` 是公認可觸達
 * 任意 exported component 的向量。允許清單讓這類 scheme（`intent` / `javascript` / `data` /
 * `file` / `content` / 任意 app 自訂 scheme）在 **core 就被擋掉**，四端不必各自記得補防護。
 *
 * 代價（明列，非疏忽）：後端把連結填成 host app 自訂 scheme 的 deep link 會變成安全 no-op。
 * 目前沒有任何已知使用情境依賴它；若日後出現，那是一個要獨立論證的 change。
 */
const OPENABLE_SCHEMES: ReadonlySet<string> = new Set([
  'http',
  'https',
  'mailto',
  'tel',
  'sms',
]);

/** 開頭的 scheme：`[A-Za-z][A-Za-z0-9+.-]*:`（RFC 3986 的 scheme 產生式）。 */
const SCHEME_PATTERN = /^([A-Za-z][A-Za-z0-9+.-]*):/;

/**
 * authority 的終止字元集：`/`、`?`、`#`。
 *
 * 取的是**最寬**的 authority 範圍（RFC 3986 的 `authority = [userinfo "@"] host [":" port]`，
 * 終止於 `/` `?` `#` 或字串結尾）。WHATWG 的 *authority state* 多一個終止字元 `\`，因此
 * WHATWG 眼中的 authority 永遠是本範圍的**前綴**（相等或更短）。
 *
 * ⚠️ 刻意取最寬的那一個，是為了讓 {@link BACKSLASH} 的 fail-closed 檢查能**看見**兩家 parser
 * 分歧的位置——若這裡就把 `\` 當終止字元，`\` 之後的內容會直接落在範圍外而變成隱形。
 */
const AUTHORITY_TERMINATORS = new Set(['/', '?', '#']);

/**
 * authority 內只要出現這個字元，整個網址 **MUST 判為不可開**（fail-closed）。
 *
 * 🔴 **這是本模組唯一一處針對「authority 本體內」parser 家族分歧的 fail-closed，而它是被兩次
 * 繞過逼出來的**。模組內其他回 `null` 的處置定位如下——**{@link AUTHORITY_PREFIX} 同樣在處理
 * 家族分歧**（前綴那一處：WHATWG 把 `/` 與 `\` 視為可互換的前綴分隔字元、RFC 3986 不認），
 * 只是對本模組它是 parity + 縱深防禦而非擋繞過那一道；port 非數字則不涉家族分歧。
 * ⚠️ **MUST NOT 把 {@link AUTHORITY_PREFIX} 從「家族分歧處置」除名**——姊妹專案 Flutter 端正是
 * 放寬前綴比對而造成真實繞過（見本檔稍後的實測記錄）。
 *
 * | 對齊對象 | `https://evil.com\@livebuy.tv/x` | `https://livebuy.tv\@evil.com/x` |
 * |---|---|---|
 * | 不把 `\` 當終止字元（RFC 3986 家族） | 🔴 in-app，但 WHATWG 解出 `evil.com` | external |
 * | 把 `\` 當終止字元（WHATWG 家族） | external | 🔴 in-app，但 Foundation 解出 `evil.com` |
 * | **fail-closed（現行）** | **不可開** ✅ | **不可開** ✅ |
 *
 * 表中四格都是**實測**，不是推論：第一列來自獨立驗收第 1 輪，第二列來自「修好第一個」之後
 * 第 2 輪抓到的**鏡像**繞過。`\` 正好落在兩大 parser 家族的分歧點上：
 *
 * - **WHATWG 家族**（把 `\` 當 authority 終止字元）——本 change 已實測 Node 內建 `URL`；
 *   Chrome / GURL、Dart `Uri` 依規格同屬此家族，**但不在本 change 的實測範圍**。
 * - **RFC 3986 家族**（不當終止字元）——本 change 已用 `swift` + `URL(string:)?.host` 實測
 *   **Apple Foundation**。
 * - AOSP `Uri` 屬於哪一家 **本 change 未實測**，此處不宣稱。
 *
 * **配對任何單一家族，另一家就曝險。** 而 RN 的 `decision.url` 是字串、由**原生側**再解析一次
 * 才開啟（iOS `SFSafariViewController` 走 `URL(string:)`＝Foundation），**同一份裁決會餵給
 * 不只一家 parser**。所以這裡沒有「挑對邊」這個選項。
 *
 * 拒絕它的代價是零：`\` 在合法 URL 的 authority 裡沒有任何真實用途（path / query 裡的 `\`
 * 不受影響——本檢查只掃 authority 範圍）。
 *
 * ⚠️ **維護警告**：把這道檢查改成「當終止字元」或「當普通字元」都會重新打開上表其中一格。
 * 要動它，MUST 先對**兩個 parser 家族**各跑一次 differential（見 `__tests__` 與 tasks.md §5）。
 */
const BACKSLASH = '\\';

/**
 * authority 起點**只**接受這個字面前綴——`scheme:` 之後必須剛好是 `//`，否則整個網址判不可開。
 *
 * **兩家 parser 在 authority 前綴上同樣分歧**（本 change 實測）：WHATWG 的
 * *special authority slashes* / *ignore slashes* 狀態會吃掉**任意數量、任意組合**的 `/` 與 `\`，
 * RFC 3986 家族要求剛好 `//`：
 *
 * | 輸入 | WHATWG（Node）host | Foundation host |
 * |---|---|---|
 * | `https:\\livebuy.tv/x` | `livebuy.tv` | **nil** |
 * | `https:/\livebuy.tv/x` | `livebuy.tv` | **nil** |
 * | `https://\livebuy.tv/x` | `livebuy.tv` | **nil** |
 * | `https:/livebuy.tv/x` | `livebuy.tv` | **nil** |
 *
 * **為什麼保留這條——如實描述，不誇大：**
 *
 * 1. **避免「RN 說 in-app、原生端根本開不了」**。放寬前綴會讓上表這些形狀進入判定並判 in-app，
 *    但 Foundation 對它們解不出 host，iOS 側只會靜默失敗。這是 parity / 正確性問題。
 * 2. **縱深防禦**：它保證 {@link BACKSLASH} 的掃描是從正確的起點開始掃的。姊妹專案 Flutter 端
 *    在同一批修復中正是**放寬了前綴比對**，使 `https:\\host` / `https:/\host` 完全沒進入它的
 *    `\` 掃描範圍而被判 in-app——對它而言那是真的繞過。
 *
 * ⚠️ **但對本模組而言，這條不是擋下繞過的那一道**——已實測：把前綴放寬成 WHATWG 式之後，
 * 雙 oracle differential 與全 ASCII 掃描的越權命中數**仍是 0**，因為 authority 本體的
 * {@link BACKSLASH} fail-closed 仍然接得住。**這裡刻意不把它寫成「安全關鍵」**，
 * 以免下一個維護者以為只要有這條就夠了。真正擋繞過的是 {@link BACKSLASH}。
 *
 * ⚠️ **維護警告**：要放寬它，MUST 先確認 {@link BACKSLASH} 的掃描範圍仍覆蓋放寬後的所有形狀，
 * 並對**兩個 parser 家族**各跑一次 differential。
 */
const AUTHORITY_PREFIX = '//';

/** port 段合法字元：只能是 ASCII 數字（WHATWG 的 port state 同此）。 */
const NON_DIGIT = /[^0-9]/;

/**
 * 非 ASCII 字元。host 判定 MUST 在**轉小寫之前**先用它擋掉，理由不是效能而是正確性。
 *
 * 🔴 **`toLowerCase()` 本身就是 Unicode case mapping**，會把某些非 ASCII 碼位映射成 ASCII，
 * 於是「先小寫、再套 ASCII 字元集 guard」的順序會讓那些碼位**穿過** guard。
 * 獨立驗收掃過全部 1,114,112 個 Unicode 碼位，能穿過的**恰好只有** `U+212A`
 * （KELVIN SIGN，`'\u212A'.toLowerCase() === 'k'`）——`https://evil.com\u212A.livebuy.tv/x`
 * 因此曾被判 in-app。
 *
 * 該案例**沒有安全影響**（兩個 oracle 都把它解成 `evil.comk.livebuy.tv`，仍在 `livebuy.tv`
 * 之下，攻擊者控制不了），但它讓規格那句「非 ASCII ⇒ 不滿足條件 2」**字面為假**，
 * 也讓「MUST NOT 執行任何 Unicode 正規化 / 對映」與「`toLowerCase()`」自相矛盾。
 * 先擋非 ASCII 一次解決三件事：規格句為真、方向更保守、`toLowerCase()` 只會作用在純 ASCII
 * 字串上（純 ASCII 的小寫不是 Unicode 對映，只是 `A-Z` → `a-z`）。
 *
 * ⚠️ **維護警告**：把這道檢查移到 `toLowerCase()` **之後**，等於把 `U+212A` 那個洞放回來。
 * 順序本身就是規則的一部分。
 */
const NON_ASCII = /[^\x00-\x7F]/;

/**
 * 「不是普通主機字元」的字元——允許集合為 ASCII 英數字 + `.` + `-`（已小寫）。
 *
 * 以**否定字元類**表達而不是 `/^[a-z0-9.-]+$/`，純粹是為了避開 `$` 錨點在跨語言閱讀上的
 * 歧義；允許集合本身仍是正面列舉的那一組。
 *
 * **這個集合的安全性質不是「不含 `/`」，而是「不含任何可終止 host 的字元」。**
 * `/ \ @ : ? #`、空白、NUL，以及百分比編碼自身的 `%`，全都不在集合內。
 *
 * ⚠️ **作用域必須說清楚，否則會高估它**：本 guard 只作用在 {@link webHost} 切出的 **host 子字串**
 * （最後一個 `@` 之後、port 之前），**不作用在整段 authority**——userinfo 段與 port 段不受它管轄。
 * 這是刻意的：`@` 與 `:` 在 authority 裡是合法字元（`https://livebuy.tv:8443/x` 依規格 MUST 為
 * in-app），把 guard 套到整段 authority 會擋掉合法輸入。**userinfo / port 段的安全性改由
 * {@link BACKSLASH} 的 fail-closed 與 port 的純數字檢查承擔**，兩者缺一就會出現
 * 「藏在 userinfo 裡的字元完全隱形」——`\` 的繞過正是這樣發生的。
 *
 * **本 guard 真正保證的是（design.md 決策 RN-2）**：{@link LBURLOpenDecision.url} 是字串，
 * 最終由**原生側**再解析一次才開啟，判定用的 parser 與開啟用的 parser 不是同一個。**在
 * {@link BACKSLASH} 的 fail-closed 已使各家 parser 看到同一段 authority 的前提下**，
 * 另一家要從那段 authority 解出不同的 host，只能經由「百分比解碼」（`%`）、「不同的 userinfo
 * 切點」（`@`）或「host 內的分隔字元」（`:` 等）——這些字元都不在集合內，因此本 guard 放行的
 * host 與對方解出的必然是同一個字串。
 *
 * ⚠️ **維護警告：往這個集合加字元會削弱上述不變式。** 加 `%` 會直接開洞——RN 端**不做**百分比
 * 解碼，`https://evil.com%2f.livebuy.tv/x` 與其雙重編碼形式 `%252f` 的 host 字串**本來就**
 * 以 `.livebuy.tv` 結尾，只要 `%` 進了集合就立刻放行。`_` `~` `+` 之類看似無害的字元同樣
 * MUST 先重新論證「不含終止字元」是否仍成立，並補對應測試。
 */
const NON_PLAIN_HOST_CHARACTER = /[^a-z0-9.-]/;

/**
 * host 是否落在 {@link LB_URL_IN_APP_DOMAIN} 這個註冊域（含任意層子網域）。
 *
 * 匯出的理由：規格的
 * `Scenario: 每個 authority 終止字元皆使 host 失去 in-app 資格` 判定對象是 **host 字串本身**
 * （非完整 URL），測試需要一個 host 層級入口。它**不會**從 `src/index.ts` 匯出 → 不屬於套件的
 * 公開表面，不是對 host app 的承諾，也因此不需要 test-only hook 的命名規範（它是實作本體，
 * 不是為測試而生的 hook）。
 *
 * 四道處理，**順序有意義**（第 1 道在第 2 道之前不是風格問題，見 {@link NON_ASCII}）：
 * 0. **擋非 ASCII**——MUST 在小寫**之前**。`toLowerCase()` 是 Unicode case mapping，
 *    先小寫會讓 `U+212A` 這類映射成 ASCII 的碼位穿過字元集 guard。
 * 1. **小寫**——DNS 大小寫不敏感，而 RN 端沒有任何解析器會幫你小寫（自帶 parsing 原樣取出
 *    authority；RN 執行期的 `URL` polyfill 也不小寫）。經第 0 道之後這裡只會處理純 ASCII。
 * 2. **去掉至多一個結尾的點**——`https://livebuy.tv./x` 的 host 是 `livebuy.tv.`（FQDN 根點，
 *    解析到同一台主機）。只去一個：`livebuy.tv..` 去一個後仍不匹配 → external
 *    （保守方向，寧可少給 in-app）。
 * 3. **「普通主機字元」guard——這道不是裝飾**，見 {@link NON_PLAIN_HOST_CHARACTER} 的說明。
 *    移除它會讓 `%2f` / `%252f` 與終止字元的安全測試轉紅（突變測試已驗）。
 *
 * 判定本身是**正面連言**（滿足全部條件才授予 in-app），刻意不寫成黑名單——黑名單會在新的
 * 攻擊形狀出現時變成不完整的窮盡敘述。
 */
export function isInAppHost(host: string): boolean {
  if (NON_ASCII.test(host)) return false;
  const lowered = host.toLowerCase();
  const bare = lowered.endsWith('.') ? lowered.slice(0, -1) : lowered;
  if (bare.length === 0 || NON_PLAIN_HOST_CHARACTER.test(bare)) return false;
  return bare === LB_URL_IN_APP_DOMAIN || bare.endsWith('.' + LB_URL_IN_APP_DOMAIN);
}

/**
 * 從 `http(s)://…` 取出 host。
 *
 * **不使用 `globalThis.URL`**（design.md 決策 RN-1）：RN 上的 `URL` 不是單一實作——RN app
 * 執行期是 `react-native/Libraries/Blob/URL.js` 的 regex 字串包裝（由 `setUpXHR.js` 以
 * `polyfillGlobal('URL', …)` 安裝），單元測試環境則是 Node 內建的 WHATWG `URL`。實測結果是
 * 兩者**各自**會讓一條既有規格 Scenario 失敗：polyfill 的 `hostname` 比對大小寫敏感，
 * `HTTPS://LiveBuy.TV/Terms` 的 `hostname` 為空（真機上會判成不可開）；Node 則把
 * `https:///path` 正規化成 host = `path`（測試環境會判成 external）。以 `URL` 為基底的實作
 * 會出現「單測綠、真機紅」。完整量測表見 design.md §RN `URL` 實測。
 *
 * **本函式要滿足的不變式**（措辭很重要，量詞是「所有」不是「某一個」）：
 *
 * > 本模組判為 in-app 的輸入，**每一個可能開啟它的 parser** 解出的 host MUST 與本模組解出的
 * > 相同。
 *
 * 🔴 **這條的前一版寫的是「MUST 與 WHATWG 切出的相同」，那是錯的**——它把一個**平台相關**的
 * 事實（誰來開這個 URL）押在**單一** parser 家族上。獨立驗收第 2 輪的反例：對齊 WHATWG 之後，
 * `https://livebuy.tv\@evil.com/x` 被判 in-app，而 iOS 的 Foundation 對同一字串解出
 * `evil.com`。**總則成立、目的失守。** 現行作法不依賴任何 oracle 假設：兩家分歧的位置只有 `\`
 * 一處，直接 fail-closed 拒絕它（見 {@link BACKSLASH}），剩下的範圍兩家逐字相同。
 *
 * 只取兩樣東西，不重組也不正規化 URL：
 * - `scheme:` 之後 MUST 剛好是 {@link AUTHORITY_PREFIX}（`//`），否則不可開；
 * - authority = `//` 之後至第一個 {@link AUTHORITY_TERMINATORS}（`/`、`?`、`#`）之前——
 *   這是**最寬**的候選範圍（WHATWG 的 authority 必為其前綴）；
 * - **authority 內含 {@link BACKSLASH} → 整個網址不可開（fail-closed）**；
 * - host = authority 取**最後一個** `@` 之後（userinfo 規則，WHATWG 與 Foundation 實測一致），
 *   再去掉第一個 `:` 起的 port；**port 若非空且含非數字字元則整個網址不可開**
 *   （例如 `https://livebuy.tv:evil.com/x`——iOS / Flutter 皆判不可開，RN 不做唯一放行的一端）。
 *
 * ⚠️ 其餘與各家 parser 的偏離**方向 MUST 是保守**（更容易判不可開，永不多授 in-app）。
 * 以下為**舉例、非窮盡**——判準是方向，不是這份清單：
 * - 不移除輸入中的 tab / LF / CR（WHATWG 會全域移除）。移除只會刪掉非終止字元，因此本模組
 *   切出的 host 等於對方的 host **再插入若干 tab / LF / CR**——那些字元不在
 *   {@link NON_PLAIN_HOST_CHARACTER} 的允許集合內，於是要嘛逐字相同、要嘛本模組判 external。
 * - IPv6 字面量（`https://[::1]/x`）落在 port 的數字檢查上 → 不可開；WHATWG 判 external。
 * - **已知唯一方向相反的一處**：port **範圍**不檢查（`https://livebuy.tv:65536/x` 本模組
 *   判 in-app，WHATWG 視為 invalid URL）。它不影響安全不變式——port 不參與 host 判定，
 *   該輸入的 host 仍是 `livebuy.tv`，受同一條 host 規則約束。
 *
 * @param url 已 trim 的完整輸入。
 * @param schemeEnd `scheme:` 的結束位置（即 `:` 之後）。
 * @returns host；前綴不是剛好 {@link AUTHORITY_PREFIX}、authority 含 {@link BACKSLASH}、
 *   host 為空、或 port 非純數字時回 `null`。
 */
function webHost(url: string, schemeEnd: number): string | null {
  if (url.slice(schemeEnd, schemeEnd + AUTHORITY_PREFIX.length) !== AUTHORITY_PREFIX) return null;
  const authorityStart = schemeEnd + AUTHORITY_PREFIX.length;
  let authorityEnd = url.length;
  for (let i = authorityStart; i < url.length; i += 1) {
    if (AUTHORITY_TERMINATORS.has(url[i])) {
      authorityEnd = i;
      break;
    }
  }
  const authority = url.slice(authorityStart, authorityEnd);
  if (authority.includes(BACKSLASH)) return null;
  const afterUserinfo = authority.slice(authority.lastIndexOf('@') + 1);
  const portIndex = afterUserinfo.indexOf(':');
  if (portIndex !== -1) {
    const port = afterUserinfo.slice(portIndex + 1);
    if (port.length > 0 && NON_DIGIT.test(port)) return null;
  }
  const host = portIndex === -1 ? afterUserinfo : afterUserinfo.slice(0, portIndex);
  return host.length > 0 ? host : null;
}

/**
 * 裁決一個原始網址字串該怎麼開。
 *
 * @param raw 原始字串（`LBProduct.diversionUrl` / `LBShop.serviceLink` / `LBLegalLinks` 常數
 *   皆為字串，故此處吃字串——解析只在這裡發生一次，呼叫點不必各自重寫空字串與解析檢查）。
 * @returns `null` 代表**不可開**（呼叫端 MUST 安全 no-op）；否則為網址 + 開啟方式。
 *
 * 求值順序（固定，先成立者決定結果）：
 * 1. trim 後為空 → `null`
 * 2. 取不到 scheme → `null`（**不補預設 scheme**：`'livebuy.tv/terms'` / `'/terms'` /
 *    protocol-relative 的 `'//livebuy.tv/x'` 都落在此。最後一個特別重要：某些 URL 實作會替它
 *    解出 host `livebuy.tv`，少了這道檢查會直接放行成 in-app）
 *    ⚠️ 規格求值順序的「解析失敗」與「無 scheme」在 RN 端**壓成同一個 `null`**——本模組不使用
 *    會拋例外的解析器，沒有第三種可分辨狀態。對外可觀察的裁決不變。
 * 3. scheme 不在 {@link OPENABLE_SCHEMES} **允許清單**內 → `null`
 * 4. 非 web scheme（`mailto` / `tel` / `sms`）→ `'external'`（**不檢查 payload 語法**——那是各
 *    scheme 自己的規則，OS router 才是權威；空 `mailto:` 仍為 external）
 * 5. web scheme 但取不到 host、或 port 非純數字 → `null`（例：`https:///path`、
 *    `https://livebuy.tv:evil.com/x`）
 * 6. web scheme：{@link isInAppHost} 判定 → `'inApp'` / `'external'`
 *
 * 純函式：不讀寫任何持久化狀態、不發網路請求、不讀系統時鐘、不依賴任何 singleton，
 * 也**不依賴 `globalThis.URL`**，因此同一輸入恆回相同結果，且在 RN 執行期與單元測試環境
 * 得到相同裁決。
 */
export function decide(raw: string): LBURLOpenDecision | null {
  // 型別上 `raw` 是 non-optional `string`，但本函式是 headless SDK 吃**後端可控值**的唯一入口，
  // 而 JS 執行期沒有型別系統擋著（其餘三端有）。非字串一律當成不可開，而不是讓 `.trim()` 拋例外。
  if (typeof raw !== 'string') return null;
  const url = raw.trim();
  if (url.length === 0) return null;
  const schemeMatch = SCHEME_PATTERN.exec(url);
  if (schemeMatch === null) return null;
  const scheme = schemeMatch[1].toLowerCase();
  if (!OPENABLE_SCHEMES.has(scheme)) return null;
  if (!WEB_SCHEMES.has(scheme)) return { url, target: 'external' };
  const host = webHost(url, schemeMatch[0].length);
  if (host === null) return null;
  return { url, target: isInAppHost(host) ? 'inApp' : 'external' };
}

/**
 * URL 開啟策略（純函式命名空間）。
 *
 * 與 iOS `LBURLOpenPolicy` / Android `LBURLOpenPolicy` / Flutter `LBURLOpenPolicy` 的呼叫形狀
 * 對齊；`inAppDomain` 直接引用 {@link LB_URL_IN_APP_DOMAIN}，**值只定義一處**，兩個匯出名不會漂移。
 */
export const LBURLOpenPolicy = {
  inAppDomain: LB_URL_IN_APP_DOMAIN,
  decide,
} as const;
