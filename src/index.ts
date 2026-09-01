export { default as LivebuySDK } from './LivebuySDK';
// event-payload-typed-accessors-rn-core — LBCartTrack.attributeFields parity convenience accessor
export { cartTrackAttributeFields } from './LivebuySDK';
export type {
  LBUser,
  LBConfigOptions,
  LBProduct,
  // product-bridge-data-core — full LBProduct nested spec types
  LBSpec,
  LBSpecOption,
  LBPollResponse,
  LBPlayerState,
  LBError,
  LBLocaleCode,
  LBCheckoutItem,
  LBFlushStatus,
  LBFlushResult,
  // power-profile-adaptation (第 5 支 parity) — thermal power-profile tier wire name
  LBPowerProfile,
  LBVideoItem,
  // video-addcart-endpoint-core 路線 B (distinct from route-A LBCartResult below)
  LBAddToCartOptions,
  LBAddToCartResult,
  // addcart-track ④ — 導購歸因指令 (addToCart result / CART_ADD_REQUEST track)
  LBCartTrack,
  LBCartTrackField,
  LBCartTrackMode,
  // reconcile-activity-notification-contract — award claim
  LBWinner,
  LBAward,
  LBAwardClaimInput,
  LBAwardClaimStatus,
  // active-event-accessor-rn-core — activeEvents() Promise accessor snapshot model
  LBActiveEvent,
  // widget-bridge-color-core — web-embed widget colors host-readable output
  LBWidgetColors,
  // widget-product-card-bridge-rn — the colors plus the carousel product-card
  // display mode; the `onWidgetResponse` payload shape
  LBWidgetSettings,
} from './LivebuySDK';

export { default as LivebuyPlayerCore, LivebuyWidgetCore, LivebuyFloatingWidget } from './LivebuyPlayer';
// rename-bare-player-livebuyplayercore-rn — deprecated alias for the bare
// player; the golden name `LivebuyPlayer` will be repurposed for the drop-in
// container (`introduce-dropin-player-container-rn`). Removed in v3.
export { LivebuyPlayer } from './LivebuyPlayer';
// rename-bare-widget-to-core-rn — deprecated alias for the bare widget; the
// golden name `LivebuyWidget` is repurposed for the drop-in container
// (`introduce-dropin-widget-container-rn`). Removed in v3.
export { LivebuyWidget } from './LivebuyPlayer';
export type {
  LivebuyPlayerCoreRef,
  LivebuyPlayerCoreProps,
  // Deprecated type aliases (rename-bare-player-livebuyplayercore-rn) — removed v3
  LivebuyPlayerRef,
  LivebuyPlayerProps,
  // Widget ref/props interfaces (expand-simulate-bridge-parity Tier 2)
  LivebuyWidgetCoreRef,
  LivebuyWidgetCoreProps,
  // Deprecated type aliases (rename-bare-widget-to-core-rn) — removed v3
  LivebuyWidgetRef,
  LivebuyWidgetProps,
  LivebuyFloatingWidgetRef,
  LivebuyFloatingWidgetProps,
  // Sub-component simulate* ref interfaces (expand-simulate-bridge-parity Tier 1)
  ChatViewRef,
  ProductOverlayRef,
  ProductListPanelRef,
  OperationPanelRef,
  VideoInfoPanelRef,
  EndScreenRef,
  // Bridge-level type helpers
  LBBridgeSpec,
  LBBridgeHotItem,
  LBBridgeVideoItem,
} from './LivebuyPlayer';

// guest-nickname-verified-fails-loudly-rn — the authoritative wire spelling for the
// `setGuestNicknameVerified`「前置條件不成立、checkName 根本沒送出」rejection, plus the
// factory that builds a JS-side rejection in the same shape a native reject produces.
// Exported so hosts (and the reference-ui drop-in) branch on one source of truth
// instead of re-typing the string.
export {
  NICKNAME_SET_PRECONDITION_FAILED,
  nicknameSetPreconditionRejection,
} from './LivebuyPlayer';

export {
  LBEvents,
  registerListener,
  resolveCart,
} from './LivebuyEvents';
export type {
  LBEventName,
  LBSdkEvent,
  LBSdkEventParamsMap,
  LBShareContext,
  LBCartResult,
  LBCartSuccess,
  LBCartFailure,
  LBEventHandler,
  // reconcile-activity-notification-contract — award claim event params
  LBAwardClaimIntentParams,
  LBAwardClaimResultParams,
  // rn-winreceived-typed-params-core — WIN_RECEIVED typed params
  LBWinReceivedParams,
  // active-event-host-facing-exposure-rn-core — ACTIVE_EVENT_STARTED typed params
  LBActiveEventStartedParams,
  // replay-chat-history-load + replay-chat-timeline-sync — CHAT_HISTORY_LOADED params (full-list + per-comment time)
  LBChatHistoryLoadedParams,
  LBReplayChatComment,
} from './LivebuyEvents';

export { LBRoute } from './LBRoute';
export type { LBRouteName, LBRoutePath } from './LBRoute';

// url-open-policy-rn — 「livebuy.tv 用 app 內開、其他開外部瀏覽器」的四端共用裁決規則
// （core 純函式，只裁決不開啟）+ 法務連結的單一事實來源。headless host 與
// react-native-reference-ui 都從這裡取用同一份規則，不各自重寫字串比對。
export { LBURLOpenPolicy, LB_URL_IN_APP_DOMAIN } from './LBURLOpenPolicy';
export type { LBURLOpenTarget, LBURLOpenDecision } from './LBURLOpenPolicy';
export { LBLegalLinks } from './LBLegalLinks';

// add-sdk-config-transport — SDKConfig types + event params
export type {
  SDKConfig,
  LBSdkVisibility,
  LBSdkTheme,
  LBSdkTemplateLayout,
  LBSdkBehavior,
  LBSdkConfigLoadFailedSource,
  LBSdkConfigLoadFailedParams,
  LBSdkConfigRefreshedSource,
  LBSdkConfigRefreshedParams,
} from './SDKConfig';
