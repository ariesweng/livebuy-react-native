#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <React/RCTViewManager.h>

// MARK: - Module: LivebuyRNBridge (configure / events)

@interface RCT_EXTERN_MODULE(LivebuyRNBridge, RCTEventEmitter)

RCT_EXTERN_METHOD(configure:(nonnull NSNumber *)apiKey
                  secret:(NSString *)secret
                  shopId:(NSString *)shopId
                  lang:(nullable NSString *)lang
                  displayName:(nullable NSString *)displayName
                  avatarUrl:(nullable NSString *)avatarUrl
                  externalUserId:(nullable NSString *)externalUserId
                  autoPipOnIntercept:(BOOL)autoPipOnIntercept
                  apiVersion:(nonnull NSNumber *)apiVersion
                  configFetchTimeoutMs:(nonnull NSNumber *)configFetchTimeoutMs
                  enableConversionAttribution:(BOOL)enableConversionAttribution
                  enablePowerProfileAdaptation:(BOOL)enablePowerProfileAdaptation
                  enableStatReporting:(BOOL)enableStatReporting
                  environment:(NSString *)environment
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(registerListener)
RCT_EXTERN_METHOD(unregisterListener)

// In-app browser navigation tool (fix-ui-template-default-parity-core)
RCT_EXTERN_METHOD(openInAppBrowser:(NSString *)url)

RCT_EXTERN_METHOD(setUser:(NSDictionary *)map)
RCT_EXTERN_METHOD(clearUser)
RCT_EXTERN_METHOD(setGuestNickname:(NSString *)name)
RCT_EXTERN_METHOD(setLanguage:(NSString *)lang)

// MARK: - Conversion attribution bridge (conversion-attribution-context-rn)
RCT_EXTERN_METHOD(captureAdClick:(NSString *)url)
RCT_EXTERN_METHOD(setFbclid:(NSString *)fbclid)
RCT_EXTERN_METHOD(setReferer:(nullable NSString *)referer)
RCT_EXTERN_METHOD(clearAttributionContext)
RCT_EXTERN_METHOD(currentFbc:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(currentFbp:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// MARK: - Power profile (power-profile-adaptation, 第 5 支 parity)
// Registers the Swift @objc `currentPowerProfile` promise getter so RN legacy
// bridge exports it to JS (Swift @objc alone is NOT exported without this).
RCT_EXTERN_METHOD(currentPowerProfile:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// MARK: - Stat reporting bridge (sdk-stat-reporting, rn-stat-reporting-core)
RCT_EXTERN_METHOD(clearStatContext)

RCT_EXTERN_METHOD(notifyCheckoutCompleted:(NSString *)orderId
                  sdkTrackCodes:(NSArray<NSString *> *)sdkTrackCodes
                  items:(nullable NSArray<NSDictionary *> *)items)

RCT_EXTERN_METHOD(flushPendingEvents:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// MARK: - sdk-config bridge (add-sdk-config-transport)

RCT_EXTERN_METHOD(getSdkConfig:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(refreshConfig:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(resolveCartRequest:(NSString *)callbackId
                  success:(BOOL)success
                  appTrackCode:(nullable NSString *)appTrackCode
                  errorCode:(nullable NSString *)errorCode
                  errorMessage:(nullable NSString *)errorMessage)

RCT_EXTERN_METHOD(fetchLatestLive:(NSString *)id
                  ty:(NSString *)ty
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(fetchWidget:(NSString *)id
                  page:(nonnull NSNumber *)page
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// MARK: - login (login-session-token-core)

RCT_EXTERN_METHOD(login:(NSString *)memberId
                  memberName:(nullable NSString *)memberName
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// MARK: - bindSession / isLoggedIn (auth-bind-session-ergonomics)

RCT_EXTERN_METHOD(bindSession:(NSString *)memberId
                  memberName:(nullable NSString *)memberName
                  avatarUrl:(nullable NSString *)avatarUrl
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(isLoggedIn:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// MARK: - boundMemberId (bind-session-transition-idempotent-rn-core)

RCT_EXTERN_METHOD(boundMemberId:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// MARK: - activeEvents accessor (active-event-accessor-rn-core)
// View-scoped Promise accessor keyed by reactTag — read-only snapshot of the
// current in-progress live events for the addressed player. Resolves LBActiveEvent[]
// (excludes stayTime; keyword omitted when empty); view gone → resolves [].
RCT_EXTERN_METHOD(activeEvents:(nonnull NSNumber *)reactTag
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// MARK: - isMuted accessor (mute-preference-persist-across-session-rn-core)
// View-scoped Promise accessor keyed by reactTag — current actual mute state
// of the addressed player (mirrors iOS/Android core isMuted getter). View gone /
// no core player yet → resolves false.
RCT_EXTERN_METHOD(isMuted:(nonnull NSNumber *)reactTag
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// MARK: - setGuestNicknameVerified bridge (guest-nickname-checkname-on-set-rn
//         + guest-nickname-verified-fails-loudly-rn)
// View-scoped Promise accessor keyed by reactTag — checkName-gated verified
// nickname set. RESOLVE ⟺ the nickname was committed (persisted + broadcast);
// every non-committing path rejects, with one of four codes:
//   "guestNameTaken"                — sent, refused by the server (name taken)
//   "nicknameSetPreconditionFailed" — NEVER SENT (blank name / no video loaded /
//                                     view gone or wrong type / no core player yet)
//   "NOT_CONFIGURED"                — configure() has not returned successfully
//   "LB_ERROR"                      — sent, outcome unknown (network / server)
// View gone → REJECT (not resolve): unlike activeEvents above, which is a READ
// where an empty snapshot is a truthful answer, this is a WRITE.
RCT_EXTERN_METHOD(setGuestNicknameVerified:(nonnull NSNumber *)reactTag
                  name:(NSString *)name
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// MARK: - addToCart (video-addcart-endpoint-core)

RCT_EXTERN_METHOD(addToCart:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// addcart-track ④ — token 平台結帳前回報 cart token (POST /sdk/video/addcart/track).
RCT_EXTERN_METHOD(reportCartTrack:(NSString *)shopId
                  buyNo:(NSString *)buyNo
                  trackId:(NSString *)trackId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// MARK: - goods tracking (goods-await-notice-endpoints-core)

RCT_EXTERN_METHOD(setAwaitGoods:(NSString *)goodsGpn
                  enabled:(BOOL)enabled
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(setNoticeGoods:(NSString *)goodsGpn
                  enabled:(BOOL)enabled
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end

// MARK: - ViewManager: LivebuyWidgetView

@interface RCT_EXTERN_MODULE(LivebuyWidgetViewManager, RCTViewManager)

RCT_EXTERN_METHOD(configure:(nonnull NSNumber *)reactTag
                  shopId:(NSString *)shopId)
RCT_EXTERN_METHOD(simulateCardTap:(nonnull NSNumber *)reactTag
                  video:(NSDictionary *)video)
RCT_EXTERN_METHOD(simulateClose:(nonnull NSNumber *)reactTag)
RCT_EXTERN_METHOD(simulateCardVisibilityChanged:(nonnull NSNumber *)reactTag
                  video:(NSDictionary *)video
                  visible:(BOOL)visible)

@end

// MARK: - ViewManager: LivebuyFloatingWidgetView

@interface RCT_EXTERN_MODULE(LivebuyFloatingWidgetViewManager, RCTViewManager)

RCT_EXTERN_METHOD(configure:(nonnull NSNumber *)reactTag
                  videoId:(NSString *)videoId)
RCT_EXTERN_METHOD(simulateClose:(nonnull NSNumber *)reactTag)
RCT_EXTERN_METHOD(simulateTap:(nonnull NSNumber *)reactTag)

@end

// MARK: - ViewManager: LivebuyPlayerView

@interface RCT_EXTERN_MODULE(LivebuyPlayerViewManager, RCTViewManager)

RCT_EXTERN_METHOD(load:(nonnull NSNumber *)reactTag
                  videoId:(NSString *)videoId)

// Legacy command name preserved as alias for backward compat.
RCT_EXTERN_METHOD(release:(nonnull NSNumber *)reactTag)
RCT_EXTERN_METHOD(unload:(nonnull NSNumber *)reactTag)

RCT_EXTERN_METHOD(play:(nonnull NSNumber *)reactTag)

RCT_EXTERN_METHOD(pause:(nonnull NSNumber *)reactTag)

RCT_EXTERN_METHOD(setMuted:(nonnull NSNumber *)reactTag
                  muted:(BOOL)muted)

RCT_EXTERN_METHOD(seek:(nonnull NSNumber *)reactTag
                  seconds:(double)seconds)

// rn-vod-playback-progress-core — control exits (iOS core already has
// togglePlayPause()/seekBy(_:); Android does not yet, so no Android-side
// command — see that change's design.md D6).
RCT_EXTERN_METHOD(togglePlayPause:(nonnull NSNumber *)reactTag)
RCT_EXTERN_METHOD(seekBy:(nonnull NSNumber *)reactTag
                  delta:(double)delta)

RCT_EXTERN_METHOD(sendChat:(nonnull NSNumber *)reactTag
                  message:(NSString *)message
                  eventId:(nullable NSNumber *)eventId)

// MARK: - New commands per spec §Player Public methods

RCT_EXTERN_METHOD(skipStart:(nonnull NSNumber *)reactTag)
RCT_EXTERN_METHOD(cancelAutoNext:(nonnull NSNumber *)reactTag)
RCT_EXTERN_METHOD(requestEventJoin:(nonnull NSNumber *)reactTag
                  eid:(nonnull NSNumber *)eid
                  keyword:(NSString *)keyword)
RCT_EXTERN_METHOD(requestViewCart:(nonnull NSNumber *)reactTag
                  productId:(nullable NSString *)productId)
RCT_EXTERN_METHOD(reportEventStay:(nonnull NSNumber *)reactTag
                  eventId:(nonnull NSNumber *)eventId
                  stayTime:(nullable NSNumber *)stayTime)
RCT_EXTERN_METHOD(requestAwardClaim:(nonnull NSNumber *)reactTag
                  winner:(NSDictionary *)winner
                  contact:(nullable NSDictionary *)contact)
RCT_EXTERN_METHOD(minimize:(nonnull NSNumber *)reactTag)
RCT_EXTERN_METHOD(expand:(nonnull NSNumber *)reactTag)

// MARK: - Sub-component simulate* commands (expand-simulate-bridge-parity)

// ChatView
RCT_EXTERN_METHOD(chatView_simulateSendTap:(nonnull NSNumber *)reactTag
                  text:(NSString *)text
                  eventId:(nullable NSNumber *)eventId)
RCT_EXTERN_METHOD(chatView_simulateLoadHistoryTap:(nonnull NSNumber *)reactTag)
RCT_EXTERN_METHOD(chatView_simulateEventJoinTap:(nonnull NSNumber *)reactTag
                  eid:(nonnull NSNumber *)eid
                  keyword:(NSString *)keyword)

// ProductOverlayView
RCT_EXTERN_METHOD(productOverlay_simulateProductTap:(nonnull NSNumber *)reactTag
                  product:(NSDictionary *)product)
RCT_EXTERN_METHOD(productOverlay_simulatePushCardDismiss:(nonnull NSNumber *)reactTag)
RCT_EXTERN_METHOD(productOverlay_simulatePanelToggle:(nonnull NSNumber *)reactTag)

// ProductListPanel
RCT_EXTERN_METHOD(productListPanel_simulateProductTap:(nonnull NSNumber *)reactTag
                  product:(NSDictionary *)product)
RCT_EXTERN_METHOD(productListPanel_simulateAddCart:(nonnull NSNumber *)reactTag
                  product:(NSDictionary *)product
                  spec:(nullable NSDictionary *)spec)
RCT_EXTERN_METHOD(productListPanel_simulateRestockNotice:(nonnull NSNumber *)reactTag
                  product:(NSDictionary *)product)

// OperationPanelView
RCT_EXTERN_METHOD(operationPanel_simulateGoodsTap:(nonnull NSNumber *)reactTag)
RCT_EXTERN_METHOD(operationPanel_simulateChatToggleTap:(nonnull NSNumber *)reactTag)
RCT_EXTERN_METHOD(operationPanel_simulateLikeTap:(nonnull NSNumber *)reactTag)
RCT_EXTERN_METHOD(operationPanel_simulateShareTap:(nonnull NSNumber *)reactTag)
RCT_EXTERN_METHOD(operationPanel_simulateSubtitleToggleTap:(nonnull NSNumber *)reactTag)
RCT_EXTERN_METHOD(operationPanel_simulateServiceLinkTap:(nonnull NSNumber *)reactTag)
RCT_EXTERN_METHOD(operationPanel_simulateMoreTap:(nonnull NSNumber *)reactTag)
RCT_EXTERN_METHOD(operationPanel_simulateGuestNameEditTap:(nonnull NSNumber *)reactTag)
RCT_EXTERN_METHOD(operationPanel_simulateSkipStartTap:(nonnull NSNumber *)reactTag)
RCT_EXTERN_METHOD(operationPanel_simulateBackToLiveTap:(nonnull NSNumber *)reactTag)

// VideoInfoPanel
RCT_EXTERN_METHOD(videoInfoPanel_simulateSubscribeTap:(nonnull NSNumber *)reactTag)
RCT_EXTERN_METHOD(videoInfoPanel_simulateServiceLinkTap:(nonnull NSNumber *)reactTag)
RCT_EXTERN_METHOD(videoInfoPanel_simulateShopTap:(nonnull NSNumber *)reactTag)
RCT_EXTERN_METHOD(videoInfoPanel_simulateDismiss:(nonnull NSNumber *)reactTag)
RCT_EXTERN_METHOD(videoInfoPanel_simulateTabChange:(nonnull NSNumber *)reactTag
                  tab:(NSString *)tab)

// EndScreenView
RCT_EXTERN_METHOD(endScreen_simulateCancelTap:(nonnull NSNumber *)reactTag)
RCT_EXTERN_METHOD(endScreen_simulateHotItemTap:(nonnull NSNumber *)reactTag
                  item:(NSDictionary *)item)

@end
