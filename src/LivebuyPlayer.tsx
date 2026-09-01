import React, {
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from 'react';
import {
  requireNativeComponent,
  UIManager,
  findNodeHandle,
  NativeEventEmitter,
  NativeModules,
  Platform,
  StyleSheet,
  ViewStyle,
} from 'react-native';

import type {
  LBProduct,
  LBPollResponse,
  LBPlayerState,
  LBError,
  LBWinner,
  LBAwardClaimInput,
  LBWidgetColors,
  LBWidgetSettings,
  LBPlayerChannelInfo,
  LBActiveEvent,
  LBPlaybackProgress,
} from './LivebuySDK';
import { mapPlayerChannelInfo, mapPlaybackProgress } from './LivebuySDK';

// MARK: - LivebuyPlayerCore (headless RN bridge)
//
// decouple-ui-from-logic: this RN component is a thin pass-through to the
// native `LivebuyPlayerView` (iOS LivebuyPlayerViewController / Android
// LivebuyPlayerView). Per
// `openspec/changes/decouple-ui-from-logic/specs/component-contracts/spec.md`
// §Player 元件契約 + §四端命名映射.
//
// Two event streams flow through the bridge:
//   1. Per-view "deprecated" callbacks (LBPlayerStateChange / LBProductTap /
//      LBPollReceived / LBError) — exposed as React-style props on this
//      component for backward compat.
//   2. The full 38-event SDK surface (including the 19 new decouple-ui events
//      such as CHAT_TOGGLE / DISMISS_REQUEST / PRODUCT_PANEL_TOGGLE) — these
//      flow through a single `onSdkEvent` channel and are consumed via the
//      `registerListener(...)` helper from `LivebuyEvents.ts`. Host apps
//      should subscribe at the SDK level (once per session), not per-view.

// MARK: - Minimal bridge types for simulate* parameters (expand-simulate-bridge-parity)

/** Reduced LBSpec shape — only fields available at the bridge layer. */
export interface LBBridgeSpec {
  id: string;
  name: string;
  priceShow?: string;
}

/** Reduced LBHotItem shape.
 *  Note: `watchNum` is NOT present (not returned by the API `hot[]` response
 *  per SDK invariant — see CLAUDE.md). Pass duration as a formatted string,
 *  e.g. "38:36". */
export interface LBBridgeHotItem {
  id: string;
  title: string;
  cover: string;
  /** Formatted duration string, e.g. "38:36". */
  duration?: string;
}

/** Reduced LBVideoItem shape for Widget simulate* calls. */
export interface LBBridgeVideoItem {
  id: string;
  title: string;
  cover: string;
  liveurl?: string;
  playbackurl?: string;
  liveStatus?: number;
}

// MARK: - Sub-component ref interfaces (expand-simulate-bridge-parity)

export interface ChatViewRef {
  /** Simulate user submitting a chat message. Gated by SDK `canSend` state. */
  simulateSendTap(text: string, eventId?: number): void;
  /** Simulate user scrolling to top to load older chat history. */
  simulateLoadHistoryTap(): void;
  /** Simulate user tapping "join event" on an event-begin chat row. */
  simulateEventJoinTap(eid: number, keyword: string): void;
}

export interface ProductOverlayRef {
  /** Simulate user tapping a product anywhere (push card / floating banner). */
  simulateProductTap(product: LBProduct): void;
  /** Simulate user explicitly dismissing the push card (× button). */
  simulatePushCardDismiss(): void;
  /** Simulate toggling the product list panel open / closed. */
  simulatePanelToggle(): void;
}

export interface ProductListPanelRef {
  /** Simulate user tapping a product in the list. */
  simulateProductTap(product: LBProduct): void;
  /** Simulate user tapping add-to-cart for a product with optional spec. */
  simulateAddCart(product: LBProduct, spec?: LBBridgeSpec): void;
  /** Simulate user tapping restock-notification for a sold-out product. */
  simulateRestockNotice(product: LBProduct): void;
}

export interface OperationPanelRef {
  simulateGoodsTap(): void;
  simulateChatToggleTap(): void;
  simulateLikeTap(): void;
  simulateShareTap(): void;
  simulateSubtitleToggleTap(): void;
  simulateServiceLinkTap(): void;
  simulateMoreTap(): void;
  simulateGuestNameEditTap(): void;
  simulateSkipStartTap(): void;
  simulateBackToLiveTap(): void;
}

export interface VideoInfoPanelRef {
  simulateSubscribeTap(): void;
  simulateServiceLinkTap(): void;
  simulateShopTap(): void;
  simulateDismiss(): void;
  /** @param tab `"info"` (default) or `"notice"`. Guarded by SDK: notice tab
   *  is a no-op when no notice content is available. */
  simulateTabChange(tab: 'info' | 'notice'): void;
}

export interface EndScreenRef {
  simulateCancelTap(): void;
  /** Simulate user tapping a hot-recommendation card.
   *  Note: `watchNum` is not available at bridge level — omit or pass 0. */
  simulateHotItemTap(item: LBBridgeHotItem): void;
}

// MARK: - Widget ref interfaces (expand-simulate-bridge-parity Tier 2)

export interface LivebuyWidgetCoreRef {
  simulateCardTap(video: LBBridgeVideoItem): void;
  simulateClose(): void;
  simulateCardVisibilityChanged(video: LBBridgeVideoItem, visible: boolean): void;
}

export interface LivebuyFloatingWidgetRef {
  simulateClose(): void;
  simulateTap(): void;
}

export interface LivebuyPlayerCoreRef {
  load(videoId: string): void;
  unload(): void;
  play(): void;
  pause(): void;
  setMuted(muted: boolean): void;
  /**
   * Replay seek (absolute position, seconds).
   *
   * rn-vod-playback-progress-core (MODIFIED): now gated client-side by
   * {@link vodScrubAllowed}, fed by the latest known `liveStatus` (from
   * `onChannelChange`) and `duration` (from `onPlaybackProgressChange`) — a
   * disallowed scrub (actively live, or unknown/no scrubbable duration yet)
   * is a silent no-op that never reaches native. This is belt-and-braces:
   * native keeps gating independently (iOS `vodScrubAllowed`, Android's own
   * gate) and is the source of truth.
   */
  seek(seconds: number): void;
  /**
   * Relative seek by `delta` seconds (positive = forward, negative =
   * backward) (rn-vod-playback-progress-core). Gated the same way as
   * {@link seek} — see its JSDoc.
   */
  seekBy(delta: number): void;
  /**
   * Toggle play ⇄ pause (rn-vod-playback-progress-core). Not gated by
   * {@link vodScrubAllowed} — play/pause is not a VOD-scrub concern.
   */
  togglePlayPause(): void;
  /** Send chat. `eventId` is forwarded as `event_id` to the server for
   *  event-begin chat replies (per spec §LBPushMsg event 欄位). */
  sendChat(message: string, eventId?: number): void;
  skipStart(): void;
  cancelAutoNext(): void;
  requestEventJoin(eid: number, keyword: string): void;
  /**
   * Public core dispatch seam for the「查看購物車」CTA (view-cart-event-core).
   * Emits the notification `VIEW_CART` (non-navigation, no auto-PiP). Pass the
   * tapped product's id from the 商品詳情頁 cart CTA; omit it for the 商品列表底部
   * cart CTA so the native seam omits the `product_id` key. `video_id` is
   * resolved natively. Mirrors iOS/Android `Player.requestViewCart(productId)`.
   */
  requestViewCart(productId?: string): void;
  /**
   * 直播抽獎「停留補登」上報（fire-and-forget）。參加抽獎的第二入口：達到停留門檻
   * 後補登參加票。`eventId` 須 >0（否則 native no-op）；`stayTime` 為 host 計算的
   * 已觀看秒數（選填）。SDK 自動帶 video_id / name / guest_id / token。端點恆 200，
   * 中獎結果走 `WIN_RECEIVED`。對應 native `reportEventStay(eventId:stayTime:)`。
   */
  reportEventStay(eventId: number, stayTime?: number): void;
  /**
   * Claim a won award. The template calls this after the host confirms
   * contact info in `LBWinSheet`. When not intercepted, the SDK fires the
   * `POST /sdk/video/claim` request natively and reports the outcome through
   * `AWARD_CLAIM_RESULT`. `contact.email` is required (trimmed) for both
   * `product` and `discount` award types; omit `contact` only when a prior
   * interceptor has already supplied it.
   *
   * On success `AWARD_CLAIM_RESULT` carries the FULL award + activity info
   * (`award_name` / `award_image_url` / `award_stock` / `award_code` +
   * `award_expiration` [discount-only] / `event_id` / `event_title` /
   * `winner_id`) so the host can drive the follow-up itself — open its own award
   * page, render an award card. The SDK does NOT navigate and renders nothing;
   * a **discount** award is never added to a cart.
   *
   * A **product** award is the one deliberate exception
   * (`award-product-auto-cart`): native core auto-adds it to the backend
   * checkout list, so the host gets TWO notifications in order —
   * `AWARD_CLAIM_RESULT` first (dispatched immediately on claim success; its
   * `status` stays `'claimed'` and is never rewritten by a later add-to-cart
   * failure), then `CART_ADD_REQUEST` once addcart succeeds, carrying
   * `award_winner_id` (=== the claim event's `winner_id`). Do NOT add the award
   * to the cart again from the host — that would double-add. If addcart fails
   * the SDK fires NO event at all, so receiving `AWARD_CLAIM_RESULT`
   * (`status='claimed'`, `award_type='product'`) WITHOUT a matching
   * `CART_ADD_REQUEST` means the award did not reach the checkout list.
   *
   * On failure (including the missing-`email` fail-fast, where no API call is
   * made at all) only the in-memory keys `status` / `award_type` / `winner_id`
   * (+ `event_title` when non-empty) are present — never any API-sourced field.
   * See `LBAwardClaimResultParams` for the full field contract and
   * `LBCartAddRequestParams.award_winner_id` for the award-cart marker.
   */
  requestAwardClaim(winner: LBWinner, contact?: LBAwardClaimInput): void;
  /**
   * Read-only snapshot of the current in-progress live events (直播抽獎「進行中活動」),
   * from the latest `POST /sdk/video/goods` `event[]` cached natively
   * (active-event-accessor-rn-core). Resolves an `LBActiveEvent[]` (each
   * `{ id, title, keyword?, duration, surplus, award }` — NO `stayTime`).
   *
   * Purpose: lets a「中途進場」host — one that installed its listener AFTER an
   * event started and therefore missed the fire-once `ACTIVE_EVENT_STARTED`
   * notification — actively pull the current active events, closing the
   * push-event late-subscriber blind spot. Read-only, no side effects, no network.
   *
   * Resolves `[]` (never rejects) when there is no active event, or when the
   * view is not mounted (`findNodeHandle` returns null). Mirrors iOS/Android
   * `activeEvents()`. Because native↔JS can't return synchronously, this is a
   * Promise-returning native module method (NOT a fire-and-forget view command).
   */
  activeEvents(): Promise<LBActiveEvent[]>;
  /**
   * checkName-gated verified nickname set (guest-nickname-checkname-on-set-rn),
   * RN bridge parity of core's `setGuestNicknameVerified` (iOS
   * `LivebuyPlayerViewController.setGuestNicknameVerified(_:)` / Android
   * `LivebuyPlayerView.setGuestNicknameVerified`). Before committing, native
   * validates `name` against the CURRENT video via the existing `ChatClient.checkName`
   * (`POST /sdk/video/checkname`) — only on success does it persist + broadcast
   * `AUTH_STATE_CHANGED`. This is a **parallel** entry to the existing fire-and-forget,
   * unvalidated {@link LivebuySDK.setGuestNickname} — calling this does NOT change
   * that method's signature or behavior.
   *
   * **Resolve ⟺ the nickname was committed** (guest-nickname-verified-fails-loudly-rn,
   * RN parity of core's「未 throw ⟺ 已提交」). Every path that did NOT complete the
   * commit rejects — including the RN-only bridging layers core cannot see — so a
   * caller may treat resolve as success (dismiss the nickname modal, continue the
   * follow-up flow) with no further checks.
   *
   * One success outcome plus four reject codes, by `error.code`:
   *   - **Success** (name accepted): Promise resolves. Native has already persisted
   *     the nickname and broadcast `AUTH_STATE_CHANGED(state: "guest", display_name)`.
   *   - **Taken** (checkName 403): Promise rejects with `error.code === 'guestNameTaken'`
   *     (same wire spelling already used by the existing `LBError` chat-error event
   *     channel for this identical underlying core error — see `emitError`'s
   *     `type: "guestNameTaken"`). Native does NOT persist / broadcast.
   *   - **Pre-flight failure — the request was NEVER SENT**: Promise rejects with
   *     `error.code === '`{@link NICKNAME_SET_PRECONDITION_FAILED}`'`. Covers a
   *     trimmed-empty `name`, a player that has not `load()`ed a video yet, and every
   *     「couldn't reach a player」bridging case (`findNodeHandle` returns null, the
   *     native reactTag resolves to no view / a wrong type, the resolved view has
   *     no core player instance yet, or Android cannot obtain its `UIManager`).
   *     ONE code for all of them: to the caller the
   *     REMEDY is identical — no checkName request, no server ruling, nothing
   *     persisted or broadcast, and retrying blind will not help (fix the argument or
   *     the timing first). NOT because every condition is directly observable: only
   *     the blank name is (it is the argument just passed in); `findNodeHandle`
   *     returning null is only a proxy away (the host's ref is the imperative handle,
   *     not the native ref), and the native-side cases (unresolvable reactTag, no
   *     `playerVC` yet, no Android `UIManager`) are not observable at all.
   *     Which one it was is in the rejection `message` (free text, not contract).
   *   - **SDK not configured**: Promise rejects with `error.code === 'NOT_CONFIGURED'`
   *     — the spelling this bridge already uses for the same underlying error on every
   *     other Promise method, NOT a new lowerCamel synonym.
   *   - **Other error** (network / server / anything non-403): Promise rejects with
   *     `error.code === 'LB_ERROR'` (this file's existing dominant fallback reject
   *     code) — MUST be distinguishable from the taken case above. Native does NOT
   *     persist / broadcast.
   *
   * The three categories are deliberately separable: `nicknameSetPreconditionFailed`
   * / `NOT_CONFIGURED` = never sent; `guestNameTaken` = sent and refused;
   * `LB_ERROR` = sent, outcome unknown (retryable).
   *
   * Promise-returning native module method keyed by reactTag (NOT
   * `dispatchViewManagerCommand`, which is fire-and-forget) — same bridge shape as
   * {@link activeEvents}. Note {@link activeEvents} keeps resolving `[]` for a missing
   * view on purpose: it is a READ (an empty snapshot is a truthful answer), whereas
   * setting a nickname is a WRITE (a write that did not happen must not report success).
   */
  setGuestNicknameVerified(name: string): Promise<void>;
  /**
   * Forward the host Android Activity's `onPictureInPictureModeChanged(...)`
   * confirmation into the wrapped native player view
   * (rn-android-pip-mode-forward-core).
   *
   * **Android-only / View-mode host responsibility.** Android delivers the PiP
   * entry/exit confirmation callback ONLY to the Activity that owns it — an
   * RN-embedded native `LivebuyPlayerView` cannot observe
   * `Activity.onPictureInPictureModeChanged`. Call this from your host
   * `Activity.onPictureInPictureModeChanged` override (after `super`) so
   * PiP-dependent SDK behaviour works:
   *   - watch-time (`person_time` / `person_duration`, sdk-stat-reporting) stops
   *     during PiP (PiP is not foreground watching);
   *   - the IVS live seek-bar / native control chrome stays locked in PiP.
   *
   * **iOS: no-op.** iOS drives PiP via `AVPictureInPictureController`'s delegate,
   * which reaches the SDK regardless of the host container, so there is no
   * host-forward gap. On non-Android platforms this returns immediately without
   * dispatching the command (the iOS `LivebuyPlayerViewManager` does not register
   * it; dispatching an unregistered command on iOS would be an RN "Unsupported
   * command").
   */
  notifyPictureInPictureModeChanged(isInPictureInPictureMode: boolean): void;
  /** v1.x no-op stub per contract — emits a console.warn. */
  minimize(): void;
  /** v1.x no-op stub per contract. */
  expand(): void;
  // Sub-component simulate* refs (expand-simulate-bridge-parity)
  chatView: ChatViewRef;
  productOverlay: ProductOverlayRef;
  productListPanel: ProductListPanelRef;
  operationPanel: OperationPanelRef;
  videoInfoPanel: VideoInfoPanelRef;
  endScreen: EndScreenRef;
}

export interface LivebuyPlayerCoreProps {
  videoId: string;
  showChat?: boolean;
  showProducts?: boolean;
  enablePiP?: boolean;
  autoDismissDelay?: number;

  // Deprecated per-view callbacks — v2.0 removal.
  // For the full event surface (chatToggle / productPanelToggle / dismissRequest
  // / etc.), use `registerListener(...)` from `livebuy-react-native` once at
  // SDK level — events arrive via the `onSdkEvent` channel keyed by
  // `eventName`.
  onStateChange?: (state: LBPlayerState) => void;
  onPollReceived?: (response: LBPollResponse) => void;
  onError?: (error: LBError) => void;
  onProductTap?: (product: LBProduct) => void;

  /**
   * upcoming-intro-core-rn — channel-info forward. Fired when the native player
   * loads / changes a channel, carrying the LIGHTWEIGHT {@link LBPlayerChannelInfo}
   * projection (`publishAt` / `cover` / `start` / `liveStatus` / `title` /
   * `serviceLink` — the last one added by dropin-service-link-default-browser-core-rn).
   * The host feeds these into the `react-native-ui` template's upcoming view-model
   * (the player state `"awaitingLive"` alone cannot carry the channel fields).
   * Purely additive — leaving this unset is an inert no-op; the existing 4
   * callbacks are unaffected.
   */
  onChannelChange?: (info: LBPlayerChannelInfo) => void;

  /**
   * rn-vod-playback-progress-core — dedicated VOD playback-progress channel
   * forward. Fired whenever the native player view (iOS
   * `LivebuyPlayerViewController` / Android `LivebuyPlayerView`) publishes a
   * new `LBPlaybackProgress` snapshot on its own `onPlaybackProgressChange`
   * (component-contracts §Player VOD playback-progress 頻道與控制出口 /
   * §Player（Android）VOD playback-progress 頻道 — isReplay slice parity). The
   * host feeds these into the `react-native-ui` template's VOD progress-bar
   * view-model (not built by this change). Purely additive — leaving this
   * unset is an inert no-op; the existing callbacks are unaffected.
   */
  onPlaybackProgressChange?: (progress: LBPlaybackProgress) => void;

  style?: ViewStyle;
}

/**
 * Forward the host Android Activity's `onPictureInPictureModeChanged(...)`
 * confirmation to the wrapped native `LivebuyPlayerView`
 * (rn-android-pip-mode-forward-core).
 *
 * **Android-only.** Android delivers the PiP entry/exit confirmation callback
 * ONLY to the Activity that owns it — an RN-embedded native `LivebuyPlayerView`
 * cannot observe `Activity.onPictureInPictureModeChanged`. On non-Android
 * platforms this is a no-op that MUST NOT dispatch the command: iOS drives PiP
 * via `AVPictureInPictureController`'s delegate (reaches the SDK regardless of
 * the host container, so there is no host-forward gap), and the iOS RN
 * `LivebuyPlayerViewManager` does NOT register this command — dispatching it on
 * iOS would be an RN "Unsupported command". Mirrors the Flutter Dart platform
 * guard (`defaultTargetPlatform != TargetPlatform.android`).
 *
 * Exported for testing — like `mapWidgetColors`, the native `.kt`/`.swift`
 * bridge does not compile in this repo, so this pure guard is the acceptance gate.
 */
export function dispatchNotifyPipModeChanged(
  platformOS: string,
  dispatch: (cmd: string, args: unknown[]) => void,
  isInPictureInPictureMode: boolean,
): void {
  if (platformOS !== 'android') return;
  dispatch('notifyPictureInPictureModeChanged', [isInPictureInPictureMode]);
}

/**
 * rn-vod-playback-progress-core — pure VOD-scrub gate, mirrors iOS
 * `vodScrubAllowed(liveStatus:duration:)` (component-contracts §Player VOD
 * playback-progress 頻道與控制出口): `liveStatus === 1` (actively live) → NOT
 * scrubbable; a known channel that is VOD/replay (`liveStatus === 3` or
 * `liveStatus === 0`) with a finite positive `duration` → scrubbable;
 * everything else (unknown channel, live with no scrubbable timeline,
 * `duration <= 0`) → NOT scrubbable.
 *
 * Exported for testing — the native `.swift`/`.kt` bridge does not compile in
 * this repo, so this pure gate is the JS-side acceptance gate, same pattern as
 * `dispatchNotifyPipModeChanged`.
 */
export function vodScrubAllowed(
  liveStatus: number | null | undefined,
  duration: number | null | undefined,
): boolean {
  if (liveStatus == null || duration == null) return false;
  if (liveStatus === 1) return false;
  if ((liveStatus === 3 || liveStatus === 0) && duration > 0) return true;
  return false;
}

/**
 * rn-vod-playback-progress-core — dispatch the `seek` command gated by
 * {@link vodScrubAllowed}. This is a JS-side belt-and-braces early return, NOT
 * a replacement for native gating: both iOS (`vodScrubAllowed`) and Android
 * (`channel?.liveStatus != 3`) keep gating independently once a dispatch
 * reaches them; this only avoids a pointless bridge round-trip for an
 * obviously disallowed scrub. `liveStatus`/`duration` are the caller's latest
 * known snapshot (from `LBPlayerChannelInfo` / `LBPlaybackProgressChange`) —
 * before either has arrived (or for a genuinely live stream, which never gets
 * a progress event), the gate defaults closed.
 *
 * Exported for testing — same pattern as `dispatchNotifyPipModeChanged`.
 */
export function dispatchSeekIfAllowed(
  dispatch: (cmd: string, args: unknown[]) => void,
  liveStatus: number | null | undefined,
  duration: number | null | undefined,
  seconds: number,
): void {
  if (!vodScrubAllowed(liveStatus, duration)) return;
  dispatch('seek', [seconds]);
}

/**
 * rn-vod-playback-progress-core — dispatch the `seekBy` command gated by
 * {@link vodScrubAllowed}. See {@link dispatchSeekIfAllowed} for the full
 * rationale (identical gate, different command/arg).
 */
export function dispatchSeekByIfAllowed(
  dispatch: (cmd: string, args: unknown[]) => void,
  liveStatus: number | null | undefined,
  duration: number | null | undefined,
  delta: number,
): void {
  if (!vodScrubAllowed(liveStatus, duration)) return;
  dispatch('seekBy', [delta]);
}

/**
 * guest-nickname-verified-fails-loudly-rn — the single authoritative wire spelling
 * for「前置條件不成立，checkName 根本沒送出」on the RN Promise-reject channel.
 *
 * Mirrors core's `LBError.nicknameSetPreconditionFailed` (iOS) /
 * `LBError.NicknameSetPreconditionFailed` (Android), and ALSO covers the RN-only
 * bridging layers that core cannot see (JS ref not mounted / reactTag resolves to
 * no view / the resolved view has no core player instance yet / Android cannot
 * obtain its `UIManager`). One code for all of
 * them ON PURPOSE: to every caller the contract is identical — nothing was sent, the
 * server never ruled on this name, nothing was persisted or broadcast. Which layer
 * stopped the call is diagnostic detail and belongs in the rejection MESSAGE (free
 * text, not contract), never in the `code`.
 *
 * Exported so hosts — and `livebuy-react-native-reference-ui` — compare against one
 * source of truth instead of re-typing the string.
 */
export const NICKNAME_SET_PRECONDITION_FAILED = 'nicknameSetPreconditionFailed';

/**
 * guest-nickname-verified-fails-loudly-rn — build the rejection a JS-side pre-flight
 * guard hands back, in the SAME shape a native reject produces (an `Error` carrying
 * a `code`), so a caller cannot tell whether JS or native stopped the call.
 */
export function nicknameSetPreconditionRejection(message: string): Promise<never> {
  return Promise.reject(
    Object.assign(new Error(message), { code: NICKNAME_SET_PRECONDITION_FAILED }),
  );
}

/**
 * guest-nickname-checkname-on-set-rn — pure pre-flight guard for the
 * `setGuestNicknameVerified` ref implementation.
 * guest-nickname-verified-fails-loudly-rn — these two guards used to RESOLVE (a
 * silent no-op). They now REJECT with {@link NICKNAME_SET_PRECONDITION_FAILED}.
 *
 * Intercepting here is a FAST PATH, not a semantic fork: the rejection this returns
 * carries the EXACT SAME `code` the native bridge produces for the same pre-flight
 * failure, so「哪一層擋下的」is unobservable to the caller — the guard only saves a
 * bridge round-trip (and for `tag == null` there is no native side to reach at all).
 * Deliberately NOT resolving: resolve is the ONLY success signal a caller has (the
 * turnkey container dismisses the nickname modal, opens the composer and completes a
 * pending「加入活動」join on it), so resolving without having committed is the very
 * defect `guest-nickname-verified-fails-loudly-core` removed one layer below.
 *
 * Two guards, evaluated in this FIXED order — the first unmet condition decides the
 * rejection, and the two carry DIFFERENT messages so the order is observable (and
 * therefore test-pinnable; without that, swapping them is a surviving mutation):
 *   1. `name` trimmed-empty — a pure function of the argument just passed in, with
 *      no dependency on mount state, so it is checked first (mirrors core's own
 *      「空白最先」evaluation order).
 *   2. no mounted view (`tag == null`) — no view means no checkName context.
 *
 * Neither guard calls `bridgeCall`: no native call, no network, no persist, no
 * broadcast. This stays the single JS-side chokepoint for the blank-name contract —
 * the native bridge methods do NOT duplicate the blank check; they rely on this
 * guard being the only path a host reaches them through.
 *
 * Otherwise delegates to `bridgeCall(tag, name)` (the Promise-returning native
 * module method), passing its resolution/rejection through unchanged.
 *
 * Exported for testing — same pattern as `dispatchNotifyPipModeChanged` /
 * `mapWidgetColors`: the native `.kt`/`.swift` bridge does not compile in this repo,
 * so this pure guard is the JS-side acceptance gate.
 */
export function callSetGuestNicknameVerified(
  tag: number | null,
  bridgeCall: (reactTag: number, name: string) => Promise<void>,
  name: string,
): Promise<void> {
  if (name.trim().length === 0) {
    return nicknameSetPreconditionRejection(
      'setGuestNicknameVerified: the name is empty after trimming — nothing was submitted.',
    );
  }
  if (tag == null) {
    return nicknameSetPreconditionRejection(
      'setGuestNicknameVerified: the native player view is not mounted — nothing was submitted.',
    );
  }
  return bridgeCall(tag, name);
}

const NATIVE_VIEW = 'LivebuyPlayerView';
const NativePlayerView = requireNativeComponent<any>(NATIVE_VIEW);
const { LivebuyRNBridge } = NativeModules;

const LivebuyPlayerCore = forwardRef<LivebuyPlayerCoreRef, LivebuyPlayerCoreProps>(
  (props, ref) => {
    const {
      videoId,
      showChat = true,
      showProducts = true,
      enablePiP = true,
      autoDismissDelay = 5,
      onStateChange,
      onPollReceived,
      onError,
      onProductTap,
      onChannelChange,
      onPlaybackProgressChange,
      style,
    } = props;

    const nativeRef = useRef<any>(null);

    // rn-vod-playback-progress-core — latest known channel `liveStatus` /
    // playback `duration`, tracked purely for the `vodScrubAllowed` gate below
    // (not exposed as component state; the host reads these via the
    // `onChannelChange` / `onPlaybackProgressChange` props directly). Defaults
    // mirror "unknown" (`-1`) / "no scrubbable timeline yet" (`0`) — both make
    // `vodScrubAllowed` return `false`, matching iOS's own gate semantics
    // before any channel data has arrived.
    const latestLiveStatusRef = useRef<number>(-1);
    const latestDurationRef = useRef<number>(0);

    const dispatch = (cmd: string, args: unknown[] = []) => {
      const tag = findNodeHandle(nativeRef.current);
      if (tag != null) {
        UIManager.dispatchViewManagerCommand(tag, cmd, args);
      }
    };

    // Load when videoId changes; release on unmount.
    useEffect(() => {
      dispatch('load', [videoId]);
    }, [videoId]);

    useEffect(() => {
      return () => {
        // `release` is the legacy command name (aliased to `unload` in
        // the native bridges for backward compat).
        dispatch('release', []);
      };
    }, []);

    // Subscribe to the 4 deprecated per-view event channels (+ the additive
    // upcoming-intro-core-rn channel-info forward). The 19 new SDK events flow
    // through `onSdkEvent` (not addressed here) — use `registerListener` from
    // `LivebuyEvents.ts` for those.
    useEffect(() => {
      const emitter = new NativeEventEmitter(LivebuyRNBridge);
      const subs = [
        emitter.addListener('LBPlayerStateChange',
          (s: LBPlayerState) => onStateChange?.(s)),
        emitter.addListener('LBPollReceived',
          (r: LBPollResponse) => onPollReceived?.(r)),
        emitter.addListener('LBError',
          (e: LBError) => onError?.(e)),
        emitter.addListener('LBProductTap',
          (p: LBProduct) => onProductTap?.(p)),
        // upcoming-intro-core-rn — channel-info forward (lightweight projection
        // for the player-side upcoming chrome). The native player view emits a
        // snake_case payload `{ publish_at, cover, start, live_status, title }`
        // on channel load; map it to the camelCase `LBPlayerChannelInfo` host
        // shape. Inert (no-op callback) when `onChannelChange` is unset.
        emitter.addListener('LBPlayerChannelInfo',
          (wire: Parameters<typeof mapPlayerChannelInfo>[0]) => {
            const info = mapPlayerChannelInfo(wire);
            latestLiveStatusRef.current = info.liveStatus;
            onChannelChange?.(info);
          }),
        // rn-vod-playback-progress-core — dedicated VOD playback-progress
        // channel forward. The native player view emits a camelCase payload
        // `{ position, duration, isPlaying, isReplay }` (SDK-internal value
        // type, no snake_case wire convention — unlike LBPlayerChannelInfo);
        // map + sanitize it via `mapPlaybackProgress`. Always installed (like
        // the other listeners here) so `latestDurationRef` stays current for
        // the `seek`/`seekBy` gate even when the host doesn't set
        // `onPlaybackProgressChange`. Inert (no-op callback) when unset.
        emitter.addListener('LBPlaybackProgressChange',
          (wire: Parameters<typeof mapPlaybackProgress>[0]) => {
            const progress = mapPlaybackProgress(wire);
            latestDurationRef.current = progress.duration;
            onPlaybackProgressChange?.(progress);
          }),
      ];
      return () => subs.forEach(s => s.remove());
    }, [onStateChange, onPollReceived, onError, onProductTap, onChannelChange, onPlaybackProgressChange]);

    // Imperative API.
    useImperativeHandle(ref, () => ({
      load: (id: string) => dispatch('load', [id]),
      unload: () => dispatch('unload', []),
      play: () => dispatch('play', []),
      pause: () => dispatch('pause', []),
      setMuted: (muted: boolean) => dispatch('setMuted', [muted]),
      // rn-vod-playback-progress-core: gated by `vodScrubAllowed`, fed by the
      // latest tracked liveStatus/duration — see `LivebuyPlayerCoreRef.seek`'s
      // JSDoc for the full contract.
      seek: (seconds: number) =>
        dispatchSeekIfAllowed(dispatch, latestLiveStatusRef.current, latestDurationRef.current, seconds),
      seekBy: (delta: number) =>
        dispatchSeekByIfAllowed(dispatch, latestLiveStatusRef.current, latestDurationRef.current, delta),
      togglePlayPause: () => dispatch('togglePlayPause', []),
      sendChat: (message: string, eventId?: number) =>
        dispatch('sendChat', eventId != null ? [message, eventId] : [message]),
      skipStart: () => dispatch('skipStart', []),
      cancelAutoNext: () => dispatch('cancelAutoNext', []),
      requestEventJoin: (eid: number, keyword: string) =>
        dispatch('requestEventJoin', [eid, keyword]),
      requestViewCart: (productId?: string) =>
        dispatch('requestViewCart', productId != null ? [productId] : []),
      reportEventStay: (eventId: number, stayTime?: number) =>
        dispatch('reportEventStay', stayTime != null ? [eventId, stayTime] : [eventId]),
      requestAwardClaim: (winner, contact) =>
        dispatch('requestAwardClaim', contact != null ? [winner, contact] : [winner]),
      // active-event-accessor-rn-core: read-only snapshot of the current active
      // events. Unlike the simulate*/command paths above (fire-and-forget via
      // dispatchViewManagerCommand), this needs a return value, so it calls the
      // Promise-returning native module method keyed by reactTag. The native
      // side serializes each LBActiveEvent to `{ id, title, duration, surplus,
      // award, keyword? }` (excludes stayTime; omits empty keyword) — the shape
      // already IS LBActiveEvent, so no JS mapping is needed. View not mounted
      // (tag == null) → resolve [] without hitting native.
      activeEvents: (): Promise<LBActiveEvent[]> => {
        const tag = findNodeHandle(nativeRef.current);
        if (tag == null) return Promise.resolve([]);
        return LivebuyRNBridge.activeEvents(tag) as Promise<LBActiveEvent[]>;
      },
      // guest-nickname-checkname-on-set-rn: checkName-gated verified nickname set.
      // Same bridge shape as `activeEvents` above (Promise-returning native module
      // method keyed by reactTag, not dispatchViewManagerCommand) — needs a
      // differentiated return value (success / taken / never-sent / other error).
      // guest-nickname-verified-fails-loudly-rn: the blank-name and tag==null
      // pre-flight guards are factored into the exported pure
      // `callSetGuestNicknameVerified` and now REJECT (they used to resolve) with the
      // same `code` the native side produces — see `LivebuyPlayerCoreRef`'s TSDoc for
      // the full outcome contract (one success + four reject codes) and
      // `callSetGuestNicknameVerified`'s own doc for the fixed evaluation order.
      setGuestNicknameVerified: (name: string): Promise<void> =>
        callSetGuestNicknameVerified(
          findNodeHandle(nativeRef.current),
          LivebuyRNBridge.setGuestNicknameVerified,
          name,
        ),
      // rn-android-pip-mode-forward-core: forward the host Android Activity's
      // onPictureInPictureModeChanged confirmation into the wrapped native view.
      // Android-only — `dispatchNotifyPipModeChanged` guards Platform.OS so the
      // command never dispatches on iOS (iOS PiP delegate reaches the SDK
      // regardless of container; the iOS ViewManager does not register it).
      notifyPictureInPictureModeChanged: (isInPictureInPictureMode: boolean) =>
        dispatchNotifyPipModeChanged(Platform.OS, dispatch, isInPictureInPictureMode),
      minimize: () => {
        // v1.x scope deferred per spec — log warning so host knows.
        // eslint-disable-next-line no-console
        console.warn(
          'LivebuyPlayerCore.minimize() not implemented in v1.x; ' +
          'deferred to next UI propose (in-app PiP).'
        );
      },
      expand: () => {
        // eslint-disable-next-line no-console
        console.warn(
          'LivebuyPlayerCore.expand() not implemented in v1.x; ' +
          'deferred to next UI propose (in-app PiP).'
        );
      },
      // Sub-component simulate* refs (expand-simulate-bridge-parity)
      chatView: {
        simulateSendTap: (text: string, eventId?: number) =>
          dispatch('chatView_simulateSendTap', eventId != null ? [text, eventId] : [text]),
        simulateLoadHistoryTap: () => dispatch('chatView_simulateLoadHistoryTap', []),
        simulateEventJoinTap: (eid: number, keyword: string) =>
          dispatch('chatView_simulateEventJoinTap', [eid, keyword]),
      },
      productOverlay: {
        simulateProductTap: (product: LBProduct) =>
          dispatch('productOverlay_simulateProductTap', [product]),
        simulatePushCardDismiss: () => dispatch('productOverlay_simulatePushCardDismiss', []),
        simulatePanelToggle: () => dispatch('productOverlay_simulatePanelToggle', []),
      },
      productListPanel: {
        simulateProductTap: (product: LBProduct) =>
          dispatch('productListPanel_simulateProductTap', [product]),
        simulateAddCart: (product: LBProduct, spec?: LBBridgeSpec) =>
          dispatch('productListPanel_simulateAddCart', spec != null ? [product, spec] : [product]),
        simulateRestockNotice: (product: LBProduct) =>
          dispatch('productListPanel_simulateRestockNotice', [product]),
      },
      operationPanel: {
        simulateGoodsTap: () => dispatch('operationPanel_simulateGoodsTap', []),
        simulateChatToggleTap: () => dispatch('operationPanel_simulateChatToggleTap', []),
        simulateLikeTap: () => dispatch('operationPanel_simulateLikeTap', []),
        simulateShareTap: () => dispatch('operationPanel_simulateShareTap', []),
        simulateSubtitleToggleTap: () => dispatch('operationPanel_simulateSubtitleToggleTap', []),
        simulateServiceLinkTap: () => dispatch('operationPanel_simulateServiceLinkTap', []),
        simulateMoreTap: () => dispatch('operationPanel_simulateMoreTap', []),
        simulateGuestNameEditTap: () => dispatch('operationPanel_simulateGuestNameEditTap', []),
        simulateSkipStartTap: () => dispatch('operationPanel_simulateSkipStartTap', []),
        simulateBackToLiveTap: () => dispatch('operationPanel_simulateBackToLiveTap', []),
      },
      videoInfoPanel: {
        simulateSubscribeTap: () => dispatch('videoInfoPanel_simulateSubscribeTap', []),
        simulateServiceLinkTap: () => dispatch('videoInfoPanel_simulateServiceLinkTap', []),
        simulateShopTap: () => dispatch('videoInfoPanel_simulateShopTap', []),
        simulateDismiss: () => dispatch('videoInfoPanel_simulateDismiss', []),
        simulateTabChange: (tab: 'info' | 'notice') =>
          dispatch('videoInfoPanel_simulateTabChange', [tab]),
      },
      endScreen: {
        simulateCancelTap: () => dispatch('endScreen_simulateCancelTap', []),
        simulateHotItemTap: (item: LBBridgeHotItem) =>
          dispatch('endScreen_simulateHotItemTap', [item]),
      },
    }));

    return (
      <NativePlayerView
        ref={nativeRef}
        style={[styles.fill, style]}
        videoId={videoId}
        showChat={showChat}
        showProducts={showProducts}
        enablePiP={enablePiP}
        autoDismissDelay={autoDismissDelay}
      />
    );
  }
);

LivebuyPlayerCore.displayName = 'LivebuyPlayerCore';

const styles = StyleSheet.create({
  fill: { flex: 1 },
});

export default LivebuyPlayerCore;

// MARK: - Deprecated aliases (rename-bare-player-livebuyplayercore-rn)
//
// The bare headless player was renamed `LivebuyPlayer` → `LivebuyPlayerCore` to
// free the golden name `LivebuyPlayer` for the upcoming drop-in container
// (`introduce-dropin-player-container-rn`, reference-ui layer). These aliases
// keep existing host imports working through the v2.x line; they are removed in
// v3 per the deprecated-alias policy (`I6 向後相容 deprecated alias 策略`).

/** @deprecated 改用 `LivebuyPlayerCore`。黃金名 `LivebuyPlayer` 將由
 *  drop-in 容器（`introduce-dropin-player-container-rn`）改義接手；此裸版
 *  alias 將於 v3 移除。請勿假設 `LivebuyPlayer` 永遠是裸版。 */
export const LivebuyPlayer = LivebuyPlayerCore;

/** @deprecated 改用 `LivebuyPlayerCoreRef`。 */
export type LivebuyPlayerRef = LivebuyPlayerCoreRef;

/** @deprecated 改用 `LivebuyPlayerCoreProps`。 */
export type LivebuyPlayerProps = LivebuyPlayerCoreProps;

// MARK: - Widget native components (expand-simulate-bridge-parity Tier 2)

const NativeWidgetView = requireNativeComponent<any>('LivebuyWidgetView');
const NativeFloatingWidgetView = requireNativeComponent<any>('LivebuyFloatingWidgetView');

export interface LivebuyWidgetCoreProps {
  shopId: string;
  /**
   * widget-bridge-color-core / widget-product-card-bridge-rn — host-readable
   * root settings from the `/sdk/widget` response.
   *
   * Fired after the widget completes its `POST /sdk/widget` fetch
   * (carousel / grid; first page + loadMore reuse the same settings). The
   * native widget view emits a snake_case payload `{ widget_color,
   * widget_bgcolor, product_card }` which this component maps to a camelCase
   * `LBWidgetSettings`. RAW PASSTHROUGH — the SDK does not interpret the color
   * or display-mode semantics, and these are STRICTLY SEPARATE from
   * `sdkConfig.theme.primaryColor`.
   *
   * Floating widget (`POST /sdk/widget/live`) does NOT carry these and never
   * fires this. Purely additive — leaving it unset preserves prior behavior. The
   * callback parameter widened from `LBWidgetColors` to its subtype
   * `LBWidgetSettings`; under contravariant parameter checking an existing host
   * callback declared `(c: LBWidgetColors) => void` still assigns here.
   */
  onWidgetResponse?: (settings: LBWidgetSettings) => void;
  style?: ViewStyle;
}

export interface LivebuyFloatingWidgetProps {
  videoId: string;
  style?: ViewStyle;
}

/**
 * Maps the native widget-response snake_case wire payload to the host-facing
 * camelCase `LBWidgetColors` (widget-bridge-color-core). Exported for testing —
 * the native bridge `.swift`/`.kt` does not compile in this repo, so this pure
 * mapper is the acceptance gate for the wire → host shape per design.md §驗證策略.
 *
 * Wire contract (raw passthrough, SDK does not interpret):
 *   - `widget_color`: Int, missing → default `1`.
 *   - `widget_bgcolor`: String? — backend Int 1 already came over as `"1"`,
 *     hex stays raw, missing → `null`. ALWAYS `string | null` on the bridge.
 */
export function mapWidgetColors(wire: {
  widget_color?: number;
  widget_bgcolor?: string | null;
}): LBWidgetColors {
  return {
    widgetColor: wire.widget_color ?? 1,
    widgetBgcolor: wire.widget_bgcolor ?? null,
  };
}

/**
 * Maps the full native widget-response snake_case wire payload to the host-facing
 * camelCase `LBWidgetSettings` (widget-product-card-bridge-rn) — the colors above
 * plus the carousel product-card display mode. Exported for testing, for the same
 * reason `mapWidgetColors` is: the native bridge `.swift`/`.kt` does not compile in
 * this repo, so this pure mapper is the acceptance gate for the wire → host shape
 * per design.md §驗證策略.
 *
 * Wire contract (raw passthrough, SDK does not interpret):
 *   - `widget_color` / `widget_bgcolor`: delegated to {@link mapWidgetColors}.
 *   - `product_card`: String? — `'below'` / `'inside'` / `'hidden'` verbatim, and
 *     an unrecognized value is kept verbatim too. Missing (the `fetchWidget` map
 *     omits the key) and explicit `null` (the `LBWidgetResponse` event sends JS
 *     null) BOTH become `null` — the two native conventions collapse here and only
 *     here.
 *
 * The backend default `'inside'` is NEVER substituted: `null` means the backend
 * sent nothing, which is a different fact from the backend sending `'inside'`.
 * Collapsing them would leave the host permanently unable to tell them apart.
 */
export function mapWidgetSettings(wire: {
  widget_color?: number;
  widget_bgcolor?: string | null;
  product_card?: string | null;
}): LBWidgetSettings {
  return {
    ...mapWidgetColors(wire),
    productCard: wire.product_card ?? null,
  };
}

/** Headless widget bridge — exposes simulate* for host-driven UI. */
export const LivebuyWidgetCore = forwardRef<LivebuyWidgetCoreRef, LivebuyWidgetCoreProps>(
  ({ shopId, onWidgetResponse, style }, ref) => {
    const nativeRef = useRef<any>(null);

    const dispatch = (cmd: string, args: unknown[] = []) => {
      const tag = findNodeHandle(nativeRef.current);
      if (tag != null) UIManager.dispatchViewManagerCommand(tag, cmd, args);
    };

    useEffect(() => { dispatch('configure', [shopId]); }, [shopId]);

    // widget-bridge-color-core / widget-product-card-bridge-rn — subscribe to the
    // widget-response event. The native widget view emits `LBWidgetResponse` with a
    // snake_case payload `{ widget_color, widget_bgcolor, product_card }` after the
    // `POST /sdk/widget` fetch; map it to the camelCase `LBWidgetSettings` host
    // shape. Purely additive — unset `onWidgetResponse` installs no subscription.
    useEffect(() => {
      if (onWidgetResponse == null) return;
      const emitter = new NativeEventEmitter(LivebuyRNBridge);
      const sub = emitter.addListener(
        'LBWidgetResponse',
        (wire: {
          widget_color?: number;
          widget_bgcolor?: string | null;
          product_card?: string | null;
        }) => onWidgetResponse(mapWidgetSettings(wire)),
      );
      return () => sub.remove();
    }, [onWidgetResponse]);

    useImperativeHandle(ref, () => ({
      simulateCardTap: (video: LBBridgeVideoItem) => dispatch('simulateCardTap', [video]),
      simulateClose: () => dispatch('simulateClose', []),
      simulateCardVisibilityChanged: (video: LBBridgeVideoItem, visible: boolean) =>
        dispatch('simulateCardVisibilityChanged', [video, visible]),
    }));

    return <NativeWidgetView ref={nativeRef} shopId={shopId} style={[styles.fill, style]} />;
  }
);

/** Headless floating-widget bridge — exposes simulate* for host-driven UI. */
export const LivebuyFloatingWidget = forwardRef<LivebuyFloatingWidgetRef, LivebuyFloatingWidgetProps>(
  ({ videoId, style }, ref) => {
    const nativeRef = useRef<any>(null);

    const dispatch = (cmd: string, args: unknown[] = []) => {
      const tag = findNodeHandle(nativeRef.current);
      if (tag != null) UIManager.dispatchViewManagerCommand(tag, cmd, args);
    };

    useImperativeHandle(ref, () => ({
      simulateClose: () => dispatch('simulateClose', []),
      simulateTap: () => dispatch('simulateTap', []),
    }));

    return <NativeFloatingWidgetView ref={nativeRef} videoId={videoId} style={[styles.fill, style]} />;
  }
);

// MARK: - Deprecated bare-widget alias (rename-bare-widget-to-core-rn)
// The bare headless widget was renamed `LivebuyWidget` → `LivebuyWidgetCore` to free the
// golden name for the drop-in container (introduce-dropin-widget-container-rn,
// livebuy-react-native-reference-ui). Native registration name `LivebuyWidgetView` is unchanged.
/** @deprecated 改用 `LivebuyWidgetCore`。黃金名 `LivebuyWidget` 由 drop-in 容器接手；v3 移除。 */
export const LivebuyWidget = LivebuyWidgetCore;
/** @deprecated 改用 `LivebuyWidgetCoreRef`。 */
export type LivebuyWidgetRef = LivebuyWidgetCoreRef;
/** @deprecated 改用 `LivebuyWidgetCoreProps`。 */
export type LivebuyWidgetProps = LivebuyWidgetCoreProps;
