import { NativeModules, NativeEventEmitter, EmitterSubscription } from 'react-native';
import { LBEvents, type LBEventName } from './LBEvents';
import type { LBAward, LBCartTrack } from './LivebuySDK';
import type {
  LBSdkConfigLoadFailedParams,
  LBSdkConfigRefreshedParams,
} from './SDKConfig';

const { LivebuyRNBridge } = NativeModules;

// MARK: - Event params types (Task 4.6)
//
// Mapped types so handler(eventName, params) is typed per event.

// is_restriction（restriction-gate ②）為**軟性顯示閘門**（additive，Int 0/1）：核心不擋播放，
// VIDEO_OPEN params 附帶供 headless host 自繪遮罩 / template 衍生 isRestricted。缺 → 視為 0。
export interface LBVideoOpenParams { video_id: string; title: string; is_restriction?: number }
export interface LBVideoSwitchParams { from_video_id: string; to_video_id: string }
// subscribe-like-wire-fix-core §8.1 (SemVer MAJOR / BREAKING): `current_likes`
// removed — the /sdk/video/like response carries no like count, so VIDEO_LIKE
// now emits only { video_id }. Aligns with native (iOS/Android dispatch {video_id}).
export interface LBVideoLikeParams { video_id: string }
export interface LBVideoCommentParams { video_id: string; message: string }
export interface LBVideoShareParams { video_id: string }
export interface LBVideoHeartbeatParams { video_id: string; progress_percent: number; duration: number }
export interface LBInfoProductViewParams { video_id: string; product_id: string }
export interface LBCouponClaimParams { video_id: string; coupon_id: string }
export interface LBAuthStateChangedParams {
  state: 'logged_in' | 'logged_out';
  display_name?: string;
  external_user_id?: string;
  resumed_action?: string | null;
}
export interface LBLanguageChangedParams { from: string; to: string }
export interface LBCheckoutCompletedParams {
  order_id: string;
  sdk_track_codes: string[];
  item_count: number;
}
/**
 * CART_ADD_REQUEST params (cart-add-tier2-unify). Fired as a NOTIFICATION after a
 * successful `LivebuySDK.addToCart(...)` (no callback). Carries the addcart `buy_no`
 * + `track` + a freshly-generated `sdk_track_code` so the host adds the item to its
 * OWN cart and (best-effort) reports the cart token via `reportCartTrack`.
 * Mirrors the native enriched params.
 *
 * **兩種觸發來源**（`award-product-auto-cart`）：
 *
 * 1. **使用者手動加購** —— host / template 呼叫 `LivebuySDK.addToCart(...)`。此時
 *    `award_winner_id` **整個省略**。
 * 2. **商品（product）型獎品領獎自動加購** —— native core 在 `POST /sdk/video/claim`
 *    成功、`award.type === 'product'`、**且 claim 回應帶到可用的商品 id** 三者同時成立時
 *    才**自動**再打一次 addcart（host 不需、也不應
 *    自己再加一次，否則會重複加購）。此時本事件多帶 {@link
 *    LBCartAddRequestParams.award_winner_id}，供 host 識別「這筆是獎品」並串回稍早的
 *    `AWARD_CLAIM_RESULT`。discount 型獎品**不會**觸發加購。
 *
 * 事件序列為 `AWARD_CLAIM_RESULT`（先，`status='claimed'`）→ `CART_ADD_REQUEST`（後）。
 * 加購失敗時 SDK **不派任何事件**（沿用既有 addcart 失敗規則），故 host 收到
 * `AWARD_CLAIM_RESULT(status='claimed', award_type='product')` 卻**未**收到配對的
 * `CART_ADD_REQUEST`，即代表該獎品未進入結帳清單。
 *
 * 註：native bridge 對 `params` 採整包泛型透傳（無 per-key allowlist），`award_winner_id`
 * 早已到得了 JS host；RN core **沒有**本事件的 emit / params 組裝程式碼，此 interface 僅為
 * 編譯期型別 / 文件（additive，不影響 runtime）。
 */
export interface LBCartAddRequestParams {
  video_id: string;
  product_id: string;
  /** Selected spec id; `""` for a no-spec product (not a missing key). */
  specification_id: string;
  /** addcart 回應的後端商品編號（host 自家商品目錄 id，如 WooCommerce product id）；後端省略時為 `""`（不缺 key）。 */
  goods_no: string;
  /** addcart 回應的後端規格編號（host 自家商品目錄 variation id）；後端省略時為 `""`（不缺 key）。 */
  specification_no: string;
  /** SDK-generated attribution anchor (the host stores it in its order; order webhook maps it). */
  sdk_track_code: string;
  /** addcart 回應的建單編號；host 後續 `reportCartTrack` 的入參。 */
  buy_no: string;
  /** addcart 回應的導購歸因指令；後端不回時 absent（向後相容）。 */
  track?: LBCartTrack;
  /**
   * 中獎票券 id（= `winner.id`，與 `AWARD_CLAIM_RESULT` 的 `winner_id` **同值**）——
   * **僅**在本筆加購由**商品獎品領獎自動觸發**時出現（`award-product-auto-cart`）。
   * host 據此判定「這筆是獎品，不是一般加購」並串回稍早的領獎事件。
   *
   * **非獎品觸發時 MUST 整個省略此 key（`undefined`）——absent ≠ `''`。** 這與同 interface
   * 的 `goods_no` / `specification_no` / `specification_id`（後端省略時退 `""`、key 恆存在）
   * 是**刻意分歧**：那些欄位缺的是「後端沒回值」，而本欄的**缺席本身就是語意**——
   * 「這筆不是獎品加購」。若退成 `''`，host 就無法區分「非獎品」與「獎品但票券 id 為空」。
   * 因此型別為純 `?: string`（對齊 `track?`），SDK 端亦 MUST NOT 以空字串佔位。
   *
   * SDK **MUST NOT** 因本欄位改變任何計價行為——獎品免費由後端 0 元 SKU 保證。
   */
  award_winner_id?: string;
}
export interface LBAuthRequiredParams {
  trigger_action: 'cart_add' | 'comment_send' | 'coupon_claim' | string;
  product_id?: string;
  video_id?: string;
}
export interface LBProductClickParams { product_id: string; video_id: string }
export interface LBVideoShareRequestParams { [key: string]: never } // empty per spec
export interface LBInfoCustomerServiceParams { video_id: string; anchor_id: string }
// cart-add-tier2-unify: the v1 `CART_ADD_RESULT` notification + `LBCartAddResultParams`
// are retired — its `{ buy_no, track, ... }` semantics merged into the enriched
// `LBCartAddRequestParams` (fired after a successful addToCart). See cart-checkout spec.
// goods-await-notice-endpoints-core §5.2 — AWAIT_GOODS_CHANGED / NOTICE_GOODS_CHANGED.
export interface LBGoodsTrackChangedParams { goods_gpn: string; enabled: boolean }
// reconcile-activity-notification-contract — award-claim events.
// AWARD_CLAIM_INTENT is interceptable/navigation (fired before the claim call);
// AWARD_CLAIM_RESULT is a notification of the backend outcome.
export interface LBAwardClaimIntentParams { id: string; award_type: string; email: string }

/**
 * `AWARD_CLAIM_RESULT` 領獎結果通知的 params（`win-claim-email-result-params-rn-core`）——native core
 * 完成 `POST /sdk/video/claim` 後派發。目的是「**SDK 領獎成功後把獎品與活動資訊交給 host 自行處理**」
 * （host 可據以加入自家購物車、導向獎品頁、顯示獎品卡）。**扁平 wire shape**（snake_case、無巢狀
 * `award: {...}`），與同檔 `LBWinReceivedParams` 風格一致，也與 iOS `awardClaimResultParams` /
 * Android `awardClaimResultParams` 的 native emit 逐 key 一致。
 *
 * **欄位來源二分**（決定「何時有」）：
 *
 * - **記憶體來源**（成功 / 失敗皆可靠）：`status`、`award_type`（`winner.award.type`）、
 *   `winner_id`（`winner.id` 領獎票券 id，供 host 串回稍早的 `WIN_RECEIVED`）、
 *   `event_title`（`winner.title`，非空才帶）。
 * - **API 回應來源**（**僅領獎成功**時存在）：`event_id`、`award_name`（回應 `name`）、
 *   `award_image_url`（回應 `image_url`）、`award_stock`（回應 `stock`）、
 *   `award_code`（回應 `code`，**discount-only**）、`award_expiration`（回應 `expiration_time`，**discount-only**）。
 *
 * **失敗路徑白名單**：失敗（body `code:500` / 其他 code / `email` 缺漏 fail-fast 連 API 都沒送）時
 * **只**帶 `status` / `award_type` / `winner_id`（+ `event_title` 非空時），**不會**有任何 API 回應來源欄位。
 *
 * **省略規則**：SDK 對 nil / 空字串的欄位 **整個省略該 key**（host 端讀到 `undefined`），
 * **絕不**以空字串佔位。`award_stock` 例外於「空值」判斷——**有值即帶，含 `0`**（代表已無庫存）。
 * 型別上 optional 欄位宣告為 `?: T | null`（沿用本檔既有 `event_id` / `award_code` 慣例、對顯式 `null`
 * 保持寬容）；`| null` **僅為型別寬容**，實際契約是「省略」。
 *
 * **SDK 的後續副作用邊界**（`award-product-auto-cart` 已將原本的「零副作用」紅線**限縮**）：
 * SDK **MUST NOT 導頁、MUST NOT 渲染任何 UI**；**discount 型**獎品 **MUST NOT** 加入購物車。
 * **product 型獎品為明確例外**——native core 會在領獎成功後**自動**把獎品加入購物車，並另派一筆
 * {@link LBCartAddRequestParams}（`CART_ADD_REQUEST`）帶 `award_winner_id`（= 本事件的
 * `winner_id`）。host **不需要、也不應該**自己再加一次，否則會重複加購；除此之外的後續處理
 * （導向獎品頁、顯示獎品卡…）仍由 host 自行決定。加購失敗時 SDK 不派任何事件，且本事件的
 * `status` **維持 `claimed` 不被改寫**（後端已核銷票券）。
 *
 * 此型別僅為編譯期文件 / 型別（additive，不影響 runtime；native bridge 早已整包泛型透傳完整 payload 到 JS）。
 */
export interface LBAwardClaimResultParams {
  // ── 記憶體來源（成功 / 失敗皆有）────────────────────────────────
  status: string;
  /** `winner.award.type`（`'product'` / `'discount'`）。 */
  award_type: string;
  /** `winner.id` 領獎票券 id（participant ticket id）——供 host 串回稍早的 `WIN_RECEIVED`。 */
  winner_id: string;
  /** `winner.title` 活動標題；**非空才帶**（空字串時 SDK 省略此 key）。 */
  event_title?: string | null;
  // ── API 回應來源（僅領獎成功才有）───────────────────────────────
  event_id?: number | null;
  /** 回應 `name` 獎品名稱；成功且非空才帶。 */
  award_name?: string | null;
  /** 回應 `image_url` 獎品圖；成功且非空才帶。 */
  award_image_url?: string | null;
  /** 回應 `stock` 獎品庫存；成功且**有值即帶（含 `0`＝已無庫存）**。 */
  award_stock?: number | null;
  /** 回應 `code` 折扣碼；**discount-only**（product award 不帶）。 */
  award_code?: string | null;
  /** 回應 `expiration_time` 折扣到期日；**discount-only**（product award 不帶）。 */
  award_expiration?: string | null;
}

/**
 * `WIN_RECEIVED` 中獎通知的 params——native core 從 `POST /sdk/video/goods` 回應取得個人化中獎
 * `winner` 時派發（登入態才有值）。**扁平 wire shape**（`award_*` 直接在頂層、snake_case），與
 * iOS `notifyWinners` / Android `LivebuyPlayerView` 的 native emit 一致，也與同檔
 * `LBAwardClaimResultParams`（`event_id` / `award_code` snake_case）風格一致。
 *
 * - `title` = 活動標題（供 host 顯示中獎入口文案）。
 * - `event_id` = 活動 id（Int）。
 *
 * 注意：這**不是**巢狀 `award: {...}`，也**不是**巢狀 camelCase 的 public `LBWinner` model（那是另一
 * 層 model，正確、勿混）。先前錯誤的幽靈欄位 `name` 已廢除——正確 key 為 `title`。此型別僅為編譯期文件
 * / 型別（additive，不影響 runtime；native bridge 早已整包泛型透傳完整 payload 到 JS）。
 */
export interface LBWinReceivedParams {
  id: string;
  event_id: number;
  title: string;
  award_type: string;
  award_name: string;
  award_code: string;
}

/**
 * `ACTIVE_EVENT_STARTED` 進行中直播活動（直播抽獎）通知的 params——native core 從
 * `POST /sdk/video/goods` 回應 `event[]` 取得一個**尚未通知過**的進行中活動時派發（fire-once
 * per event id），供 host 自繪活動倒數、獎品預告、或「加入活動」入口文案。**扁平 wire shape**，與
 * iOS `notifyActiveEvents`（`active-event-host-facing-exposure-core`）/ Android `LivebuyPlayerView`
 * （`active-event-host-facing-exposure-android-core`）的 native emit 一致。
 *
 * - `keyword`（「加入活動」口令）為**選填**：native 端 `null`／空時**省略此 key**（host 收到即
 *   absent）——host 據此不顯示「加入活動」CTA、僅呈現活動公告。
 * - `surplus` 為**派發當下的剩餘秒數快照**；host MUST 以 `duration` + 收到事件的牆上時間本地推算即時
 *   倒數（SDK 不逐秒推送）。
 * - `award` 每筆為 `{ type, code, name }`，複用既有 winner award 結構 {@link LBAward}。
 *
 * 注意：這**不是**巢狀的 public `LBActiveEvent` model（屬 native model 層，另一尺度），且**不含**
 * `stayTime`（turnkey 內部停留門檻，native 已排除於 params）。此型別僅為編譯期文件 / 型別（additive，
 * 不影響 runtime；native bridge 早已整包泛型透傳完整 payload 到 JS）。
 */
export interface LBActiveEventStartedParams {
  id: number;
  title: string;
  /** 「加入活動」口令；native 省略時 absent（無可參加 keyword）。 */
  keyword?: string;
  /** 活動總時長（秒）。 */
  duration: number;
  /** 派發當下的剩餘秒數快照；host 自行本地倒數。 */
  surplus: number;
  /** 獎品清單；每筆為 `{ type, code, name }`（複用 winner award 結構）。 */
  award: LBAward[];
}

/**
 * `VIEW_CART` — 用戶點擊「查看購物車」CTA（notification，不可攔截、不 auto-PiP）。
 * `product_id` 僅商品詳情頁 CTA 帶；商品列表底部 CTA 省略該 key（view-cart-event-core）。
 * host 收到後自行收起 / 縮小播放器並導航至自家購物車（template 不擁有結帳頁）。
 */
export interface LBViewCartParams {
  video_id: string;
  product_id?: string;
}

/**
 * `CHAT_HISTORY_LOADED` 的單筆回放歷史留言（replay-chat-history-load +
 * replay-chat-timeline-sync）。
 *
 * `time` = **距影片開始的播放偏移秒數**（String wire；後端可能回 Int，SDK 跨端統一保留 String —
 * JS Number 精度考量）。例如 `time === "12"` 代表這則留言在影片第 12 秒被貼。headless host 可用它自做
 * 彈幕式時間軸同步（依播放進度漸進 reveal）。
 */
export interface LBReplayChatComment {
  text: string;
  name: string;
  color: string;
  reply: string;
  reply_color: string;
  /** 距影片開始的播放偏移秒數（replay-chat-timeline-sync；additive、向後相容）。 */
  time: string;
}

/**
 * `CHAT_HISTORY_LOADED` params（replay-chat-history-load + replay-chat-timeline-sync）。
 *
 * 回放（finished-live replay）進場時 native core 抓完**全部頁**觀眾歷史留言後，派發**一次**的通知型
 * 事件（不可攔截、無 callback）。`comments` 為**全量**、且**依 `time` 升序**；每筆多帶 `time`
 * （播放偏移秒數，additive）。drop-in（reference-ui）走 chatView 渲染、不靠此事件；headless host
 * （RN）回放不啟 PollManager 故收不到 `POLL_RECEIVED`，改以此事件取得回放歷史留言自繪聊天。
 *
 * 註：四端 native bridge 對 `params` 採整包泛型透傳，`time` / 全量 comments 已自動到 JS host；此型別僅
 * 為編譯期文件 / 型別（additive，不影響 runtime）。
 */
export interface LBChatHistoryLoadedParams {
  video_id: string;
  is_replay_seed: boolean;
  comments: LBReplayChatComment[];
}

export interface LBSdkEventParamsMap {
  VIDEO_OPEN: LBVideoOpenParams;
  VIDEO_SWITCH: LBVideoSwitchParams;
  VIDEO_LIKE: LBVideoLikeParams;
  VIDEO_COMMENT: LBVideoCommentParams;
  VIDEO_SHARE: LBVideoShareParams;
  VIDEO_HEARTBEAT: LBVideoHeartbeatParams;
  INFO_PRODUCT_VIEW: LBInfoProductViewParams;
  COUPON_CLAIM: LBCouponClaimParams;
  AUTH_STATE_CHANGED: LBAuthStateChangedParams;
  LANGUAGE_CHANGED: LBLanguageChangedParams;
  CHECKOUT_COMPLETED: LBCheckoutCompletedParams;
  CART_ADD_REQUEST: LBCartAddRequestParams;
  AUTH_REQUIRED: LBAuthRequiredParams;
  PRODUCT_CLICK: LBProductClickParams;
  VIDEO_SHARE_REQUEST: LBVideoShareRequestParams;
  INFO_CUSTOMER_SERVICE: LBInfoCustomerServiceParams;
  AWAIT_GOODS_CHANGED: LBGoodsTrackChangedParams;
  NOTICE_GOODS_CHANGED: LBGoodsTrackChangedParams;
  // reconcile-activity-notification-contract
  AWARD_CLAIM_INTENT: LBAwardClaimIntentParams;
  AWARD_CLAIM_RESULT: LBAwardClaimResultParams;
  // rn-winreceived-typed-params-core — WIN_RECEIVED 完整 winner（扁平 snake_case）
  WIN_RECEIVED: LBWinReceivedParams;
  // active-event-host-facing-exposure-rn-core — ACTIVE_EVENT_STARTED 進行中活動（扁平、keyword 選填、不含 stayTime）
  ACTIVE_EVENT_STARTED: LBActiveEventStartedParams;
  // view-cart-event-rn-core
  VIEW_CART: LBViewCartParams;
  // replay-chat-history-load + replay-chat-timeline-sync (full-list + per-comment time)
  CHAT_HISTORY_LOADED: LBChatHistoryLoadedParams;
  // add-sdk-config-transport
  SDK_CONFIG_LOAD_FAILED: LBSdkConfigLoadFailedParams;
  SDK_CONFIG_REFRESHED: LBSdkConfigRefreshedParams;
}

export interface LBShareContext {
  defaultUrl: string;
  defaultTitle: string;
}

// MARK: - Event payload to handlers

export interface LBSdkEvent<E extends LBEventName = LBEventName> {
  eventName: E;
  params: E extends keyof LBSdkEventParamsMap ? LBSdkEventParamsMap[E] : Record<string, unknown>;
  /**
   * @deprecated Vestigial (cart-add-tier2-unify). In Tier 2 `CART_ADD_REQUEST` is a
   * notification (fired after a successful `addToCart`) and the native bridge never
   * sends a `callbackId` — close the loop via `LivebuySDK.reportCartTrack` + order
   * webhook, not `resolveCart`. Retained for ABI compat; will be removed next major.
   */
  callbackId?: string;
  /** Present only for VIDEO_SHARE_REQUEST. */
  shareContext?: LBShareContext;
}

// MARK: - Cart result API

export interface LBCartSuccess {
  success: true;
  /** Host app's own cart line-item ID, used for attribution. */
  appTrackCode: string;
}

export interface LBCartFailure {
  success: false;
  errorCode: string;
  errorMessage: string;
}

export type LBCartResult = LBCartSuccess | LBCartFailure;

// MARK: - Listener handler

export type LBEventHandler = (event: LBSdkEvent) => void;

// MARK: - registerListener (Task 4.5)

let emitter: NativeEventEmitter | null = null;
let subscription: EmitterSubscription | null = null;

function getEmitter(): NativeEventEmitter {
  if (!emitter) {
    emitter = new NativeEventEmitter(LivebuyRNBridge);
  }
  return emitter;
}

/**
 * Install a JS handler for all SDK events.
 * Returns an unsubscribe function. Calling registerListener twice replaces the prior handler.
 */
export function registerListener(handler: LBEventHandler): () => void {
  // Replace any prior subscription so the latest handler wins (mirrors native setEventListener behaviour).
  if (subscription) {
    subscription.remove();
    subscription = null;
  }

  subscription = getEmitter().addListener('onSdkEvent', (raw: unknown) => {
    // The native bridge always sends an object; guard for robustness.
    if (raw && typeof raw === 'object') {
      handler(raw as LBSdkEvent);
    }
  });

  // Install the native-side listener on first call (idempotent on native).
  LivebuyRNBridge.registerListener();

  return () => {
    subscription?.remove();
    subscription = null;
    LivebuyRNBridge.unregisterListener();
  };
}

/**
 * @deprecated Vestigial (cart-add-tier2-unify). In Tier 2 `CART_ADD_REQUEST` is a
 * notification — the native bridge never hands out a `callbackId`, so this resolves
 * nothing. Close the add-to-cart loop via `LivebuySDK.reportCartTrack` + the host
 * order webhook instead. Retained for ABI compat; removed next major.
 */
export function resolveCart(callbackId: string, result: LBCartResult): void {
  if (result.success) {
    LivebuyRNBridge.resolveCartRequest(callbackId, true, result.appTrackCode, null, null);
  } else {
    LivebuyRNBridge.resolveCartRequest(callbackId, false, null, result.errorCode, result.errorMessage);
  }
}

export { LBEvents, type LBEventName } from './LBEvents';
