// LBRoute — endpoint constants for type-check parity with native.
//
// Native iOS / Android SDKs own the **authoritative** endpoint paths via
// their own LBRoute enum / sealed class. RN doesn't make HTTP calls
// directly — the native side does. This file exists purely to let RN code
// (and host TypeScript apps) reference the canonical path strings for
// logging / type-checking, without re-declaring magic literals.
//
// Per api-version-resilience §Endpoint 集中註冊表 `LBRoute` §「四端 LBRoute 一致」.

export const LBRoute = {
  video: '/sdk/video',
  widget: '/sdk/widget',
  widgetLive: '/sdk/widget/live',
  videoMessages: '/sdk/video/messages',
  videoGoods: '/sdk/video/goods',
  videoComments: '/sdk/video/comments',
  videoCommentsub: '/sdk/video/commentsub',
  videoCheckname: '/sdk/video/checkname',
  videoSubscribe: '/sdk/video/subscribe',
  videoLike: '/sdk/video/like',
  videoAddcart: '/sdk/video/addcart',
  // addcart-track ④ — token 平台結帳前回報 cart token. Canonical path mirrored
  // here for four-end LBRoute parity (RN never calls it directly; the native SDK
  // owns the HTTP request via reportCartTrack).
  videoAddcartTrack: '/sdk/video/addcart/track',
  goodsAwait: '/sdk/goods/await',
  goodsNotice: '/sdk/goods/notice',
  // reconcile-activity-notification-contract — award claim. Canonical path
  // mirrored here for four-end LBRoute parity / type-check parity (RN never
  // calls it directly; the native SDK owns the HTTP request).
  videoClaim: '/sdk/video/claim',
  // rn-lbroute-eventstay-parity — event-stay heartbeat. Canonical path mirrored here for four-end
  // LBRoute parity (RN never calls it directly; the native SDK owns the HTTP via reportEventStay).
  videoEventstay: '/sdk/video/eventstay',
  login: '/sdk/login',
  log: '/sdk/log',
  logConfig: '/sdk/log_config',
  sdkConfig: '/sdk/config',
} as const;

export type LBRouteName = keyof typeof LBRoute;
export type LBRoutePath = typeof LBRoute[LBRouteName];
