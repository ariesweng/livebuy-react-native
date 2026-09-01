// LBLegalLinks — url-open-policy-rn（core 層 / React Native parity）
//
// `## Depends On: url-open-policy-and-host-routing-core`（iOS lead，已 archive）。

/**
 * Livebuy 法務連結的**四端共用單一事實來源**。
 *
 * **為什麼放 core，而不是放在中獎 modal footer 旁邊（reference-ui）**：
 * - 它是四端共用的**同一個事實**——同一個網址會被 iOS / Android / RN / Flutter 各自的 footer
 *   消費；放 reference-ui 等於四份複製，任一端漂移一次就再也對不齊。
 * - footer **只是它的其中一個消費點**——完全自繪 UI 的 headless（Tier 0）host 一樣需要在自家
 *   中獎畫面上放這兩個連結；常數鎖在 reference-ui 會逼 Tier 0 host 自己抄字串。
 *
 * **為什麼是 `string`**：Kotlin / TypeScript / Dart 沒有等價的 URL value type，`string` 是四端
 * 共同的最低公分母，parity change 可逐字照抄；而
 * {@link ../LBURLOpenPolicy.decide | LBURLOpenPolicy.decide} 本來就吃字串，兩者天然接得起來。
 *
 * **不是 i18n key**：網址不隨語系變化。
 *
 * 與政策自洽：兩個常數都是 `livebuy.tv`，餵進 `LBURLOpenPolicy.decide` 必得 `'inApp'`
 * （由 `__tests__/LBURLOpenPolicy.test.ts` 釘死）。
 */
export const LBLegalLinks = {
  /** 使用條款。 */
  termsOfUse: 'https://livebuy.tv/terms-of-use',
  /** 隱私政策。 */
  privacyPolicy: 'https://livebuy.tv/privacy-policy',
} as const;
