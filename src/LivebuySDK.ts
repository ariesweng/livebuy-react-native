import { NativeModules } from 'react-native';
import type { SDKConfig } from './SDKConfig';

const { LivebuyRNBridge } = NativeModules;

// MARK: - Domain types

export interface LBUser {
  /** Required on setUser(); optional on configure(). */
  displayName: string;
  avatarUrl?: string;
  externalUserId?: string;
}

export interface LBConfigOptions {
  apiKey: number;
  secret: string;
  /**
   * Shop ID (base-62 encoded, e.g. `"Pw8PJ99J"`). Determines which shop's
   * `/sdk/config` is fetched and is the scope key for the on-disk cache
   * (`lb_sdk_config_{shopId}`). Required — Platform Key switching shops
   * must re-configure with the new shopId. Per `sdk-config` capability.
   */
  shopId: string;
  /**
   * API major version sent as `X-API-Version` header by the native SDK.
   * Default `1`. Invalid (0 / negative) values fall back to `1` natively
   * with a debug log. Per api-version-resilience.
   */
  apiVersion?: number;
  lang?: LBLocaleCode;
  user?: Partial<LBUser>;
  /** Auto-enter PiP when a navigation interceptor event is taken over by the listener. Default true. */
  autoPipOnIntercept?: boolean;
  /**
   * Max wait for `/sdk/config` on the no-cache blocking path AND the
   * background-refresh path. Default 5000 ms. Invalid (≤0) values fall back
   * to 5000 natively with a debug log. Per `sdk-config` capability.
   */
  configFetchTimeoutMs?: number;
  /**
   * Opt-in for Meta conversion-attribution context (`conversion-attribution-context`).
   * Default `false`. When enabled, the native SDK injects non-empty
   * `fbp` / `fbc` / `referer` into every backend request (centrally, no per-call
   * site); when disabled nothing is generated, persisted, or injected (ATT /
   * privacy: no silent tracking — host owns ATT / GDPR consent). The SDK never
   * sends `ip` / `agent` and never embeds the Facebook SDK. Feed `fbc` via
   * {@link captureAdClick} / {@link setFbclid}, `referer` via {@link setReferer}.
   */
  enableConversionAttribution?: boolean;
  /**
   * Opt-OUT for thermal-aware power-profile adaptation (`power-profile-adaptation`).
   * Default `true` — as the device heats up the native SDK auto down-scales live
   * playback (lower quality cap + longer poll interval) and restores symmetrically
   * as it cools. Pass `false` to keep the subsystem dormant (fixed behaviour). No
   * effect where the platform thermal API is unavailable (iOS pre-thermal /
   * Android API < 29 → always `full`). The native SDK owns the adaptation; the host
   * can read the current tier via {@link currentPowerProfile} and observe changes via
   * the `POWER_PROFILE_CHANGED` unified event.
   */
  enablePowerProfileAdaptation?: boolean;
  /**
   * Opt-OUT for SDK-native `/stat` telemetry (`sdk-stat-reporting`). Default
   * `true` (on). The native SDK sends `/stat` datapoints (video_pv /
   * video_people / video_share / live_like / bag_click / goods_* + person_time /
   * person_duration watch timers). The `/stat` wire carries only `type` +
   * video/goods `id` + `val`/`link`/`bid`/`len` (no PII, no device id, no ip), so
   * it defaults on — unlike {@link enableConversionAttribution}, which stays
   * opt-in because it carries Meta attribution ids (PII). Pass `false` to fully
   * disable: the native SDK generates no state, persists nothing, and sends
   * nothing (headless; ATT / GDPR consent is the host's responsibility).
   *
   * RN is a pass-through wrapper: this flag is forwarded to the native `configure`
   * and ALL `/stat` sending / timing / dedupe happens in the wrapped iOS / Android
   * native SDK — the JS layer never sends `/stat` itself. Erase persisted state
   * via {@link clearStatContext}.
   */
  enableStatReporting?: boolean;
  /**
   * SDK-wide environment selector (`sdk-stat-endpoint-environment-selection-core` +
   * `sdk-data-api-environment-selection-core` / `android-data-api-environment-selection-core`).
   * Default `'production'`. It now has TWO consumers, both resolved natively:
   *   1. The data API base URL for every `/sdk/*` request: `'develop'` →
   *      `https://develop-admin.livebuy.tv/v1`, `'production'` (or omitted) →
   *      `https://api.livebuy.tv/v1`.
   *   2. The direct-send `/stat` telemetry endpoint: `'develop'` →
   *      `https://develop.livebuy.tv/stat`, `'production'` (or omitted) →
   *      `https://livebuy.tv/stat`.
   * RN is a pass-through wrapper — this flag is forwarded to the native
   * `configure(...environment)`; BOTH the data API base URL selection and the `/stat`
   * endpoint selection (plus all `/stat` sending) happen in the wrapped iOS / Android
   * native SDK, so the JS layer resolves no URL of its own. `environment` switches
   * URLs ONLY, never credentials: develop has its own backend credentials, so a host
   * selecting `'develop'` MUST pass matching dev `apiKey` / `secret` / `shopId`.
   * Orthogonal to {@link enableStatReporting} (that governs whether `/stat` is sent,
   * never which endpoint).
   */
  environment?: LBEnvironment;
}

/**
 * SDK-wide environment — the stable cross-platform **wire string** of the native
 * `LBEnvironment` enum (iOS `.production` / `.develop`, Android `PRODUCTION` /
 * `DEVELOP`). Lowercase values mirror the iOS enum-case spelling; the native bridge
 * maps the string to the native enum (unknown / omitted → `'production'`). Natively
 * selects BOTH the data API base URL (`'develop'` → `https://develop-admin.livebuy.tv/v1`,
 * else `https://api.livebuy.tv/v1`) and the `/stat` endpoint (per
 * `sdk-stat-endpoint-environment-selection-core` +
 * `sdk-data-api-environment-selection-core`). Switches URLs only, never credentials.
 */
export type LBEnvironment = 'production' | 'develop';

/**
 * Product spec (variant) — `LBProduct.specifications[]`. Full 9-field
 * projection aligned to `shared/data-models.md` §LBSpec and the iOS/Android
 * core `LBSpec`. Distinct from `LBBridgeSpec` (the reduced `simulate*` intent
 * shape) — this is the full spec carried inside a productTap payload.
 *
 * Per product-bridge-data-core: wire keys are camelCase.
 */
export interface LBSpec {
  /** Spec encoded ID (String — same JS Number-precision rationale as product id). */
  id: string;
  /** Display name, e.g. "S" / "紅色". */
  name: string;
  /** Spec number. */
  specificationNo: string;
  /** Numeric price as string (§price 精度 — RN host self-parses, e.g. decimal.js). */
  price: string;
  /** Currency-formatted price, e.g. "NT$590" — the primary display source. */
  priceShow: string;
  /** Numeric original price as string; `null` when absent / 0 (no original price). */
  originalPrice: string | null;
  /** Formatted original price ("" = none). */
  originalPriceShow: string;
  /** Spec stock count. */
  stock: number;
  /** Spec image URLs (may be empty). */
  photos: string[];
}

/**
 * Spec dimension tree — `LBProduct.specOptions[]`, used to build the spec
 * selector matrix. Aligned to `shared/data-models.md` §LBSpecOption.
 */
export interface LBSpecOption {
  /** Dimension name, e.g. "尺寸" / "顏色". */
  name: string;
  /** Option values, e.g. ["S", "M", "L"]. */
  child: string[];
}

export interface LBProduct {
  /**
   * Product ID. Spec mandates string (per component-contracts §schema risks):
   * API may return Int, but JS Number precision risk forces SDK to keep it
   * as String. The native bridge coerces before serialization.
   */
  id: string;
  /** Product number (String — API may deliver Int; coerced). */
  goodsNo: string;
  name: string;
  /**
   * Numeric price as string (§price 精度: RN carries `price` as string so the
   * host can self-parse with arbitrary precision). `priceShow` remains the
   * primary display source.
   */
  price: string;
  priceShow: string;
  /**
   * Numeric original price as string. `null` when the product has no original
   * price (§price 精度: `original_price == 0` and absent both mean "no original
   * price").
   */
  originalPrice: string | null;
  /** Formatted original price string ("" = no original price). */
  originalPriceShow: string;
  /**
   * Spec mandates string (same JS Number-precision rationale as `id`).
   * Bridge coerces from Int when API delivers numeric.
   */
  goodsGpn: string;
  /** Stock count. */
  stock: number;
  /** Main product image URL. */
  pic: string;
  /** Additional product image URLs. */
  photos: string[];
  /** Product brief / description. */
  brief: string;
  /**
   * Product introduction text (parallel to, and distinct from, `brief`). Wire key
   * `description` on `/sdk/video` `goods[]` / `other_goods[]` items
   * (add-product-description-core-rn, parity add-product-description-core-ios /
   * -android). Tolerant decode (missing/null/type-mismatch → "") already happened upstream
   * in iOS/Android core; the native bridge event ALWAYS supplies this key with a non-null
   * string.
   *
   * OPTIONAL here regardless (round-2 correction) — same rationale as the
   * goods-conclusion-fields block below: TS has no cross-module field defaults, so marking
   * this required forces every hand-built `LBProduct` object literal across the dependent
   * packages (`livebuy-react-native-ui` / `livebuy-react-native-reference-ui` — demo seeds,
   * test fixtures, and non-test source such as `PlayerShellModel.ts` /
   * `recommendationBreadcrumb.ts`) to add a field they don't use, breaking their typecheck.
   * A legacy / hand-built payload that omits it reads `undefined` → host applies its own
   * fallback (`?? ''`), same pattern as `label?` / `canView?` etc.
   */
  description?: string;
  soldOut: number;        // 0 | 1 — API returns integer, not boolean
  isHot: number;          // 0 | 1
  /** 0 | 1 — about to sell out. */
  isOutSoon: number;
  /** 0 = normal, 2 = host currently narrating this product (live). */
  narrateStatus: number;
  // -- Backend goods conclusion fields (`/sdk/video/goods` mapGoodsItem,
  //    goods-conclusion-fields spec; iOS a9d13a7 / Android 1f5c730) ----------
  //
  // OPTIONAL on the wire — TS has no cross-module field defaults, so making
  // these required would break every `LBProduct` literal in
  // livebuy-react-native-ui / -reference-ui (demo seeds / test helpers). The
  // native bridge ALWAYS supplies them (native LBProduct has non-optional
  // defaulted properties); a legacy / hand-built host payload that omits them
  // reads `undefined` → host applies its own fallback. `narrate_status` is
  // back-filled into [narrateStatus] by the NATIVE core, so RN consumers of
  // `narrateStatus == 2` keep working with no TS change.
  /** 能否看到（恆 true：查詢層已濾刪除/封存/獎品）。缺鍵 → 視為 true。 */
  canView?: boolean;
  /** 能否買（= !sold_out）。缺鍵 → 由 `soldOut` 派生。 */
  canBuy?: boolean;
  /** 是否介紹中（= narrate_status == 2；僅 type=2 有意義）。缺鍵 → 由 `narrateStatus` 派生。 */
  isNarrating?: boolean;
  /** 是否需顯示標籤（sold_out||narrating||out_soon||hot）。缺鍵 → 由四旗標派生。 */
  needLabel?: boolean;
  /** 唯一標籤："sold_out"/"narrating"/"out_soon"/"hot"/""（raw passthrough，不解讀語意）。 */
  label?: string;
  /** 0 | 1 — current user is tracking this product. */
  isAwait: number;
  /** 0 | 1 — current user has set a restock notice. */
  isAwaitNotice: number;
  /** Replay narration segment start seconds; `null` = no record. */
  beginTime: number | null;
  /** Replay narration segment end seconds; `null` = no record. */
  endTime: number | null;
  diversionUrl: string;
  /** Spec (variant) list — empty when the product has no specs. */
  specifications: LBSpec[];
  /** Spec dimension tree for the UI spec selector. */
  specOptions: LBSpecOption[];
  /**
   * Cross-video product reference (component-contracts §"other_goods 含
   * video_id 欄位"). Set only on items sourced from `LBChannel.other_goods[]`
   * (lets a host jump-to-video via `player.load(videoId)` for a recommended
   * product that belongs to a different video); `undefined` on items sourced
   * from `LBChannel.goods[]` — the native bridge OMITS this key rather than
   * sending `null` (optional, not nullable — add-product-video-id-core-rn).
   */
  videoId?: string;
}

export interface LBPollResponse {
  /**
   * Poll cursor. API returns a float (e.g. 11988703.261723042), not a string.
   * poll-comments-decode-robustness-core §7.1: the native side tolerates an
   * empty cursor (`last: []` / null / number) and normalises it to a `0`
   * sentinel meaning "no new cursor — do not regress". JS therefore always
   * receives a number; `0` indicates the empty-cursor case.
   */
  last: number;
  liveEnd?: number;
}

/**
 * Award payload carried by `ActivityNotificationView.showWin` and surfaced
 * through `LBWin` events. Per spec §ActivityNotification 元件契約.
 */
export interface LBAward {
  /** "product" or "discount". */
  type: string;
  /** Backend code (discount code / product SKU pointer). */
  code: string;
  /** Pre-i18n'd human-readable award name. */
  name: string;
}

export interface LBWinner {
  id: string;
  eventId: number;
  title: string;
  award: LBAward;
}

/**
 * A single in-progress live event (直播抽獎「進行中活動」), returned by the
 * imperative accessor {@link LivebuyPlayerCoreRef.activeEvents} as a read-only
 * snapshot of what the latest `POST /sdk/video/goods` `event[]` cached natively
 * (active-event-accessor-rn-core). Lets a「中途進場」host — one that installed its
 * listener AFTER an event started and therefore missed the fire-once
 * `ACTIVE_EVENT_STARTED` notification — pull the current state, closing the
 * push-event late-subscriber blind spot. Mirrors iOS/Android public `LBActiveEvent`.
 *
 * Flat wire shape (same as {@link LBActiveEventStartedParams}, the
 * `ACTIVE_EVENT_STARTED` event params):
 * - `keyword`「加入活動」口令 is OPTIONAL — native omits the key when null/empty
 *   (host reads `undefined` → 純活動公告、無「加入活動」CTA).
 * - `surplus` is the remaining-seconds SNAPSHOT at query time; host推算即時倒數
 *   with `duration` + wall-clock (the SDK does not push per-second updates).
 * - `award` reuses the existing {@link LBAward} `{ type, code, name }` structure.
 *
 * NOTE: intentionally EXCLUDES `stayTime` (the turnkey internal dwell threshold —
 * native excludes it from the accessor wire serialization, not host UI info).
 */
export interface LBActiveEvent {
  /** `live_event_id` of this active event. */
  id: number;
  /** Event title (e.g. "週年慶抽獎"). */
  title: string;
  /** 「加入活動」join keyword; omitted when native has none (絕不空字串占位). */
  keyword?: string;
  /** Total activity duration in seconds. */
  duration: number;
  /** Remaining seconds snapshot at query time; host self-counts down. */
  surplus: number;
  /** Award list; each `{ type, code, name }` (reuses the winner award structure). */
  award: LBAward[];
}

/**
 * Contact info the host collects (e.g. in `LBWinSheet`) before claiming an
 * award. `email` is required and MUST be trimmed by the host before passing;
 * both award types (`product` / `discount`) only need an email — there is no
 * shipping address field. Forwarded to the native `requestAwardClaim` call.
 */
export interface LBAwardClaimInput {
  email: string;
}

/**
 * Award-claim status reported back through `AWARD_CLAIM_RESULT`. The backend
 * is the source of truth (code-as-truth): inner `code: 200` → `'claimed'`,
 * inner `code: 500` → `'failed'`. Any other code is surfaced verbatim as an
 * `unknown_<code>` string (e.g. `'unknown_403'`) for forward-compatibility —
 * the `(string & {})` arm keeps autocomplete on the two known literals while
 * still admitting those open strings.
 *
 * `status` is only ONE of the ten keys the notification carries: on success
 * `AWARD_CLAIM_RESULT` also brings the full award + activity info (award name /
 * image / stock / discount code + expiration / event id + title / winner ticket
 * id) so the host can handle the follow-up itself. The SDK does NOT navigate and
 * renders nothing; a **discount** award is never added to a cart. A **product**
 * award is the one deliberate exception (`award-product-auto-cart`): native core
 * auto-adds it to the backend checkout list and fires a second notification,
 * `CART_ADD_REQUEST`, carrying `award_winner_id` (=== this event's `winner_id`).
 * Do NOT add it again from the host — that would double-add. On failure only the
 * in-memory keys are present.
 * Full field contract: see `LBAwardClaimResultParams` and the award-cart marker
 * `LBCartAddRequestParams.award_winner_id` (both in `./LivebuyEvents`).
 */
export type LBAwardClaimStatus = 'claimed' | 'failed' | (string & {});

/**
 * Event metadata fields on push messages (per spec §LBPushMsg event 欄位).
 * Surfaced through the unified event listener when a chat push row carries
 * an event payload. Use `isEventBegin` / `isEventEnd` helpers in TS.
 */
export interface LBPushMsgEventMeta {
  eid?: number;
  ek?: string;
  /** "begin" or "end" — explicit server signal. */
  at?: string;
  ct?: string;
  p?: string;
}

export type LBPlayerState =
  | 'loading'
  | 'buffering'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error'
  // decouple-ui-from-logic sub-states (per spec §Player States).
  | 'awaitingLive'
  | 'startScreenPlaying'
  | 'endScreenShown';

export type LBError =
  | { type: 'restricted' }
  | { type: 'videoNotFound' }
  | { type: 'invalidSignature' }
  | { type: 'chatRateLimited' }
  // commentsub-checkname-contract-core §7.1: chat business errors. The native
  // bridge emits these camelCase `type` strings (consistent with the existing
  // RN convention, e.g. videoNotFound), mapped from core LBError
  // guestNameTaken (403) / chatRequiresLogin (401) / notLive (404).
  | { type: 'guestNameTaken' }
  | { type: 'chatRequiresLogin' }
  | { type: 'notLive' }
  | { type: 'networkError'; message: string }
  | { type: 'serverError'; code: number; message: string }
  /**
   * Add-to-cart 30s 防重複建單 dedupe 命中（cart-add-tier2-unify）：同
   * `(goodsId, videoId)` 30 秒內已加購過，`addToCart` MUST NOT 重打 addcart。host /
   * drop-in template 應視為「已加入購物車」而非失敗。Mirrors native
   * `LBError.cartAddDeduplicated`.
   */
  | { type: 'cartAddDeduplicated' }
  /**
   * Backend inner code 426 — this SDK version is no longer accepted.
   * Raised per-API-call (no dedup); see `shared/error-codes.md`.
   */
  | { type: 'sdk_version_unsupported' };

// MARK: - fetchLatestLive types

export interface LBVideoItem {
  id: string;
  type: number;
  title: string;
  sessionName?: string;
  cover: string;
  preview: string;
  duration: number;
  publishAt: string;
  watchNum: number;
  pvNum: number;
  liveStatus: number;
  pin: number;
  showPvNum: number;
  liveurl: string;
  playbackurl: string;
  previewTime: string;
  showStock: boolean;
}

// MARK: - Player channel info (upcoming-intro-core-rn — channel 轉發 bridge)

/**
 * A LIGHTWEIGHT projection of the player's loaded `LBChannel`, forwarded from the
 * native player view to the JS host via the `onChannelChange` prop
 * (upcoming-intro-core-rn). It carries ONLY the fields the player-side upcoming
 * (直播預告) chrome needs — it is NOT the full core `LBChannel` (no goods / nav /
 * spec; `shop` is represented ONLY by the single `serviceLink` field below — no
 * other shop fields, dropin-service-link-default-browser-core-rn). The host feeds
 * these into the `react-native-ui` template's upcoming view-model (後續
 * `upcoming-intro-template-rn`):
 *
 *   • `publishAt`   — scheduled start (UTC+8 `"yyyy-MM-dd HH:mm:ss"`). Feeds
 *                     `DefaultUpcomingState.scheduledStartAt`.
 *   • `cover`       — video cover URL. The upcoming countdown background.
 *   • `start`       — opening MP4 (intro) URL (`channel.start`). Non-empty drives
 *                     the StartScreen splash + the upcoming `introPlaying` gate.
 *   • `liveStatus`  — `0` = upcoming (直播預告), `1` = live, other = VOD. `-1` =
 *                     unknown (field absent) — NOT upcoming.
 *   • `title`       — channel title (informational; the header chrome already has
 *                     its own host-fed source).
 *   • `serviceLink` — shop customer-service link (`channel.shop.serviceLink`).
 *                     Lets a host/reference-ui-rn layer open a default in-app
 *                     browser (via {@link LivebuySDK.openInAppBrowser}) when it
 *                     doesn't handle the「聯絡商家」confirm CTA itself
 *                     (dropin-service-link-default-browser-core-rn). This SDK does
 *                     NOT open any browser itself — see that change's design.md
 *                     for why RN can't reuse the iOS/Android
 *                     intercepted-Bool-passthrough approach for this decision.
 *   • `subtitleUrl`  — VTT caption file URL (`channel.subtitle_url`). `""` when
 *                     absent (no subtitle file).
 *   • `isSubtitle`   — whether the channel has a subtitle track available
 *                     (`channel.is_subtitle`, `0`/`1`). Kept as a raw `number`
 *                     (not coerced to `boolean`), mirroring the existing
 *                     `LBProduct.isHot`/`isOutSoon` 0/1-Int-flag convention.
 *                     `subtitleUrl`/`isSubtitle` are purely additive
 *                     (rb-react-native-subtitle-channel-info-bridge-core) — data
 *                     plumbing only; VTT parsing / CC toggle wiring / rendering
 *                     is a separate downstream reference-ui change. Consumers
 *                     should gate on BOTH fields (`isSubtitle === 1 &&
 *                     subtitleUrl.trim() !== ''`), mirroring the iOS
 *                     `channelHasFetchableSubtitle` pure-function gate.
 *
 * `upcoming.active` itself does NOT need this projection — it is derivable from the
 * already-forwarded player state (`"awaitingLive"`); this projection supplies the
 * REMAINING upcoming inputs (`scheduledStartAt` / `cover` / `introPlaying` /
 * `hasStart`) that the player state alone cannot carry.
 */
export interface LBPlayerChannelInfo {
  /** Scheduled start (`channel.publish_at`, UTC+8). `""` when absent. */
  publishAt: string;
  /** Video cover URL (`channel.cover`). `""` when absent. */
  cover: string;
  /** Opening MP4 (intro) URL (`channel.start`). `""` when absent (no intro). */
  start: string;
  /** Live status: `0` = upcoming, `1` = live, other = VOD. `-1` = unknown. */
  liveStatus: number;
  /** Channel title (`channel.title`). `""` when absent. Informational. */
  title: string;
  /**
   * Shop customer-service link (`channel.shop.serviceLink`). `""` when the shop
   * has none configured (dropin-service-link-default-browser-core-rn).
   */
  serviceLink: string;
  /**
   * VTT caption file URL (`channel.subtitle_url`). `""` when absent (no
   * subtitle file). Purely additive data plumbing
   * (rb-react-native-subtitle-channel-info-bridge-core) — VTT parsing / CC
   * toggle wiring / rendering is a separate downstream reference-ui change.
   */
  subtitleUrl: string;
  /**
   * Whether the channel has a subtitle track available (`channel.is_subtitle`,
   * `0`/`1`). Kept as a raw `number` (not coerced to `boolean`), mirroring the
   * existing `LBProduct.isHot`/`isOutSoon` 0/1-Int-flag convention. `0` when
   * absent / unparseable (conservative default: assume no subtitle — unlike
   * `liveStatus`, this field has no "unknown" tri-state need).
   */
  isSubtitle: number;
}

/**
 * Maps the native player-view snake_case wire payload to the host-facing camelCase
 * `LBPlayerChannelInfo` (upcoming-intro-core-rn). Exported for testing — the native
 * bridge `.swift`/`.kt` does not compile in this repo, so this pure mapper is the
 * acceptance gate for the wire → host shape (parity with {@link mapWidgetColors}).
 *
 * Wire contract (raw passthrough, SDK does not interpret):
 *   - string fields (`publish_at` / `cover` / `start` / `title` / `service_link` /
 *     `subtitle_url`): missing / null → `""`.
 *   - `live_status`: Number OR a stringified Int is tolerated; missing → `-1` (unknown).
 *   - `is_subtitle`: Number OR a stringified Int is tolerated; missing / unparseable →
 *     `0` (no subtitle) — see {@link coerceIsSubtitle}.
 */
export function mapPlayerChannelInfo(wire: {
  publish_at?: string | null;
  cover?: string | null;
  start?: string | null;
  live_status?: number | string | null;
  title?: string | null;
  service_link?: string | null;
  subtitle_url?: string | null;
  is_subtitle?: number | string | null;
}): LBPlayerChannelInfo {
  return {
    publishAt: wire.publish_at ?? '',
    cover: wire.cover ?? '',
    start: wire.start ?? '',
    liveStatus: coerceLiveStatus(wire.live_status),
    title: wire.title ?? '',
    serviceLink: wire.service_link ?? '',
    subtitleUrl: wire.subtitle_url ?? '',
    isSubtitle: coerceIsSubtitle(wire.is_subtitle),
  };
}

/**
 * Coerce a wire `live_status` to a number. Absent / unparseable → `-1` (unknown).
 * Tolerates a Number (native emit) OR a stringified Int (defensive).
 */
function coerceLiveStatus(value: number | string | null | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number.parseInt(value, 10);
    return Number.isNaN(n) ? -1 : n;
  }
  return -1;
}

/**
 * Coerce a wire `is_subtitle` 0/1 flag to a number. Absent / unparseable → `0`
 * (no subtitle) — a conservative default, NOT the `-1` "unknown" sentinel
 * `coerceLiveStatus` uses (`is_subtitle` has no unknown tri-state need).
 * Tolerates a Number (native emit) OR a stringified Int (defensive), mirroring
 * `coerceLiveStatus`.
 */
function coerceIsSubtitle(value: number | string | null | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number.parseInt(value, 10);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

// MARK: - VOD playback progress (rn-vod-playback-progress-core)

/**
 * VOD playback progress, published on a DEDICATED channel
 * (`LivebuyPlayerCoreProps.onPlaybackProgressChange`) — intentionally NOT part
 * of the player-state surface, mirroring iOS `LBPlaybackProgress` /
 * `Player.playbackProgress` + `onPlaybackProgressChange` and Android
 * `LivebuyPlayerView.playbackProgress` + `onPlaybackProgressChange`
 * (component-contracts §Player VOD playback-progress 頻道與控制出口 /
 * §Player（Android）VOD playback-progress 頻道 — isReplay slice parity).
 *
 * `duration === 0` ⇒ live (no scrubbable timeline). `isReplay` = a LIVE stream
 * scrubbed behind the live edge (only ever `true` while `liveStatus === 1`).
 */
export interface LBPlaybackProgress {
  /** Current playhead, seconds. Sanitized to a finite, non-negative value. */
  position: number;
  /** Total duration, seconds (`0` for an indefinite live stream). Sanitized to
   *  a finite, non-negative value. */
  duration: number;
  /** Whether the active engine is playing right now. */
  isPlaying: boolean;
  /** LIVE stream scrubbed behind the live edge (`liveStatus === 1` only). */
  isReplay: boolean;
}

/**
 * Maps the native player-view playback-progress wire payload to the
 * host-facing `LBPlaybackProgress` (rn-vod-playback-progress-core). Exported
 * for testing — the native bridge `.swift`/`.kt` does not compile in this
 * repo, so this pure mapper is the acceptance gate for the wire → host shape,
 * same pattern as `mapPlayerChannelInfo` / `mapWidgetColors`.
 *
 * Unlike `mapPlayerChannelInfo`, the wire is sent **camelCase directly**
 * (`{ position, duration, isPlaying, isReplay }`, mirroring `emitPollReceived`'s
 * style) — `LBPlaybackProgress` is an SDK-internal value type, never decoded
 * from API JSON, so there is no snake_case wire convention to bridge.
 *
 * `position` / `duration`: missing, non-finite, or negative → sanitized to `0`
 * (mirrors iOS/Android core's own NaN-sanitize contract). `isPlaying` /
 * `isReplay`: missing/null → `false`.
 */
export function mapPlaybackProgress(wire: {
  position?: number | null;
  duration?: number | null;
  isPlaying?: boolean | null;
  isReplay?: boolean | null;
}): LBPlaybackProgress {
  return {
    position: sanitizeNonNegativeFinite(wire.position),
    duration: sanitizeNonNegativeFinite(wire.duration),
    isPlaying: wire.isPlaying ?? false,
    isReplay: wire.isReplay ?? false,
  };
}

/** Coerce a raw wire number to a finite, non-negative value. Missing / NaN /
 *  Infinity / negative → `0`. */
function sanitizeNonNegativeFinite(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

// MARK: - addToCart types (video-addcart-endpoint-core, 路線 B)
//
// NOTE: this is DISTINCT from `LBCartResult` in LivebuyEvents.ts — that union
// is the host's *response* to a route-A CART_ADD_REQUEST callback. This is the
// SDK-driven route-B online add-to-cart *result* (mirrors native LBCartResult
// { goodsNo, specificationNo, buyNo }); named LBAddToCartResult here to avoid
// colliding with the pre-existing route-A export.

export interface LBAddToCartOptions {
  /** Shop ID (required). */
  shopId: string;
  goodsId?: number;
  num?: number;
  specificationId?: number;
  ids?: number[];
  live?: number;
  isLive?: number;
  isWidget?: number;
  inDomain?: number;
  userid?: string;
  thirdpartyUserId?: string;
  buyingId?: number;
  eventId?: number;
  guestName?: string;
  dbsc?: string;
  /**
   * 當前影片短碼（cart-add-tier2-unify）。透傳給 native `addToCart(videoId:)`，使後續
   * `CART_ADD_REQUEST.video_id` 為當前影片（而非 `""`）。Mirrors native `videoId`.
   */
  videoId?: string;
}

// MARK: - addcart track (addcart-track ④, parity iOS core-addcart-track)
//
// 後端 addcart 回應的導購歸因指令（雙向錨）。`mode` 決定 host 如何套用；RAW PASSTHROUGH——
// SDK 不解讀語意，host 依 mode 決定行為。對齊 native `LBCartTrack` / `LBCartTrackMode`。

/**
 * `track.mode`：`'attribute'` → 把 `fields` 原樣寫進自家購物車（`level` 決定掛 line_item / order）；
 * `'token'` → 結帳前 MUST 呼叫 {@link LivebuySDK.reportCartTrack} 回報自家 cart token；
 * `'unsupported'` → 不支援歸因。未知 mode 以 raw 字串直通（future-proof，對齊 native `.unknown(raw)`）。
 */
export type LBCartTrackMode = 'attribute' | 'token' | 'unsupported' | string;

/** 單一歸因欄位。`value` 已由後端組好（raw passthrough，host 原樣套用）。 */
export interface LBCartTrackField {
  key: string;
  value: string;
}

/**
 * addcart 回應的導購歸因指令。`mode` 決定 host 如何套用；`fields` 的 `value` 已由後端組好。
 * `level`（如 `'line_item'` / `'order'`）僅 attribute mode 有意義（缺 → undefined）。
 */
export interface LBCartTrack {
  mode: LBCartTrackMode;
  level?: string;
  fields: LBCartTrackField[];
}

/**
 * Typed convenience accessor (event-payload-typed-accessors-rn-core, parity with iOS/Android
 * `LBCartTrack.attributeFields`). Flattens `track.fields` into a `key → value` map when
 * `track.mode === 'attribute'` and `fields` is non-empty; otherwise returns `undefined`. Pure
 * function — does not mutate `track` or change any bridge / event-dispatch behavior.
 */
export function cartTrackAttributeFields(
  track: LBCartTrack | undefined
): Record<string, string> | undefined {
  if (track?.mode !== 'attribute' || track.fields.length === 0) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const field of track.fields) {
    result[field.key] = field.value;
  }
  return result;
}

export interface LBAddToCartResult {
  goodsNo: string;
  specificationNo: string;
  /** Backend checkout-list id; usable as notifyCheckoutCompleted(orderId). */
  buyNo: string;
  /**
   * 導購歸因指令（addcart-track ④）。後端回應含 `track` 時附帶（`{mode, level?, fields}`）；
   * 缺 → undefined（四欄向後相容）。host 依 `mode` 套用：attribute → 寫 fields；token → 結帳前
   * 呼叫 {@link LivebuySDK.reportCartTrack}。
   */
  track?: LBCartTrack;
}

// MARK: - Widget colors (widget-bridge-color-core)
//
// Web-embed widget colors carried on the root of the `POST /sdk/widget`
// response. Surfaced host-readable through the RN bridge — see
// `LivebuyWidgetCoreProps.onWidgetResponse` in LivebuyPlayer.tsx.
//
// RAW PASSTHROUGH: the SDK does NOT interpret the color semantics (1=black /
// 2=white text; bgcolor "1"=transparent / hex). The host / template decides
// how to render them. STRICTLY SEPARATE from `sdkConfig.theme.primaryColor`
// (the native SDK global theme from `/sdk/config`) — the two are different
// concepts and MUST NOT be merged or cross-converted (CLAUDE.md invariant).
export interface LBWidgetColors {
  /**
   * Web-embed text color. `1` = black, `2` = white. Missing field defaults to
   * `1` (aligned to the native decode default). Raw passthrough — SDK does not
   * interpret.
   */
  widgetColor: number;
  /**
   * Web-embed background color. Mixed Int/String at the backend (Int `1` =
   * transparent, otherwise a hex String) — on the bridge it is ALWAYS a
   * `string | null`: backend Int `1` → `"1"`, hex → raw, missing field → `null`
   * (aligned to the native `decodeStringOrInt` raw passthrough). Raw
   * passthrough — SDK does not interpret.
   */
  widgetBgcolor: string | null;
}

// MARK: - Widget root settings (widget-product-card-bridge-rn)
//
// Everything `LBWidgetColors` carries, plus the carousel product-card display
// mode. A SEPARATE type rather than an extra field on `LBWidgetColors`: that type
// is named for — and documented as — the web-embed colors, and the reference-ui
// layer builds this subtype as an OBJECT LITERAL (currently
// `buildWidgetSettings()` in `react-native-reference-ui`, returning the three keys
// below). Growing `LBWidgetColors` would break that literal — in a package this
// (core-layer) one must not reach into.
//
// RAW PASSTHROUGH throughout, exactly like `LBWidgetColors`. STRICTLY SEPARATE
// from `sdkConfig` / `sdkConfig.theme` (a different endpoint and a different
// concept — CLAUDE.md invariant).
export interface LBWidgetSettings extends LBWidgetColors {
  /**
   * Carousel product-card display mode, from the `/sdk/widget` response root
   * (`product_card`). Backend domain `'below'` / `'inside'` / `'hidden'`; the
   * backend's own default is `'inside'`.
   *
   * `null` means THE BACKEND SENT NOTHING (the linetv branch omits this field) —
   * it is NOT the same as the backend sending `'inside'`, and the SDK
   * deliberately does not collapse the two: no layer of the bridge substitutes
   * the backend default. A host that wants a default applies it itself.
   *
   * Typed `string | null` rather than a union of the three known values: raw
   * passthrough means an unrecognized value reaches the host verbatim rather than
   * being normalized away. The SDK never interprets the semantics.
   */
  productCard: string | null;
}

// MARK: - setLanguage / checkout / flush types (Task 4.14)

export type LBLocaleCode = 'zh-TW' | 'zh-CN' | 'en' | 'ms-MY' | 'id-ID';

export interface LBCheckoutItem {
  productId: string;
  quantity: number;
  /** ISO 4217 currency code; undefined inherits widget setting (iOS only — Android ignores). */
  currency?: string;
  /** Unit price including tax; undefined = not disclosed. */
  price?: number;
  /** Android-only fields (ignored on iOS). */
  goodsGpn?: string;
  sdkTrackCode?: string;
}

export type LBFlushStatus = 'completed' | 'partial' | 'network_unavailable' | 'timeout' | 'no_pending';

export interface LBFlushResult {
  status: LBFlushStatus;
  uploadedCount: number;
  remainingCount: number;
  elapsedMs: number;
}

// MARK: - Power profile (power-profile-adaptation, RN bridge — 第 5 支 parity)

/**
 * Thermal-aware power-profile tier — the stable cross-platform **wire name** of the
 * native `LBPowerProfile` enum (iOS/Android), surfaced by {@link currentPowerProfile}
 * and carried as the `profile` param of the `POWER_PROFILE_CHANGED` unified event.
 * Cool → hot:
 *
 *   • `'full'`         — no down-scaling (device cool / adaptation off / dormant).
 *   • `'reduced'`      — mild reduction.
 *   • `'conservative'` — stronger reduction.
 *   • `'survival'`     — maximum reduction (still NEVER stops playback).
 *
 * The native SDK owns the adaptation; the RN bridge is a read-only passthrough of the
 * wire name (no rawValue / enum crosses the bridge).
 */
export type LBPowerProfile = 'full' | 'reduced' | 'conservative' | 'survival';

// MARK: - Public API

const LivebuySDK = {
  /**
   * Initialize the SDK. Now returns a Promise — under the hood the native
   * side awaits `/sdk/config` per the stale-while-revalidate policy
   * (per `sdk-config` capability). On HMAC failure the promise rejects with
   * `NOT_CONFIGURED`; all other transport failures emit
   * `SDK_CONFIG_LOAD_FAILED` and resolve successfully with the SDK fallback
   * default value.
   */
  configure(options: LBConfigOptions): Promise<void> {
    return LivebuyRNBridge.configure(
      options.apiKey,
      options.secret,
      options.shopId,
      // Explicit null rather than undefined: the RN bridge coerces both, but null signals deliberate omission.
      options.lang ?? null,
      options.user?.displayName ?? null,
      options.user?.avatarUrl ?? null,
      // configure-time external member-id binding (rn-configure-external-user-id-parity): RN
      // previously dropped this typed field; mirrors setUser() + Flutter configure.
      options.user?.externalUserId ?? null,
      options.autoPipOnIntercept ?? true,
      options.apiVersion ?? 1,
      options.configFetchTimeoutMs ?? 5000,
      options.enableConversionAttribution ?? false,
      // power-profile-adaptation (第 5 支 parity): opt-out, default true — 12th positional arg,
      // forwarded to native configure(...enablePowerProfileAdaptation). Native owns the adaptation.
      options.enablePowerProfileAdaptation ?? true,
      // sdk-stat-reporting (stat-reporting-default-on-core): opt-OUT, default true — 13th positional
      // arg, forwarded to native configure(...enableStatReporting). Native owns all /stat sending;
      // RN never sends /stat itself. Pass enableStatReporting: false to opt out.
      options.enableStatReporting ?? true,
      // sdk-stat-endpoint-environment-selection-core (rn-stat-environment-forward-core) +
      // sdk-data-api-environment-selection-core: SDK-wide environment, default 'production' — 14th
      // positional arg, forwarded to native configure(...environment). Native maps the string →
      // LBEnvironment (unknown → production) and selects BOTH the data API base URL and the /stat
      // endpoint; RN never resolves a URL itself.
      options.environment ?? 'production',
    );
  },

  /**
   * Read the current merchant-configured SDKConfig snapshot. Resolves with
   * the in-memory value (cache hit / server response / fallback default).
   * Rejects with `NOT_CONFIGURED` if [configure] has not yet resolved.
   *
   * Cache is owned by the native side — JS receives a read-only snapshot.
   */
  getSdkConfig(): Promise<SDKConfig> {
    return LivebuyRNBridge.getSdkConfig();
  },

  /**
   * Force a fresh `/sdk/config` fetch. Per `sdk-config/spec.md`:
   * - Success + value differs → emits `SDK_CONFIG_REFRESHED` (source: "refresh").
   * - Success + value same → no event.
   * - Failure → emits `SDK_CONFIG_LOAD_FAILED` (source: "refresh"), preserves
   *   prior value (no fallback downgrade).
   *
   * Concurrent calls de-dup with any in-flight cold-start background refresh.
   */
  refreshConfig(): Promise<void> {
    return LivebuyRNBridge.refreshConfig();
  },

  setUser(user: LBUser): void {
    LivebuyRNBridge.setUser({
      displayName: user.displayName,
      avatarUrl: user.avatarUrl ?? null,
      externalUserId: user.externalUserId ?? null,
    });
  },

  clearUser(): void {
    LivebuyRNBridge.clearUser();
  },

  // MARK: - Conversion attribution (opt-in, conversion-attribution-context)

  /**
   * Capture a Meta-ad deep link so the native SDK can derive `fbc` (the ad-click
   * id). Pass the launch / universal-link URL; the SDK extracts `fbclid`, formats
   * `fb.1.<ms>.<fbclid>` and persists it. No-op when conversion attribution is
   * disabled or the URL carries no `fbclid` (an absent `fbclid` does NOT overwrite
   * an existing `fbc`). The SDK does not intercept deep links — only the host
   * receives them.
   */
  captureAdClick(url: string): void {
    LivebuyRNBridge.captureAdClick(url);
  },

  /**
   * Feed an already-extracted `fbclid` directly (host parsed the deep link
   * itself). Persists a formatted `fbc`. No-op when disabled or blank.
   */
  setFbclid(fbclid: string): void {
    LivebuyRNBridge.setFbclid(fbclid);
  },

  /**
   * Set (or clear, with `null`) the `referer` source-page string injected into
   * requests. In-memory; update per page. No-op when disabled.
   */
  setReferer(referer: string | null): void {
    LivebuyRNBridge.setReferer(referer ?? null);
  },

  /**
   * Erase attribution identifiers (`fbc` / `referer` / `fbp`) for a host privacy /
   * erasure request. A still-enabled subsystem mints a fresh `fbp` on next need.
   */
  clearAttributionContext(): void {
    LivebuyRNBridge.clearAttributionContext();
  },

  // MARK: - Stat reporting (opt-in, sdk-stat-reporting)

  /**
   * Erase the persisted SDK-native `/stat` state (the `video_people` per-day
   * dedupe set + in-memory retention) for a host privacy / erasure request.
   * Forwarded to the native `clearStatContext()` (iOS `Livebuy.clearStatContext()`
   * / Android `LivebuySDK.clearStatContext()`); the JS layer holds no `/stat`
   * state of its own. Mirrors {@link clearAttributionContext}.
   */
  clearStatContext(): void {
    LivebuyRNBridge.clearStatContext();
  },

  /**
   * Read the current `fbc` (Option C: hosts running their own Facebook SDK can
   * forward it). Resolves `null` when disabled or no ad click captured.
   */
  currentFbc(): Promise<string | null> {
    return LivebuyRNBridge.currentFbc();
  },

  /**
   * Read the current `fbp` (Option C). Mints one on first read when enabled.
   * Resolves `null` when conversion attribution is disabled.
   */
  currentFbp(): Promise<string | null> {
    return LivebuyRNBridge.currentFbp();
  },

  // MARK: - Power profile (power-profile-adaptation, 第 5 支 parity)

  /**
   * Read the current thermal power-profile tier (`power-profile-adaptation`). Late
   * subscribers (e.g. a reference-ui animation throttle) can pull the current tier
   * here; the `POWER_PROFILE_CHANGED` unified event pushes changes. Resolves the
   * native `wireName` (`'full'` / `'reduced'` / `'conservative'` / `'survival'`).
   *
   * NEVER `null` (unlike {@link currentFbc}): the native getter returns `full` when
   * adaptation is disabled / the subsystem is dormant / the thermal API is
   * unavailable (Android API < 29). Mirrors iOS `Livebuy.currentPowerProfile` /
   * Android `LivebuySDK.currentPowerProfile()`.
   */
  currentPowerProfile(): Promise<LBPowerProfile> {
    return LivebuyRNBridge.currentPowerProfile();
  },

  /**
   * Read-only auth-state query (auth-bind-session-ergonomics). Resolves `true` when a
   * login session token is present (anchored on the token set by {@link login} /
   * {@link bindSession}), `false` otherwise. {@link clearUser} flips it back to `false`;
   * {@link setUser} / {@link setGuestNickname} do NOT change it (naming yourself as a
   * guest is not authenticating). Use this for host re-bridge or login-gate gating
   * instead of mirroring a host-side flag.
   */
  isLoggedIn(): Promise<boolean> {
    return LivebuyRNBridge.isLoggedIn();
  },

  /**
   * Read-only bound-identity query (bind-session-transition-idempotent-rn-core). Resolves the
   * `externalUserId` currently bound via {@link login} / {@link bindSession}, or `null` when
   * unbound (never logged in, or after {@link clearUser}). Companion to {@link isLoggedIn};
   * transitions (idempotent re-bind of the same memberId, or clearUser+login when switching
   * memberId) are handled entirely natively — this bridge is a plain forwarding query.
   */
  boundMemberId(): Promise<string | null> {
    return LivebuyRNBridge.boundMemberId();
  },

  /**
   * Set the GUEST's 留言暱稱 WITHOUT logging in (guest-nickname capability). Use this — NOT
   * {@link setUser} — for the 設定暱稱 flow when the user is only naming themselves to comment,
   * not authenticating. Unlike setUser, the user stays a GUEST, no pending AUTH_REQUIRED action
   * is replayed, and the dispatched `AUTH_STATE_CHANGED` carries a `guest` state (not
   * `logged_in`). The name is persisted natively and surfaces via the chat display name. Blank
   * names are a no-op.
   */
  setGuestNickname(name: string): void {
    LivebuyRNBridge.setGuestNickname(name);
  },

  /**
   * Log in a member to obtain a login session token (login-session-token-core).
   * `memberId` is required; `memberName` optional. No token is sent on the
   * request; the resulting session token is stored natively (JS never sees the
   * raw token). Rejects with a login-specific error (native `loginFailed`,
   * surfaced as serverError) on inner `code != 200`. clearUser() clears it;
   * setUser() does NOT.
   */
  login(memberId: string, memberName?: string): Promise<void> {
    return LivebuyRNBridge.login(memberId, memberName ?? null);
  },

  /**
   * One-line member login (auth-bind-session-ergonomics). The THIRD identity entry
   * point alongside {@link login} + {@link setUser} — it logs in AND sets the member
   * identity in a single call, so an authenticated member never lingers as
   * `Guest_XXXX` in chat from a forgotten setUser(). Identity is set ONLY when login
   * succeeds; on failure it rejects and leaves no identity (no half-bound state). When
   * `memberName` is omitted the native side falls back to the guest display name (never
   * a blank name). To switch accounts call {@link clearUser} first. `memberId` is
   * required; `memberName` / `avatarUrl` optional. The session token is stored natively
   * (JS never sees the raw token); clearUser() clears it, setUser() does NOT.
   */
  bindSession(
    memberId: string,
    memberName?: string,
    avatarUrl?: string,
  ): Promise<void> {
    return LivebuyRNBridge.bindSession(
      memberId,
      memberName ?? null,
      avatarUrl ?? null,
    );
  },

  setLanguage(lang: LBLocaleCode): void {
    LivebuyRNBridge.setLanguage(lang);
  },

  /**
   * Open a URL in an in-app browser (iOS `SFSafariViewController` / Android
   * Chrome Custom Tabs) without ejecting to the system browser. A navigation
   * tool for the Default UI template (`livebuy-react-native-ui`) to handle
   * `diversion == 1` products when the host has not intercepted `productTap`.
   *
   * Headless contract: the SDK core never calls this itself. Empty / blank
   * URLs are a safe no-op here; the native side additionally no-ops on
   * malformed (non-empty) URLs. Per `rn-inapp-browser` capability.
   */
  openInAppBrowser(url: string): void {
    if (!url || url.trim() === '') return;
    LivebuyRNBridge.openInAppBrowser(url);
  },

  notifyCheckoutCompleted(
    orderId: string,
    sdkTrackCodes: string[],
    items?: LBCheckoutItem[],
  ): void {
    LivebuyRNBridge.notifyCheckoutCompleted(orderId, sdkTrackCodes, items ?? null);
  },

  flushPendingEvents(): Promise<LBFlushResult> {
    return LivebuyRNBridge.flushPendingEvents();
  },

  /**
   * Query whether a live broadcast is currently in progress for widget `id`.
   * `id` is required; `ty` is OPTIONAL and OMITTED by default — `fetchLatestLive(id)`
   * sends no `ty` so the backend returns the current `live_status == 1` live. Pass
   * `ty` only for specific other needs. Returns the live item when one exists, or
   * `null` when `data.video` is null. Rejects with `NOT_CONFIGURED` if [configure]
   * has not yet resolved.
   */
  fetchLatestLive(id: string, ty?: string): Promise<LBVideoItem | null> {
    return LivebuyRNBridge.fetchLatestLive(id, ty ?? null);
  },

  /**
   * Headless one-shot fetch of widget content (`POST /sdk/widget`, carousel /
   * grid page) for the RN drop-in widget container — without instantiating the
   * native widget view. Resolves with a raw snake_case wire map: `videos`
   * (camelCase `LBVideoItem` objects), `current_page`, `last_page` — exactly the
   * keys `react-native-ui` `decodeWidgetSnapshot` reads — plus the web-embed
   * colors `widget_color` (number) and `widget_bgcolor` (string; ABSENT when the
   * backend omits it), plus `product_card` (string; likewise
   * ABSENT when the backend omits it — NEVER filled in with the backend default
   * `'inside'`, see {@link LBWidgetSettings.productCard}). Those three root keys
   * are what the reference-ui container composes into one {@link LBWidgetSettings}
   * root-settings snapshot and forwards via `handleWidgetColors` (the view-model
   * method name predates the widened payload and is unchanged). The SDK does NO
   * semantic transform here (raw passthrough). `shopId` required; `page`
   * defaults to 1. Rejects with
   * `NOT_CONFIGURED` if [configure] has not yet resolved. Parity with the
   * `fetchLatestLive` one-shot precedent for `/sdk/widget/live`.
   *
   * NOTE: `mode` (carousel / grid) is NOT in this payload — the container knows
   * its own mode and injects it when forwarding to `handleWidgetSnapshot`.
   */
  fetchWidget(shopId: string, page: number = 1): Promise<Record<string, unknown>> {
    return LivebuyRNBridge.fetchWidget(shopId, page);
  },

  /**
   * Unified Tier 2 add-to-cart (cart-add-tier2-unify). The native SDK calls
   * `POST /sdk/video/addcart` and, on success, dispatches `CART_ADD_REQUEST` as a
   * notification (no callback) carrying `buy_no` / `track` / `sdk_track_code` /
   * `video_id` so the host adds the item to its own cart and (best-effort) reports
   * the cart token via {@link LivebuySDK.reportCartTrack}. Resolves with the result.
   *
   * Rejection mapping: a 30s 重複加購 dedupe-hit rejects with code
   * `cart_add_deduplicated` → typed `{ type: 'cartAddDeduplicated' }` (host treats as
   *「已加入購物車」). An empty-`buy_no` popup-login boundary rejects with serverError
   * code `401` → `{ type: 'serverError', code: 401 }` (needs-login). Other numeric
   * codes map to `serverError`; non-numeric rejections keep their raw shape.
   */
  addToCart(options: LBAddToCartOptions): Promise<LBAddToCartResult> {
    return LivebuyRNBridge.addToCart(options).catch((e: unknown) => {
      const raw = e as { code?: string; message?: string } | null;
      // cart-add-tier2-unify: dedupe-hit reject code → typed cartAddDeduplicated.
      if (raw?.code === 'cart_add_deduplicated') {
        const typed: LBError = { type: 'cartAddDeduplicated' };
        throw typed;
      }
      // The native bridge rejects a core `serverError` with the inner code as the reject `code`
      // (e.g. "401" for an empty buy_no); map it to the documented typed `LBError` so the
      // requester can branch needs-login (401) vs a genuine failure (cart-needs-login-vs-failure).
      const code = Number(raw?.code);
      if (Number.isInteger(code)) {
        const typed: LBError = {
          type: 'serverError',
          code,
          message: raw?.message ?? '',
        };
        throw typed;
      }
      throw e;
    });
  },

  /**
   * Report a cart token for a `track.mode === 'token'` platform (addcart-track ④,
   * `POST /sdk/video/addcart/track`). Call BEFORE checkout when an {@link
   * LBAddToCartResult.track} (or CART_ADD_REQUEST `track`) carries `mode === 'token'`;
   * `trackId` is the host's own cart token, `buyNo` the prior add-to-cart result's
   * buy_no. Conditional token (logged in → injected; guest → omitted). Delegates to
   * native `reportCartTrack(shopId:buyNo:trackId:)` (no JS-built HTTP). Resolves on
   * body `code==200`; rejects with serverError on cross-tenant / failure.
   */
  reportCartTrack(shopId: string, buyNo: string, trackId: string): Promise<void> {
    return LivebuyRNBridge.reportCartTrack(shopId, buyNo, trackId);
  },

  /**
   * Toggle restock-arrival tracking for a product (goods-await-notice §5.2,
   * `POST /sdk/goods/await`). Login-required; `enabled=true` tracks, `false`
   * cancels. On success the native side dispatches AWAIT_GOODS_CHANGED.
   * Independent of [setNoticeGoods] (separate backend row — not mutually
   * exclusive). Rejects with serverError(401) when not logged in.
   */
  setAwaitGoods(goodsGpn: string, enabled: boolean): Promise<void> {
    return LivebuyRNBridge.setAwaitGoods(goodsGpn, enabled);
  },

  /**
   * Toggle restock-notice for a product (goods-await-notice §5.2,
   * `POST /sdk/goods/notice`). Same wire/login contract as [setAwaitGoods];
   * on success dispatches NOTICE_GOODS_CHANGED. Independent of [setAwaitGoods].
   */
  setNoticeGoods(goodsGpn: string, enabled: boolean): Promise<void> {
    return LivebuyRNBridge.setNoticeGoods(goodsGpn, enabled);
  },
};

export default LivebuySDK;
