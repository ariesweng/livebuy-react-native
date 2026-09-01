import Foundation
import React
import SafariServices
import UIKit
import LivebuySDK

// MARK: - LivebuyRNBridge — RCTEventEmitter module

@objc(LivebuyRNBridge)
final class LivebuyRNBridge: RCTEventEmitter {

    // Weak prevents a retain cycle: RCT bridge holds a strong ref to this module, so self must not hold back.
    @objc static weak var shared: LivebuyRNBridge?

    // MARK: - Cart callback pool (Task 4.2 / 4.4)
    //
    // RN's native↔JS bridge is fire-and-forget — there's no way to await a JS return value from native.
    // So cart events get a generated callbackId; JS replies via `resolveCartRequest:`.
    private struct PoolEntry {
        let callback: LBCartResultCallback
        let timer: DispatchSourceTimer
    }
    private var cartCallbackPool: [String: PoolEntry] = [:]
    private var poolOrder: [String] = []
    private let poolQueue = DispatchQueue(label: "tv.livebuy.rn.cartpool")

    fileprivate static let maxPoolSize = 100
    fileprivate static let callbackTtl: DispatchTimeInterval = .seconds(5)
    fileprivate static let syncInterceptorEvents: Set<String> = [
        LBEvent.authRequired,
        LBEvent.productClick,
        LBEvent.infoCustomerService,
        LBEvent.videoShareRequest,
        // rn-sync-interceptor-events-parity: mirror the native EventTypeRegistry (9 events).
        LBEvent.dismissRequest,
        LBEvent.serviceLinkRequest,
        LBEvent.guestNameEditRequest,
        LBEvent.eventJoinIntent,
        LBEvent.awardClaimIntent,
    ]

    override init() {
        super.init()
        LivebuyRNBridge.shared = self
    }

    override func supportedEvents() -> [String]! {
        return [
            "LBPlayerStateChange", "LBProductTap", "LBPollReceived", "LBError",
            "onSdkEvent", "LBMetric",
            // widget-bridge-color-core (HAND-ALIGNED — file does not compile here).
            // Carousel/grid widget web-embed colors (snake_case payload).
            "LBWidgetResponse",
            // upcoming-intro-core-rn (HAND-ALIGNED — file does not compile here).
            // Player channel-info projection for the upcoming chrome data source
            // (snake_case payload `{ publish_at, cover, start, live_status, title }`).
            "LBPlayerChannelInfo",
        ]
    }

    override static func requiresMainQueueSetup() -> Bool { return true }

    // MARK: - Module methods (called from JS)

    @objc func configure(
        _ apiKey: NSNumber, secret: String, shopId: String, lang: String?,
        displayName: String?, avatarUrl: String?, externalUserId: String?,
        autoPipOnIntercept: Bool,
        apiVersion: NSNumber, configFetchTimeoutMs: NSNumber,
        enableConversionAttribution: Bool,
        // power-profile-adaptation (第 5 支 parity): opt-out, default true — 12th positional arg
        // from JS, forwarded to Livebuy.configure(...enablePowerProfileAdaptation:). Native owns adaptation.
        enablePowerProfileAdaptation: Bool,
        // sdk-stat-reporting (rn-stat-reporting-core): opt-in, default false — 13th positional arg
        // from JS, forwarded to Livebuy.configure(...enableStatReporting:). Native owns all /stat sending.
        enableStatReporting: Bool,
        // sdk-stat-endpoint-environment-selection-core (rn-stat-environment-forward-core)
        // + sdk-data-api-environment-selection-core: SDK-wide environment wire string,
        // default "production" — 14th positional arg from JS. Mapped to the native
        // LBEnvironment (unknown / anything but "develop" → .production) and forwarded to
        // Livebuy.configure(...environment:); native selects BOTH the data API base URL and
        // the /stat endpoint. RN never resolves a URL itself.
        environment: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        // rn-configure-external-user-id-parity: include externalUserId so configure-time member-id
        // binding reaches parity with iOS/Android/Flutter (mirrors setUser). Gate widened so a user
        // carrying ONLY an externalUserId still constructs an LBUser.
        let user: LBUser? = (displayName != nil || avatarUrl != nil || externalUserId != nil)
            ? LBUser(displayName: displayName ?? "", avatarUrl: avatarUrl, externalUserId: externalUserId)
            : nil
        // rn-stat-environment-forward-core: map the JS wire string → native LBEnvironment.
        // Unknown / anything but "develop" falls back to .production (source-compatible safe default).
        let env: LBEnvironment = (environment == "develop") ? .develop : .production
        Task {
            do {
                try await Livebuy.configure(
                    apiKey: apiKey.intValue, secret: secret, shopId: shopId, lang: lang,
                    user: user, autoPipOnIntercept: autoPipOnIntercept,
                    apiVersion: apiVersion.intValue,
                    configFetchTimeoutMs: configFetchTimeoutMs.intValue,
                    enableConversionAttribution: enableConversionAttribution,
                    enablePowerProfileAdaptation: enablePowerProfileAdaptation,
                    enableStatReporting: enableStatReporting,
                    environment: env
                )
                resolve(nil)
            } catch LBSDKError.notConfigured {
                reject("NOT_CONFIGURED", "HMAC / apiKey rejected by server", nil)
            } catch {
                reject("CONFIGURE_ERROR", error.localizedDescription, error)
            }
        }
    }

    // MARK: - Conversion attribution bridge (conversion-attribution-context-rn)

    @objc func captureAdClick(_ url: String) {
        guard let parsed = URL(string: url) else { return }
        Livebuy.captureAdClick(url: parsed)
    }

    @objc func setFbclid(_ fbclid: String) {
        Livebuy.setFbclid(fbclid)
    }

    @objc func setReferer(_ referer: String?) {
        Livebuy.setReferer(referer)
    }

    @objc func clearAttributionContext() {
        Livebuy.clearAttributionContext()
    }

    // MARK: - Stat reporting bridge (sdk-stat-reporting, rn-stat-reporting-core)

    // Erase persisted `/stat` state (video_people per-day dedupe + in-memory retention)
    // for a host privacy / erasure request. Native owns all /stat state; mirrors
    // clearAttributionContext.
    @objc func clearStatContext() {
        Livebuy.clearStatContext()
    }

    @objc func currentFbc(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        resolve(Livebuy.currentFbc())
    }

    @objc func currentFbp(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        resolve(Livebuy.currentFbp())
    }

    // MARK: - Power profile (power-profile-adaptation, 第 5 支 parity)

    // Read the current thermal power-profile tier. Resolves the native wire name
    // (`full` / `reduced` / `conservative` / `survival`); never null (native getter
    // returns `.full` when adaptation is disabled / dormant). Mirrors currentFbp.
    @objc func currentPowerProfile(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        resolve(Livebuy.currentPowerProfile.wireName)
    }

    @objc func isLoggedIn(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        resolve(Livebuy.isLoggedIn)
    }

    // MARK: - boundMemberId (bind-session-transition-idempotent-rn-core)

    @objc func boundMemberId(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        resolve(Livebuy.boundMemberId)
    }

    // MARK: - activeEvents accessor (active-event-accessor-rn-core)
    //
    // View-scoped Promise accessor: read-only snapshot of the current in-progress
    // live events for the player addressed by `reactTag`. Unlike the fire-and-forget
    // simulate*/command paths (dispatchViewManagerCommand → ViewManager), an accessor
    // needs a return value, so it is a Promise-returning module method keyed by
    // reactTag. Resolves the wrapped VC's `activeEvents()` snapshot serialized to the
    // wire shape below; view gone / wrong type → resolve `[]`. Mirrors the ViewManager's
    // `withView` bridge.uiManager lookup (UIKit view access must run on the main thread).
    @objc func activeEvents(
        _ reactTag: NSNumber,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async {
            guard let view = self.bridge?.uiManager?.view(forReactTag: reactTag) as? LivebuyPlayerRNView else {
                resolve([])
                return
            }
            resolve(view.activeEvents().map { LivebuyRNBridge.activeEventBody($0) })
        }
    }

    // MARK: - setGuestNicknameVerified bridge (guest-nickname-checkname-on-set-rn
    //         + guest-nickname-verified-fails-loudly-rn)
    //
    // Promise-returning parity of core's `LivebuyPlayerViewController.setGuestNicknameVerified(_:)`
    // (guest-nickname-checkname-on-set-core). Unlike the existing fire-and-forget
    // `setGuestNickname` (module method below, unverified — calls `Livebuy.setGuestNickname`
    // directly, no player context, no validation), this is a View-scoped Promise accessor
    // keyed by reactTag (same shape as `activeEvents` above) because the caller needs a
    // differentiated result: success / taken / never-sent / other error.
    //
    // guest-nickname-verified-fails-loudly-rn: RESOLVE ⟺ THE NICKNAME WAS COMMITTED.
    // Every path that did not complete the commit rejects — there is deliberately no
    // path that resolves without having persisted + broadcast, because resolve is the
    // caller's ONLY success signal (the turnkey container dismisses the nickname modal,
    // opens the composer and completes a pending「加入活動」join on it).
    //
    // Four reject codes:
    //   • "guestNameTaken" reuses the EXACT wire spelling already used for this
    //     identical underlying core error on the existing `LBError` chat-error EVENT
    //     channel (`emitError`'s `case .guestNameTaken: body = ["type": "guestNameTaken"]`)
    //     — same error, different transport.
    //   • "nicknameSetPreconditionFailed" mirrors core's `LBError.nicknameSetPreconditionFailed`
    //     (blank name / no video loaded — checkName was NEVER SENT) and ALSO covers the
    //     two bridging cases core cannot see: the reactTag resolves to no view / a wrong
    //     type, and the resolved view has no `playerVC` yet. ONE code for all of them:
    //     the caller's REMEDY is identical (nothing sent, no server ruling, nothing
    //     committed, and retrying blind will not help). NOT because every one of those
    //     conditions is observable by the caller — `playerVC` is private and built
    //     lazily in `load()`, and an unresolvable reactTag is a pure native-side race.
    //     Which one it was goes in the MESSAGE (free text, not contract).
    //   • "NOT_CONFIGURED" mirrors core's `LBSDKError.notConfigured`, reusing the
    //     spelling this file ALREADY uses for that same error on five other Promise
    //     methods (configure / getSdkConfig / refreshConfig / fetchLatestLive /
    //     fetchWidget) — deliberately NOT a new lowerCamel synonym for an error that
    //     already has one authoritative wire string here.
    //   • "LB_ERROR" is this file's existing dominant fallback reject code (login /
    //     bindSession / reportCartTrack / setAwaitGoods / …) for anything else.
    //
    // View not found → REJECT (it used to `resolve(nil)`). This deliberately does NOT
    // mirror `activeEvents`'s `resolve([])` fallback any more: `activeEvents` is a READ,
    // where an empty snapshot is a truthful answer, whereas setting a nickname is a
    // WRITE — a write that did not happen must not be reported as success. Do not
    // "restore consistency" by making them the same shape again.
    @objc func setGuestNicknameVerified(
        _ reactTag: NSNumber,
        name: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async {
            guard let view = self.bridge?.uiManager?.view(forReactTag: reactTag) as? LivebuyPlayerRNView else {
                reject("nicknameSetPreconditionFailed",
                       "setGuestNicknameVerified: the reactTag does not resolve to a mounted Livebuy player view — nothing was submitted.",
                       nil)
                return
            }
            Task {
                do {
                    try await view.setGuestNicknameVerified(name)
                    resolve(nil)
                } catch LBError.guestNameTaken {
                    reject("guestNameTaken", "Nickname is already taken", nil)
                } catch LBError.nicknameSetPreconditionFailed {
                    reject("nicknameSetPreconditionFailed",
                           "setGuestNicknameVerified: a precondition was not met (blank name, or no video loaded yet) — checkName was never sent.",
                           nil)
                } catch LBSDKError.notConfigured {
                    reject("NOT_CONFIGURED", "configure() not yet called", nil)
                } catch {
                    reject("LB_ERROR", error.localizedDescription, error)
                }
            }
        }
    }

    /// Serialize an `LBActiveEvent` to the RN bridge wire dict — EQUIVALENT to the SDK's
    /// internal `LivebuyPlayerViewController.activeEventParams(_:)` (that helper is `internal`,
    /// so it is not reachable from this separate bridge module). `keyword` is OMITTED when nil
    /// or empty (「無可參加 keyword」); `stayTime` is EXCLUDED (turnkey internal dwell gate, not
    /// host UI info). `award` reuses the `{type,name,code}` winner-award structure.
    private static func activeEventBody(_ event: LBActiveEvent) -> [String: Any] {
        var body: [String: Any] = [
            "id": event.id,
            "title": event.title,
            "duration": event.duration,
            "surplus": event.surplus,
            "award": event.award.map { ["type": $0.type, "name": $0.name, "code": $0.code] },
        ]
        if let keyword = event.keyword, !keyword.isEmpty { body["keyword"] = keyword }
        return body
    }

    // MARK: - sdk-config bridge (add-sdk-config-transport, task 3.2)

    @objc func getSdkConfig(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        do {
            let config = try Livebuy.sdkConfig()
            resolve(config.toEventDict())
        } catch LBSDKError.notConfigured {
            reject("NOT_CONFIGURED", "configure() not yet called", nil)
        } catch {
            reject("GET_CONFIG_ERROR", error.localizedDescription, error)
        }
    }

    @objc func refreshConfig(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        Task {
            do {
                try await Livebuy.refreshConfig()
                resolve(nil)
            } catch LBSDKError.notConfigured {
                reject("NOT_CONFIGURED", "configure() not yet called", nil)
            } catch {
                reject("REFRESH_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc func registerListener() {
        Livebuy.setEventListener(BridgeListener.shared)
    }

    @objc func unregisterListener() {
        Livebuy.setEventListener(nil)
    }

    // MARK: - In-app browser (fix-ui-template-default-parity-core)
    //
    // Navigation tool for the template layer (`livebuy-react-native-ui`). Presents an
    // SFSafariViewController over the top-most VC so the user stays in-app (the live
    // keeps playing behind it; the user can swipe back). Headless contract: SDK core
    // MUST NOT call this itself — only the UI template does, and only when the host
    // has not intercepted `productTap`. Empty / malformed URLs are a safe no-op.
    @objc func openInAppBrowser(_ url: String) {
        // URL(string:) returns nil for empty / malformed input — safe no-op (spec rn-inapp-browser).
        guard let parsed = URL(string: url) else { return }
        DispatchQueue.main.async {
            guard let presenter = LivebuyRNBridge.topMostViewController() else { return }
            presenter.present(SFSafariViewController(url: parsed), animated: true)
        }
    }

    /// Walks from the key window's root VC down the presentation chain to the VC that
    /// should present the in-app browser. Returns nil when there is no key window.
    private static func topMostViewController() -> UIViewController? {
        let keyWindow = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }
        var top = keyWindow?.rootViewController
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }

    @objc func clearUser() {
        Livebuy.clearUser()
    }

    @objc func setUser(_ map: NSDictionary) {
        guard let displayName = map["displayName"] as? String else { return }
        let avatarUrl = map["avatarUrl"] as? String
        let externalUserId = map["externalUserId"] as? String
        Livebuy.setUser(LBUser(displayName: displayName, avatarUrl: avatarUrl, externalUserId: externalUserId))
    }

    // Set the GUEST's 留言暱稱 WITHOUT logging in (guest-nickname capability; parity native iOS).
    @objc func setGuestNickname(_ name: String) {
        Livebuy.setGuestNickname(name)
    }

    @objc func setLanguage(_ lang: String) {
        Livebuy.setLanguage(lang)
    }

    @objc func notifyCheckoutCompleted(
        _ orderId: String, sdkTrackCodes: [String], items: [NSDictionary]?
    ) {
        let mapped: [LBCheckoutItem]? = items?.compactMap { dict in
            guard let pid = dict["productId"] as? String else { return nil }
            let qty = (dict["quantity"] as? Int) ?? 1
            let priceNumber: NSDecimalNumber? = (dict["price"] as? NSNumber).map {
                NSDecimalNumber(decimal: $0.decimalValue)
            }
            let currency = dict["currency"] as? String
            return LBCheckoutItem(productId: pid, quantity: qty, price: priceNumber, currency: currency)
        }
        Livebuy.notifyCheckoutCompleted(orderId: orderId, sdkTrackCodes: sdkTrackCodes, items: mapped)
    }

    @objc func flushPendingEvents(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        Task {
            do {
                let result = try await Livebuy.flushPendingEvents()
                resolve([
                    "status": result.status,
                    "uploadedCount": result.uploadedCount,
                    "remainingCount": result.remainingCount,
                    "elapsedMs": result.elapsedMs,
                ])
            } catch {
                reject("FLUSH_ERROR", error.localizedDescription, error)
            }
        }
    }

    // MARK: - fetchLatestLive

    @objc func fetchLatestLive(
        _ id: String, ty: String?,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        Task {
            do {
                // `ty` is optional — when JS omits it (nil here), core sends no `ty`.
                if let item = try await Livebuy.fetchLatestLive(id: id, ty: ty) {
                    resolve(Self.serializeVideoItem(item))
                } else {
                    resolve(nil)
                }
            } catch LBSDKError.notConfigured {
                reject("NOT_CONFIGURED", "configure() not yet called", nil)
            } catch {
                reject("FETCH_LATEST_LIVE_ERROR", error.localizedDescription, error)
            }
        }
    }

    // MARK: - fetchWidget (fetch-widget-content)

    /// Headless one-shot `POST /sdk/widget` fetch for the RN drop-in widget
    /// container. Flattens the core `LBWidgetResponse` into a snake_case map whose
    /// keys match `react-native-ui` `decodeWidgetSnapshot` (`videos` /
    /// `current_page` / `last_page`) plus the web-embed colors (`widget_color` /
    /// `widget_bgcolor`, the latter omitted when nil) and the carousel product-card
    /// display mode (`product_card`, likewise omitted when nil). `videos` entries
    /// reuse the shared camelCase `serializeVideoItem`.
    ///
    /// widget-product-card-bridge-rn — `product_card` is RAW PASSTHROUGH of the core
    /// `LBWidgetResponse.productCard` (`String?`, backend domain `below` / `inside` /
    /// `hidden`). The key is OMITTED when core is nil, which JS reads back as
    /// `undefined` and normalizes to `null`. The backend default `"inside"` is
    /// DELIBERATELY NOT substituted here: "the backend sent nothing" (linetv branch)
    /// and "the backend sent inside" are different facts, and flattening them here
    /// makes them indistinguishable for every downstream consumer. Applying a default
    /// is the UI layer's job.
    @objc func fetchWidget(
        _ id: String, page: NSNumber,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        Task {
            do {
                let response = try await Livebuy.fetchWidget(id: id, page: page.intValue)
                var map: [String: Any] = [
                    "videos": response.videos.data.map { Self.serializeVideoItem($0) },
                    "current_page": response.videos.currentPage,
                    "last_page": response.videos.lastPage,
                    "widget_color": response.widgetColor,
                ]
                if let bgcolor = response.widgetBgcolor { map["widget_bgcolor"] = bgcolor }
                if let productCard = response.productCard { map["product_card"] = productCard }
                resolve(map)
            } catch LBSDKError.notConfigured {
                reject("NOT_CONFIGURED", "configure() not yet called", nil)
            } catch {
                reject("FETCH_WIDGET_ERROR", error.localizedDescription, error)
            }
        }
    }

    /// Serialize an `LBVideoItem` into the camelCase bridge map shared by
    /// `fetchLatestLive` and the `fetchWidget` `videos[]` entries.
    private static func serializeVideoItem(_ item: LBVideoItem) -> [String: Any] {
        var map: [String: Any] = [
            "id": item.id,
            "type": item.type,
            "title": item.title,
            "cover": item.cover,
            "preview": item.preview,
            "duration": item.duration,
            "publishAt": item.publishAt,
            "watchNum": item.watchNum,
            "pvNum": item.pvNum,
            "liveStatus": item.liveStatus,
            "pin": item.pin,
            "showPvNum": item.showPvNum,
            "liveurl": item.liveurl,
            "playbackurl": item.playbackurl,
            "previewTime": item.previewTime,
            "showStock": item.showStock,
        ]
        if let sessionName = item.sessionName { map["sessionName"] = sessionName }
        return map
    }

    // MARK: - login (login-session-token-core)

    @objc func login(
        _ memberId: String, memberName: String?,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        Task {
            do {
                try await Livebuy.login(memberId: memberId, memberName: memberName)
                resolve(nil)
            } catch {
                reject("LB_ERROR", error.localizedDescription, error)
            }
        }
    }

    // MARK: - bindSession / isLoggedIn (auth-bind-session-ergonomics)

    @objc func bindSession(
        _ memberId: String, memberName: String?, avatarUrl: String?,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        Task {
            do {
                try await Livebuy.bindSession(
                    memberId: memberId, memberName: memberName, avatarUrl: avatarUrl)
                resolve(nil)
            } catch {
                reject("LB_ERROR", error.localizedDescription, error)
            }
        }
    }

    // MARK: - addToCart (video-addcart-endpoint-core, 路線 B)

    @objc func addToCart(
        _ options: NSDictionary,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard let shopId = options["shopId"] as? String else {
            reject("LB_ERROR", "addToCart requires shopId", nil)
            return
        }
        let goodsId = (options["goodsId"] as? NSNumber)?.intValue
        let num = (options["num"] as? NSNumber)?.intValue
        let specificationId = (options["specificationId"] as? NSNumber)?.intValue
        let ids = (options["ids"] as? [NSNumber])?.map { $0.intValue }
        let live = (options["live"] as? NSNumber)?.intValue
        let isLive = (options["isLive"] as? NSNumber)?.intValue
        let isWidget = (options["isWidget"] as? NSNumber)?.intValue
        let inDomain = (options["inDomain"] as? NSNumber)?.intValue
        let userid = options["userid"] as? String
        let thirdpartyUserId = options["thirdpartyUserId"] as? String
        let buyingId = (options["buyingId"] as? NSNumber)?.intValue
        let eventId = (options["eventId"] as? NSNumber)?.intValue
        let guestName = options["guestName"] as? String
        let dbsc = options["dbsc"] as? String
        let videoId = options["videoId"] as? String
        Task {
            do {
                let result = try await Livebuy.addToCart(
                    shopId: shopId, goodsId: goodsId, num: num,
                    specificationId: specificationId, ids: ids,
                    live: live, isLive: isLive, isWidget: isWidget,
                    inDomain: inDomain, userid: userid,
                    thirdpartyUserId: thirdpartyUserId, buyingId: buyingId,
                    eventId: eventId, guestName: guestName, dbsc: dbsc,
                    videoId: videoId)
                var out: [String: Any] = [
                    "goodsNo": result.goodsNo,
                    "specificationNo": result.specificationNo,
                    "buyNo": result.buyNo,
                ]
                // addcart-track ④ — 回應含 track 時附帶（{mode, level?, fields:[{key,value}]}）；
                // 缺 track → 維持四欄向後相容。鏡像核心 CART_ADD_RESULT 的 track 序列化。
                if let track = result.track {
                    var trackDict: [String: Any] = [
                        "mode": track.mode.rawValue,
                        "fields": track.fields.map { ["key": $0.key, "value": $0.value] },
                    ]
                    if let level = track.level { trackDict["level"] = level }
                    out["track"] = trackDict
                }
                resolve(out)
            } catch let lbError as LBError {
                // cart-add-tier2-unify: a 30s 重複加購 dedupe-hit → reject code
                // `cart_add_deduplicated` so JS maps the typed `{ type: 'cartAddDeduplicated' }`
                // (host treats it as「已加入購物車」). serverError code (e.g. 401 for an empty
                // buy_no) → reject with that code so JS branches needs-login vs failure.
                if case .cartAddDeduplicated = lbError {
                    reject("cart_add_deduplicated", "Add-to-cart deduplicated (already added within 30 s).", lbError)
                } else if case .serverError(let code, let message) = lbError {
                    reject(String(code), message, lbError)
                } else {
                    reject("LB_ERROR", lbError.localizedDescription, lbError)
                }
            } catch {
                reject("LB_ERROR", error.localizedDescription, error)
            }
        }
    }

    // MARK: - reportCartTrack (addcart-track ④, POST /sdk/video/addcart/track)

    /// token 平台結帳前回報自家 cart token（`track.mode == .token`）。委派 native
    /// `Livebuy.reportCartTrack(shopId:buyNo:trackId:)`（conditional token、不自建 HTTP）。
    @objc func reportCartTrack(
        _ shopId: String, buyNo: String, trackId: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        Task {
            do {
                try await Livebuy.reportCartTrack(shopId: shopId, buyNo: buyNo, trackId: trackId)
                resolve(nil)
            } catch {
                reject("LB_ERROR", error.localizedDescription, error)
            }
        }
    }

    // MARK: - goods tracking (goods-await-notice-endpoints-core)

    @objc func setAwaitGoods(
        _ goodsGpn: String, enabled: Bool,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        Task {
            do {
                try await Livebuy.setAwaitGoods(goodsGpn: goodsGpn, enabled: enabled)
                resolve(nil)
            } catch {
                reject("LB_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc func setNoticeGoods(
        _ goodsGpn: String, enabled: Bool,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        Task {
            do {
                try await Livebuy.setNoticeGoods(goodsGpn: goodsGpn, enabled: enabled)
                resolve(nil)
            } catch {
                reject("LB_ERROR", error.localizedDescription, error)
            }
        }
    }

    // MARK: - Cart resolve (Task 4.2)

    @objc func resolveCartRequest(
        _ callbackId: String, success: Bool,
        appTrackCode: String?, errorCode: String?, errorMessage: String?
    ) {
        var entry: PoolEntry?
        poolQueue.sync {
            entry = cartCallbackPool.removeValue(forKey: callbackId)
            if let idx = poolOrder.firstIndex(of: callbackId) { poolOrder.remove(at: idx) }
        }
        guard let e = entry else { return }
        e.timer.cancel()

        if success {
            e.callback.onSuccess(appTrackCode: appTrackCode ?? "")
        } else {
            e.callback.onFailure(errorCode: errorCode ?? "unknown", message: errorMessage ?? "")
        }
    }

    // MARK: - Pool helpers (called by BridgeListener)

    fileprivate func registerCart(callback: LBCartResultCallback) -> String {
        let id = UUID().uuidString
        var droppedDueToLRU = false

        poolQueue.sync {
            // LRU evict when full
            while cartCallbackPool.count >= LivebuyRNBridge.maxPoolSize {
                guard let oldest = poolOrder.first else { break }
                poolOrder.removeFirst()
                cartCallbackPool.removeValue(forKey: oldest)?.timer.cancel()
                droppedDueToLRU = true
            }

            let timer = DispatchSource.makeTimerSource(queue: poolQueue)
            timer.schedule(deadline: .now() + LivebuyRNBridge.callbackTtl)
            timer.setEventHandler { [weak self] in
                guard let self else { return }
                self.poolQueue.sync {
                    self.cartCallbackPool.removeValue(forKey: id)
                    if let idx = self.poolOrder.firstIndex(of: id) { self.poolOrder.remove(at: idx) }
                }
                timer.cancel()
            }
            timer.resume()

            cartCallbackPool[id] = PoolEntry(callback: callback, timer: timer)
            poolOrder.append(id)
        }

        if droppedDueToLRU {
            sendEvent(withName: "LBMetric", body: [
                "name": "client_drop", "reason": "callback_pool_full",
            ])
        }
        return id
    }

    // MARK: - Emit helpers (called from LivebuyPlayerRNView)
    // Events flow through the module, not the view, because JS sets up NativeEventEmitter(NativeModules.LivebuyRNBridge).

    func emitStateChange(_ state: LBPlayerState) {
        let raw: String
        switch state {
        case .loading: raw = "loading"
        case .buffering: raw = "buffering"
        case .playing: raw = "playing"
        case .paused: raw = "paused"
        case .ended: raw = "ended"
        case .error: raw = "error"
        // MARK: - decouple-ui-from-logic sub-states
        case .awaitingLive: raw = "awaitingLive"
        case .startScreenPlaying: raw = "startScreenPlaying"
        case .endScreenShown: raw = "endScreenShown"
        }
        sendEvent(withName: "LBPlayerStateChange", body: raw)
    }

    /// Serialize a full `LBProduct` to a camelCase bridge map (product-bridge-data-core's
    /// 23-field projection). Extracted from `emitProductTap` (vod-narrating-products-core-rn)
    /// so the new `vodActiveProducts` filtering input — the raw products snapshot forwarded
    /// alongside `LBPlaybackProgressChange` — reuses the SAME wire shape instead of drifting.
    /// `price` / `originalPrice` carried as String per §price 精度 (RN host self-parses).
    /// `originalPrice == nil` → NSNull (JS `null`). add-product-video-id-core-rn: `videoId`
    /// (24th field) is OMITTED from the body entirely when nil (main `goods[]` items) rather
    /// than sent as NSNull — JS sees `videoId` as optional/`undefined`, not nullable, per
    /// component-contracts §"other_goods 含 video_id 欄位" 落地現況(RN).
    private func lbProductToBody(_ product: LBProduct) -> [String: Any] {
        var body: [String: Any] = [
            "id": product.id,
            "goodsNo": product.goodsNo,
            "goodsGpn": product.goodsGpn,
            "name": product.name,
            "price": String(product.price),
            "priceShow": product.priceShow,
            "originalPrice": product.originalPrice.map { String($0) } ?? NSNull(),
            "originalPriceShow": product.originalPriceShow,
            "stock": product.stock,
            "pic": product.pic,
            "photos": product.photos,
            "brief": product.brief,
            // add-product-description-core-rn: `description` — parallel to, distinct from,
            // `brief`. Tolerant decode already happened upstream in iOS/Android core; this
            // bridge point always has a non-null String (possibly "") to serialize, unlike
            // `videoId` which can be genuinely absent.
            "description": product.description,
            "soldOut": product.soldOut,
            "isHot": product.isHot,
            "isOutSoon": product.isOutSoon,
            "narrateStatus": product.narrateStatus,
            // Backend goods conclusion fields (goods-conclusion-fields spec;
            // native LBProduct has these as non-optional defaulted props, a9d13a7).
            "canView": product.canView,
            "canBuy": product.canBuy,
            "isNarrating": product.isNarrating,
            "needLabel": product.needLabel,
            "label": product.label,
            "isAwait": product.isAwait,
            "isAwaitNotice": product.isAwaitNotice,
            "diversionUrl": product.diversionUrl,
            "specifications": product.specifications.map { lbSpecToBody($0) },
            "specOptions": product.specOptions.map { ["name": $0.name, "child": $0.child] },
        ]
        body["beginTime"] = product.beginTime.map { $0 as Any } ?? NSNull()
        body["endTime"] = product.endTime.map { $0 as Any } ?? NSNull()
        if let videoId = product.videoId { body["videoId"] = videoId }
        return body
    }

    func emitProductTap(_ product: LBProduct) {
        sendEvent(withName: "LBProductTap", body: lbProductToBody(product))
    }

    /// Serialize an `LBSpec` to a camelCase bridge map (price as String,
    /// originalPrice → NSNull when nil). Mirrors `lbSpecFromArgs`.
    private func lbSpecToBody(_ spec: LBSpec) -> [String: Any] {
        return [
            "id": spec.id,
            "name": spec.name,
            "specificationNo": spec.specificationNo,
            "price": String(spec.price),
            "priceShow": spec.priceShow,
            "originalPrice": spec.originalPrice.map { String($0) } ?? NSNull(),
            "originalPriceShow": spec.originalPriceShow,
            "stock": spec.stock,
            "photos": spec.photos,
        ]
    }

    func emitPollReceived(_ response: LBPollResponse) {
        var body: [String: Any] = ["last": response.last]
        if let liveEnd = response.liveEnd { body["liveEnd"] = liveEnd }
        sendEvent(withName: "LBPollReceived", body: body)
    }

    // upcoming-intro-core-rn — channel-info forward (HAND-ALIGNED; not compiled
    // here). Emit a LIGHTWEIGHT projection of the loaded `LBChannel` (only the
    // fields the JS host's upcoming chrome needs) as a snake_case payload, so the
    // host can feed the `react-native-ui` template's upcoming view-model. The
    // player state `"awaitingLive"` alone cannot carry these channel fields.
    // Mirrors the `emitProductTap` snake_case style; the JS `mapPlayerChannelInfo`
    // maps it to the camelCase `LBPlayerChannelInfo` host shape.
    //
    // dropin-service-link-default-browser-core-rn: `service_link` is additive —
    // reads `channel.shop.serviceLink` off the ALREADY-passed `LBChannel` (no core
    // change needed). This is NOT a Bool-passthrough of "did the host intercept
    // INFO_CUSTOMER_SERVICE/SERVICE_LINK_REQUEST" (see design.md D1 for why that
    // doesn't work over the RN bridge) — it's the raw url so a future
    // reference-ui-rn layer can decide for itself whether to open a default
    // in-app browser via the existing `openInAppBrowser(url)`.
    //
    // rb-react-native-subtitle-channel-info-bridge-core: `subtitle_url` /
    // `is_subtitle` are additive — read off the ALREADY-passed `LBChannel` (no
    // core change needed). Purely data plumbing; VTT parsing / CC toggle wiring /
    // rendering is a separate downstream reference-ui change (Depends On this
    // one). The caller of this function was ALSO fixed (see `load(videoId:)`
    // below) to bind core's current `onChannelRefresh` — it previously bound a
    // callback name (`onChannelChange`) that never existed on
    // `LivebuyPlayerViewController`, so this whole event never fired on iOS RN.
    func emitChannelChange(_ channel: LBChannel) {
        sendEvent(withName: "LBPlayerChannelInfo", body: [
            "publish_at": channel.publishAt,
            "cover": channel.cover,
            "start": channel.start,
            "live_status": channel.liveStatus,
            "title": channel.title,
            "service_link": channel.shop.serviceLink,
            // rb-react-native-subtitle-channel-info-bridge-core — additive.
            "subtitle_url": channel.subtitleUrl,
            "is_subtitle": channel.isSubtitle,
        ])
    }

    // rn-vod-playback-progress-core — dedicated VOD playback-progress channel
    // forward (HAND-ALIGNED; not compiled here). `LBPlaybackProgress` is an
    // SDK-internal value type (never decoded from API JSON), so the wire is
    // sent CAMELCASE directly — mirrors `emitPollReceived`'s style, not
    // `emitChannelChange`'s snake_case + mapper style.
    //
    // vod-narrating-products-core-rn: `products` is a NEW additive wire key —
    // the raw, UNFILTERED products snapshot (`channel.goods`, read by the
    // caller at the moment of forward — see `onPlaybackProgressChange` wiring
    // below). RN JS computes its own `vodActiveProducts(products, position)`
    // pure filter from this (mirrors iOS/Android core's own algorithm rather
    // than trusting a second copy of it over the wire). No new native
    // computation is introduced here — this is pure wire-forwarding of
    // already-resident state, reusing `lbProductToBody` (the SAME wire shape
    // `LBProductTap` already uses).
    func emitPlaybackProgressChange(_ progress: LBPlaybackProgress, products: [LBProduct]) {
        sendEvent(withName: "LBPlaybackProgressChange", body: [
            "position": progress.position,
            "duration": progress.duration,
            "isPlaying": progress.isPlaying,
            "isReplay": progress.isReplay,
            "products": products.map { lbProductToBody($0) },
        ])
    }

    func emitError(_ error: LBError) {
        let body: [String: Any]
        switch error {
        case .restricted:        body = ["type": "restricted"]
        case .videoNotFound:     body = ["type": "videoNotFound"]
        case .invalidSignature:  body = ["type": "invalidSignature"]
        case .chatRateLimited:   body = ["type": "chatRateLimited"]
        case .guestNameTaken:    body = ["type": "guestNameTaken"]
        case .chatRequiresLogin: body = ["type": "chatRequiresLogin"]
        case .notLive:           body = ["type": "notLive"]
        case .sdkVersionUnsupported:
            body = ["type": "sdk_version_unsupported"]
        case .networkError(let underlying):
            body = ["type": "networkError", "message": underlying.localizedDescription]
        case .serverError(let code, let message):
            body = ["type": "serverError", "code": code, "message": message]
        case .loginFailed(let code, let message):
            // login() surfaces failures via the Promise reject path; this event
            // mapping is a fallback. No dedicated RN union member — map to serverError.
            body = ["type": "serverError", "code": code, "message": message]
        case .sdkConfigFetchFailed(let underlying):
            // Only ever carried inside SDK_CONFIG_LOAD_FAILED payloads; not thrown
            // by configure/refreshConfig. Fallback mapping for switch exhaustiveness.
            body = ["type": "networkError", "message": underlying?.localizedDescription ?? "config fetch failed"]
        @unknown default:
            // Future-proof: core LBError is a non-frozen public enum.
            body = ["type": "serverError", "code": -1, "message": "unknown error"]
        }
        sendEvent(withName: "LBError", body: body)
    }

    fileprivate func emitSdkEvent(_ body: [String: Any]) {
        sendEvent(withName: "onSdkEvent", body: body)
    }
}

// MARK: - BridgeListener — installs into SDK and forwards every event to JS

private final class BridgeListener: NSObject, LivebuyEventListener {
    static let shared = BridgeListener()

    func onEventTriggered(
        eventName: String,
        params: [String: Any],
        cartCallback: LBCartResultCallback?,
        shareContext: LBShareContext?
    ) -> Bool {
        guard let bridge = LivebuyRNBridge.shared else { return false }

        var payload: [String: Any] = [
            "eventName": eventName,
            "params": params,
        ]
        if let share = shareContext {
            payload["shareContext"] = [
                "defaultUrl": share.shareUrl,
                "defaultTitle": share.title,
            ]
        }
        if let cb = cartCallback {
            let id = bridge.registerCart(callback: cb)
            payload["callbackId"] = id
        }

        bridge.emitSdkEvent(payload)

        // Cart's return value is unused (SDK waits on the callback). Notifications ignore it.
        // Sync interceptors: assume JS handles since it installed a listener — async pattern.
        return LivebuyRNBridge.syncInterceptorEvents.contains(eventName)
    }
}

// MARK: - LivebuyPlayerRNView — UIView wrapping LivebuyPlayerViewController

/// Narrow, `Equatable` snapshot of ONLY the 8 fields `LBPlayerChannelInfo` projects
/// (rb-react-native-subtitle-channel-info-bridge-core §momentState dedupe). Deliberately
/// NOT a whole-`LBChannel` comparison — `LBChannel` carries many more fields (goods, nav,
/// spec, watchNum, …) that have no bearing on this projection; comparing the full model
/// would re-fire on changes this event doesn't even carry, while comparing nothing at all
/// (always emitting) would spam the RN bridge on every unrelated `onMomentStateChange`
/// publish (subtitle CC toggle, viewer-count tick, chat-visibility flip, end-screen
/// countdown tick, product-overlay updates, …) that leaves these 8 fields unchanged.
private struct ChannelInfoSnapshot: Equatable {
    let publishAt: String
    let cover: String
    let start: String
    let liveStatus: Int
    let title: String
    let serviceLink: String
    let subtitleUrl: String
    let isSubtitle: Int

    init(_ channel: LBChannel) {
        publishAt = channel.publishAt
        cover = channel.cover
        start = channel.start
        liveStatus = channel.liveStatus
        title = channel.title
        serviceLink = channel.shop.serviceLink
        subtitleUrl = channel.subtitleUrl
        isSubtitle = channel.isSubtitle
    }
}

final class LivebuyPlayerRNView: UIView {

    private var playerVC: LivebuyPlayerViewController?

    // rb-react-native-subtitle-channel-info-bridge-core — dedupe state for the
    // `onMomentStateChange`-driven `emitChannelChange` below. Reset on `unload()` /
    // `releasePlayer()` so a later reload of the byte-identical channel (rare, but
    // legitimate — e.g. re-opening the same VOD) is NOT silently swallowed by a stale
    // pre-unload snapshot.
    private var lastChannelInfoSnapshot: ChannelInfoSnapshot?

    func load(videoId: String) {
        // VC is created lazily: the React tag (and therefore stable view identity) isn't known at UIView init time.
        if playerVC == nil {
            let vc = LivebuyPlayerViewController()
            vc.onStateChange = { [weak self] state in
                LivebuyRNBridge.shared?.emitStateChange(state)
            }
            vc.onProductTap = { [weak self] product in
                LivebuyRNBridge.shared?.emitProductTap(product)
            }
            vc.onPollReceived = { [weak self] resp in
                LivebuyRNBridge.shared?.emitPollReceived(resp)
            }
            vc.onError = { [weak self] error in
                LivebuyRNBridge.shared?.emitError(error)
            }
            // upcoming-intro-core-rn — channel-info forward (HAND-ALIGNED; not
            // compiled here). Mirrors the other VC callbacks; emits the lightweight
            // channel projection for the JS host's upcoming chrome data source.
            //
            // Binds core's current callback name `onChannelRefresh` (renamed from
            // the retired/never-existent `onChannelChange` —
            // rb-react-native-subtitle-channel-info-bridge-core; mirrors the
            // Android bridge fix in archived change
            // 2026-07-11-rn-android-bridge-drift-fix-core). Same
            // `(LBChannel) -> Void` signature and「頻道刷新、不重啟播放」semantics.
            // `onChannelRefresh` only fires on the 20s LIVE periodic channel-settings
            // refresh (`applyRefreshedChannel`, gated `liveStatus == 1`) — it can
            // NEVER fire for initial load / VOD / upcoming. See the
            // `onMomentStateChange` wiring right below, which additively closes that
            // gap. Kept (not removed) for LIVE mid-stream settings changes (e.g. a
            // merchant editing `title`/`subtitle_url` while already live) — the
            // `onMomentStateChange` path below does NOT reach this call site
            // (`applyRefreshedChannel` does not call `publishMomentState()`).
            vc.onChannelRefresh = { [weak self] channel in
                self?.lastChannelInfoSnapshot = ChannelInfoSnapshot(channel)
                LivebuyRNBridge.shared?.emitChannelChange(channel)
            }
            // rb-react-native-subtitle-channel-info-bridge-core — additive coverage
            // for VOD / upcoming / initial-load channel-info emission, closing the
            // gap `onChannelRefresh` (above) structurally cannot reach.
            // `onMomentStateChange` fires unconditionally on every channel (re)load
            // (VOD/LIVE/upcoming — `configureFromChannel`'s `publishMomentState()`
            // call, `LivebuyPlayerViewController.swift:2324`) with `vc.channel`
            // ALREADY set to the just-loaded channel by the time it fires. This RN
            // bridge is free to bind it: `livebuy-react-native.podspec` depends ONLY
            // on `LivebuySDK`, never `LivebuyUI` — the native template layer that
            // exclusively claims `onMomentStateChange` for its own attachment
            // (`TemplateAttachment.swift`) is absent from this build target, so
            // there is no single-owner contention here (unlike the iOS
            // reference-ui's `rb-ios-subtitle-vtt-caption-display`, which had to
            // route around that exact contention via `DefaultPlayerTemplate.addObserver`).
            //
            // `onMomentStateChange` ALSO fires on many unrelated moment-state
            // publishes that carry the SAME channel (subtitle CC toggle,
            // viewer-count tick, chat-visibility flip, end-screen countdown tick,
            // product-overlay updates, …) — deduped via `ChannelInfoSnapshot` so
            // this doesn't turn into an unconditional-per-tick RN bridge crossing.
            // The dedupe key deliberately does NOT use video id alone: an
            // upcoming→live `liveStatus` flip (30s preview poll) keeps the same id
            // but IS a real change this event must still carry.
            vc.onMomentStateChange = { [weak self, weak vc] _ in
                guard let self = self, let vc = vc, let ch = vc.channel else { return }
                let snapshot = ChannelInfoSnapshot(ch)
                guard snapshot != self.lastChannelInfoSnapshot else { return }
                self.lastChannelInfoSnapshot = snapshot
                LivebuyRNBridge.shared?.emitChannelChange(ch)
            }
            // rn-vod-playback-progress-core — channel-info forward (HAND-
            // ALIGNED; not compiled here). Mirrors the other VC callbacks;
            // `Player.onPlaybackProgressChange` already exists on core (VOD-1,
            // archive/2026-06-08-vod-playback-progress-core).
            //
            // vod-narrating-products-core-rn: also weakly capture `vc` to read
            // `vc.channel?.goods` — the raw, unfiltered products snapshot
            // forwarded as the NEW `products` wire key (see
            // `emitPlaybackProgressChange` above). Same source
            // `productOverlayView.products` iOS core's own
            // `vodActiveProducts(products:position:)` reads.
            vc.onPlaybackProgressChange = { [weak self, weak vc] progress in
                LivebuyRNBridge.shared?.emitPlaybackProgressChange(progress, products: vc?.channel?.goods ?? [])
            }
            playerVC = vc
            addSubview(vc.view)
            vc.view.translatesAutoresizingMaskIntoConstraints = false
            NSLayoutConstraint.activate([
                vc.view.topAnchor.constraint(equalTo: topAnchor),
                vc.view.leadingAnchor.constraint(equalTo: leadingAnchor),
                vc.view.trailingAnchor.constraint(equalTo: trailingAnchor),
                vc.view.bottomAnchor.constraint(equalTo: bottomAnchor),
            ])
        }
        playerVC?.load(videoId: videoId)
    }

    func releasePlayer() {
        // Per headless contract: unload() stops PollManager / VideoStatePollManager /
        // sold-out scanner / AVPlayer / clears token. Call it before tearing
        // down the view tree to avoid timer leaks.
        playerVC?.unload()
        playerVC?.view.removeFromSuperview()
        playerVC = nil
        // rb-react-native-subtitle-channel-info-bridge-core — reset the
        // onMomentStateChange dedupe so a later reload of the byte-identical
        // channel is not silently swallowed by a stale pre-teardown snapshot.
        lastChannelInfoSnapshot = nil
    }

    func play()                    { playerVC?.play() }
    func pause()                   { playerVC?.pause() }
    func setMuted(_ muted: Bool)   { playerVC?.setMuted(muted) }
    func seek(seconds: Double)     { playerVC?.seek(seconds: seconds) }
    // rn-vod-playback-progress-core — control exits, forwarded to core's
    // existing VOD-1 `togglePlayPause()` / `seekBy(_:)`
    // (archive/2026-06-08-vod-playback-progress-core).
    func togglePlayPause()         { playerVC?.togglePlayPause() }
    func seekBy(_ delta: Double)   { playerVC?.seekBy(delta) }
    func sendChat(_ message: String, eventId: NSNumber?) {
        Task {
            try? await playerVC?.sendChat(message: message, eventId: eventId?.intValue)
        }
    }

    // MARK: - New methods per spec §Player Public methods
    func unload() {
        playerVC?.unload()
        // rb-react-native-subtitle-channel-info-bridge-core — same rationale as
        // `releasePlayer()`: `unload()` clears core's `channel` (→ `channel == nil`
        // on the next `onMomentStateChange` publish, which the guard above already
        // no-ops on) without tearing down `playerVC` itself, so a later `load()` on
        // this SAME view reusing the same channel content must not be swallowed by
        // a stale pre-unload snapshot.
        lastChannelInfoSnapshot = nil
    }
    func skipStart()                                     { playerVC?.skipStart() }
    func cancelAutoNext()                                { playerVC?.cancelAutoNext() }
    func requestEventJoin(eid: Int, keyword: String)     { playerVC?.requestEventJoin(eid: eid, keyword: keyword) }
    func reportEventStay(eventId: Int, stayTime: NSNumber?) { playerVC?.reportEventStay(eventId: eventId, stayTime: stayTime?.intValue) }
    func requestAwardClaim(winner: NSDictionary, contact: NSDictionary?) {
        guard let w = lbWinnerFromArgs(winner) else { return }
        let input = (contact?["email"] as? String).map { LBAwardClaimInput(email: $0) }
        playerVC?.requestAwardClaim(winner: w, contact: input)
    }
    func minimize()                                      { playerVC?.minimize() }
    func expand()                                        { playerVC?.expand() }

    // active-event-accessor-rn-core: read-only snapshot of the current in-progress
    // live events (直播抽獎「進行中活動」). Delegates to the wrapped VC's public
    // accessor; nil VC (not yet loaded) → empty snapshot.
    func activeEvents() -> [LBActiveEvent]                { playerVC?.activeEvents() ?? [] }

    // guest-nickname-checkname-on-set-rn: checkName-gated verified nickname set.
    // Delegates to the wrapped VC's public `setGuestNicknameVerified`.
    //
    // guest-nickname-verified-fails-loudly-rn: a nil `playerVC` (view exists, core
    // player not created yet) THROWS. It used to be `try await playerVC?.…`, whose
    // optional chaining made the whole `await` return normally — so the caller was
    // told the nickname had been set when nothing had even been attempted. That was
    // the same defect `guest-nickname-verified-fails-loudly-core` removed inside the
    // core method, duplicated one layer up: with the optional chaining in place, the
    // core fix had ZERO effect on RN.
    //
    // NOTE this deliberately does NOT mirror `activeEvents()` above, which keeps its
    // `?? []` fallback: `activeEvents` is a READ (an empty snapshot is a truthful
    // answer for a player that does not exist yet), while setting a nickname is a
    // WRITE (a write that did not happen must not report success). The two are not
    // the same shape ON PURPOSE — do not "unify" them.
    func setGuestNicknameVerified(_ name: String) async throws {
        guard let vc = playerVC else { throw LBError.nicknameSetPreconditionFailed }
        try await vc.setGuestNicknameVerified(name)
    }

    // MARK: - Sub-component simulate* dispatch (expand-simulate-bridge-parity)

    // ChatView (3)
    func chatView_simulateSendTap(text: String, eventId: NSNumber?) {
        playerVC?.chatView.simulateSendTap(text: text, eventId: eventId?.intValue)
    }
    func chatView_simulateLoadHistoryTap() {
        playerVC?.chatView.simulateLoadHistoryTap()
    }
    func chatView_simulateEventJoinTap(eid: Int, keyword: String) {
        playerVC?.chatView.simulateEventJoinTap(eid: eid, keyword: keyword)
    }

    // ProductOverlayView (3)
    func productOverlay_simulateProductTap(_ map: NSDictionary) {
        guard let p = lbProductFromArgs(map) else { return }
        playerVC?.productOverlayView.simulateProductTap(p)
    }
    func productOverlay_simulatePushCardDismiss() {
        playerVC?.productOverlayView.simulatePushCardDismiss()
    }
    func productOverlay_simulatePanelToggle() {
        playerVC?.productOverlayView.simulatePanelToggle()
    }

    // ProductListPanel (3)
    func productListPanel_simulateProductTap(_ map: NSDictionary) {
        guard let p = lbProductFromArgs(map) else { return }
        playerVC?.productListPanel.simulateProductTap(p)
    }
    func productListPanel_simulateAddCart(_ map: NSDictionary, specMap: NSDictionary?) {
        guard let p = lbProductFromArgs(map) else { return }
        let spec = specMap.flatMap { lbSpecFromArgs($0) }
        playerVC?.productListPanel.simulateAddCart(p, selectedSpec: spec)
    }
    func productListPanel_simulateRestockNotice(_ map: NSDictionary) {
        guard let p = lbProductFromArgs(map) else { return }
        playerVC?.productListPanel.simulateRestockNotice(p)
    }

    // OperationPanelView (10)
    func operationPanel_simulateGoodsTap()           { playerVC?.operationPanelView.simulateGoodsTap() }
    func operationPanel_simulateChatToggleTap()      { playerVC?.operationPanelView.simulateChatToggleTap() }
    func operationPanel_simulateLikeTap()            { playerVC?.operationPanelView.simulateLikeTap() }
    func operationPanel_simulateShareTap()           { playerVC?.operationPanelView.simulateShareTap() }
    func operationPanel_simulateSubtitleToggleTap()  { playerVC?.operationPanelView.simulateSubtitleToggleTap() }
    func operationPanel_simulateServiceLinkTap()     { playerVC?.operationPanelView.simulateServiceLinkTap() }
    func operationPanel_simulateMoreTap()            { playerVC?.operationPanelView.simulateMoreTap() }
    func operationPanel_simulateGuestNameEditTap()   { playerVC?.operationPanelView.simulateGuestNameEditTap() }
    func operationPanel_simulateSkipStartTap()       { playerVC?.operationPanelView.simulateSkipStartTap() }
    func operationPanel_simulateBackToLiveTap()      { playerVC?.operationPanelView.simulateBackToLiveTap() }

    // VideoInfoPanel (5)  — iOS property name is `infoPanel`
    func videoInfoPanel_simulateSubscribeTap()       { playerVC?.infoPanel.simulateSubscribeTap() }
    func videoInfoPanel_simulateServiceLinkTap()     { playerVC?.infoPanel.simulateServiceLinkTap() }
    func videoInfoPanel_simulateShopTap()            { playerVC?.infoPanel.simulateShopTap() }
    func videoInfoPanel_simulateDismiss()            { playerVC?.infoPanel.simulateDismiss() }
    func videoInfoPanel_simulateTabChange(tab: String) {
        let t: VideoInfoPanel.Tab = tab == "notice" ? .notice : .info
        playerVC?.infoPanel.simulateTabChange(to: t)
    }

    // EndScreenView (2)
    func endScreen_simulateCancelTap() {
        playerVC?.endScreenView.simulateCancelTap()
    }
    func endScreen_simulateHotItemTap(_ map: NSDictionary) {
        guard let item = lbHotItemFromArgs(map) else { return }
        playerVC?.endScreenView.simulateHotItemTap(item)
    }
}

// MARK: - Bridge deserializers (expand-simulate-bridge-parity)
//
// These convert camelCase bridge args (as serialized by emitProductTap etc.)
// back into SDK model structs. Fields not transmitted by the bridge default
// to zero/empty — adequate for simulate* intent signals that only need to
// trigger the callback chain, not reflect accurate product catalogue data.

private func lbProductFromArgs(_ map: NSDictionary) -> LBProduct? {
    guard let id = map["id"] as? String else { return nil }
    // product-bridge-data-core: stop hardcoding 0/[]. Read the full field set
    // from the camelCase bridge map; only fall back when a key is absent.
    // The INTERNAL DTO JSON below stays snake_case (iOS roundtrip trick) — that
    // is NOT the wire; the bridge wire keys are camelCase (read from `map`).
    var json: [String: Any] = [
        "id": id,
        "goods_no": map["goodsNo"] as? String ?? "",
        "goods_gpn": map["goodsGpn"] as? String ?? "",
        "name": map["name"] as? String ?? "",
        "price": rnDouble(map["price"]) ?? 0.0,
        "price_show": map["priceShow"] as? String ?? "",
        "original_price_show": map["originalPriceShow"] as? String ?? "",
        "stock": rnInt(map["stock"]) ?? 0,
        "pic": map["pic"] as? String ?? "",
        "photos": rnStringArray(map["photos"]),
        "brief": map["brief"] as? String ?? "",
        // add-product-description-core-rn: JS -> native reverse path (simulate* test hook),
        // same missing-key-tolerant style as `brief`.
        "description": map["description"] as? String ?? "",
        "sold_out": rnIntFlag(map["soldOut"]),
        "is_hot": rnIntFlag(map["isHot"]),
        "is_out_soon": rnIntFlag(map["isOutSoon"]),
        "narrate_status": rnInt(map["narrateStatus"]) ?? 0,
        "is_await": rnIntFlag(map["isAwait"]),
        "is_await_notice": rnIntFlag(map["isAwaitNotice"]),
        "diversion_url": map["diversionUrl"] as? String ?? "",
        "specifications": rnSpecJSONArray(map["specifications"]),
        "spec_options": rnSpecOptionJSONArray(map["specOptions"]),
    ]
    // originalPrice / beginTime / endTime: nullable — only set when present.
    if let op = rnDouble(map["originalPrice"]) { json["original_price"] = op }
    if let bt = rnInt(map["beginTime"]) { json["begin_time"] = bt }
    if let et = rnInt(map["endTime"]) { json["end_time"] = et }
    // Goods conclusion fields (goods-conclusion-fields spec): only set when the
    // host passes them back (output-only fields a host rarely supplies). Absent →
    // native LBProduct's defaulted property / derived value applies (a9d13a7).
    if let cv = rnBool(map["canView"]) { json["can_view"] = cv }
    if let cb = rnBool(map["canBuy"]) { json["can_buy"] = cb }
    if let isn = rnBool(map["isNarrating"]) { json["is_narrating"] = isn }
    if let nl = rnBool(map["needLabel"]) { json["need_label"] = nl }
    if let lb = map["label"] as? String { json["label"] = lb }
    // add-product-video-id-core-rn: videoId — omit-if-absent (key missing →
    // LBProductDTO decodes videoId as nil), letting a host simulate an
    // `other_goods[]`-sourced product via `simulateProductTap`/`simulateAddCart`.
    if let vid = map["videoId"] as? String { json["video_id"] = vid }
    guard let data = try? JSONSerialization.data(withJSONObject: json),
          let product = try? JSONDecoder().decode(LBProduct.self, from: data) else { return nil }
    return product
}

private func lbSpecFromArgs(_ map: NSDictionary) -> LBSpec? {
    guard let id = map["id"] as? String else { return nil }
    var json: [String: Any] = [
        "id": id,
        "name": map["name"] as? String ?? "",
        "specification_no": map["specificationNo"] as? String ?? "",
        "price": rnDouble(map["price"]) ?? 0.0,
        "price_show": map["priceShow"] as? String ?? "",
        "original_price_show": map["originalPriceShow"] as? String ?? "",
        "stock": rnInt(map["stock"]) ?? 0,
        "photos": rnStringArray(map["photos"]),
    ]
    if let op = rnDouble(map["originalPrice"]) { json["original_price"] = op }
    guard let data = try? JSONSerialization.data(withJSONObject: json),
          let spec = try? JSONDecoder().decode(LBSpec.self, from: data) else { return nil }
    return spec
}

// MARK: - product-bridge-data-core bridge-map value coercion helpers
//
// The RN bridge map may deliver numbers as NSNumber, Bool, or String (e.g.
// `price` is a String per §price 精度). These helpers coerce defensively.

/// `price` / `originalPrice` arrive as String (§price 精度); accept Number too.
/// Returns nil when absent / NSNull / "" / 0 (so `original_price` is omitted →
/// SDK treats as "no original price").
private func rnDouble(_ value: Any?) -> Double? {
    if let s = value as? String { let d = Double(s); return (d == nil || d == 0) ? nil : d }
    if let n = value as? NSNumber { let d = n.doubleValue; return d == 0 ? nil : d }
    return nil
}

private func rnInt(_ value: Any?) -> Int? {
    if let n = value as? NSNumber { return n.intValue }
    if let s = value as? String { return Int(s) }
    return nil
}

/// 0/1 flag — tolerate Bool, Int, or String. Absent → 0.
private func rnIntFlag(_ value: Any?) -> Int {
    if let b = value as? Bool { return b ? 1 : 0 }
    if let n = value as? NSNumber { return n.intValue }
    if let s = value as? String { return Int(s) ?? 0 }
    return 0
}

/// Boolean — tolerate Bool, Int 0/1, or String. Returns nil when absent / NSNull
/// (so goods-conclusion-fields reverse keys are omitted → native default applies).
private func rnBool(_ value: Any?) -> Bool? {
    if let b = value as? Bool { return b }
    if let n = value as? NSNumber { return n.intValue != 0 }
    if let s = value as? String { return s == "true" || s == "1" }
    return nil
}

private func rnStringArray(_ value: Any?) -> [String] {
    return (value as? [Any])?.compactMap { $0 as? String } ?? [String]()
}

/// Build the internal snake_case `LBSpec` DTO JSON array from the camelCase
/// `specifications` bridge array.
private func rnSpecJSONArray(_ value: Any?) -> [[String: Any]] {
    guard let arr = value as? [[String: Any]] else { return [[String: Any]]() }
    return arr.map { e in
        var s: [String: Any] = [
            "id": e["id"] as? String ?? "",
            "name": e["name"] as? String ?? "",
            "specification_no": e["specificationNo"] as? String ?? "",
            "price": rnDouble(e["price"]) ?? 0.0,
            "price_show": e["priceShow"] as? String ?? "",
            "original_price_show": e["originalPriceShow"] as? String ?? "",
            "stock": rnInt(e["stock"]) ?? 0,
            "photos": rnStringArray(e["photos"]),
        ]
        if let op = rnDouble(e["originalPrice"]) { s["original_price"] = op }
        return s
    }
}

/// Build the internal `spec_options` DTO JSON array `{name, child}`.
private func rnSpecOptionJSONArray(_ value: Any?) -> [[String: Any]] {
    guard let arr = value as? [[String: Any]] else { return [[String: Any]]() }
    return arr.map { e in
        return [
            "name": e["name"] as? String ?? "",
            "child": rnStringArray(e["child"]),
        ]
    }
}

private func lbHotItemFromArgs(_ map: NSDictionary) -> LBHotItem? {
    guard let id = map["id"] as? String else { return nil }
    // duration is a formatted string (e.g. "38:36"); watchNum is NOT in the model
    // (CLAUDE.md invariant: not present in API hot[] response).
    let json: [String: Any] = [
        "id": id,
        "title": map["title"] as? String ?? "",
        "cover": map["cover"] as? String ?? "",
        "duration": map["duration"] as? String ?? "00:00",
    ]
    guard let data = try? JSONSerialization.data(withJSONObject: json),
          let item = try? JSONDecoder().decode(LBHotItem.self, from: data) else { return nil }
    return item
}

private func lbWinnerFromArgs(_ map: NSDictionary) -> LBWinner? {
    guard let id = map["id"] as? String else { return nil }
    let awardMap = map["award"] as? NSDictionary
    let award = LBAward(
        type: awardMap?["type"] as? String ?? "",
        code: awardMap?["code"] as? String ?? "",
        name: awardMap?["name"] as? String ?? "")
    return LBWinner(id: id,
                    eventId: (map["eventId"] as? Int) ?? 0,
                    title: map["title"] as? String ?? "",
                    award: award)
}

// MARK: - LivebuyPlayerViewManager — RCTViewManager

@objc(LivebuyPlayerViewManager)
final class LivebuyPlayerViewManager: RCTViewManager {

    override static func requiresMainQueueSetup() -> Bool { return true }

    override func view() -> UIView! {
        return LivebuyPlayerRNView()
    }

    private func withView(tag: NSNumber, block: @escaping (LivebuyPlayerRNView) -> Void) {
        // UIKit view lookup and manipulation must happen on the main thread.
        DispatchQueue.main.async {
            guard let view = self.bridge.uiManager.view(forReactTag: tag) as? LivebuyPlayerRNView else { return }
            block(view)
        }
    }

    @objc func load(_ reactTag: NSNumber, videoId: String) {
        withView(tag: reactTag) { $0.load(videoId: videoId) }
    }

    // Legacy command name preserved as alias for backward compat (pre-headless RN
    // bridge called `release` for cleanup on unmount). New code should use `unload`.
    @objc func release(_ reactTag: NSNumber) {
        withView(tag: reactTag) { $0.releasePlayer() }
    }

    @objc func unload(_ reactTag: NSNumber) {
        withView(tag: reactTag) { $0.unload() }
    }

    @objc func play(_ reactTag: NSNumber) {
        withView(tag: reactTag) { $0.play() }
    }

    @objc func pause(_ reactTag: NSNumber) {
        withView(tag: reactTag) { $0.pause() }
    }

    @objc func setMuted(_ reactTag: NSNumber, muted: Bool) {
        withView(tag: reactTag) { $0.setMuted(muted) }
    }

    @objc func seek(_ reactTag: NSNumber, seconds: Double) {
        withView(tag: reactTag) { $0.seek(seconds: seconds) }
    }

    // rn-vod-playback-progress-core — control exits (core `togglePlayPause()`
    // / `seekBy(_:)` already exist; Android's do NOT yet, so this is iOS-only —
    // see design.md D6).
    @objc func togglePlayPause(_ reactTag: NSNumber) {
        withView(tag: reactTag) { $0.togglePlayPause() }
    }

    @objc func seekBy(_ reactTag: NSNumber, delta: Double) {
        withView(tag: reactTag) { $0.seekBy(delta) }
    }

    @objc func sendChat(_ reactTag: NSNumber, message: String, eventId: NSNumber?) {
        withView(tag: reactTag) { $0.sendChat(message, eventId: eventId) }
    }

    // MARK: - New commands per spec §Player Public methods

    @objc func skipStart(_ reactTag: NSNumber) {
        withView(tag: reactTag) { $0.skipStart() }
    }

    @objc func cancelAutoNext(_ reactTag: NSNumber) {
        withView(tag: reactTag) { $0.cancelAutoNext() }
    }

    @objc func requestEventJoin(_ reactTag: NSNumber, eid: NSNumber, keyword: String) {
        withView(tag: reactTag) { $0.requestEventJoin(eid: eid.intValue, keyword: keyword) }
    }

    // view-cart-event-rn-core: 查看購物車 CTA → core seam (emit VIEW_CART).
    @objc func requestViewCart(_ reactTag: NSNumber, productId: String?) {
        withView(tag: reactTag) { $0.requestViewCart(productId: productId) }
    }

    @objc func reportEventStay(_ reactTag: NSNumber, eventId: NSNumber, stayTime: NSNumber?) {
        withView(tag: reactTag) { $0.reportEventStay(eventId: eventId.intValue, stayTime: stayTime) }
    }

    @objc func requestAwardClaim(_ reactTag: NSNumber, winner: NSDictionary, contact: NSDictionary?) {
        withView(tag: reactTag) { $0.requestAwardClaim(winner: winner, contact: contact) }
    }

    @objc func minimize(_ reactTag: NSNumber) {
        withView(tag: reactTag) { $0.minimize() }
    }

    @objc func expand(_ reactTag: NSNumber) {
        withView(tag: reactTag) { $0.expand() }
    }

    // MARK: - Sub-component simulate* commands (expand-simulate-bridge-parity)

    // ChatView
    @objc func chatView_simulateSendTap(_ reactTag: NSNumber, text: String, eventId: NSNumber?) {
        withView(tag: reactTag) { $0.chatView_simulateSendTap(text: text, eventId: eventId) }
    }
    @objc func chatView_simulateLoadHistoryTap(_ reactTag: NSNumber) {
        withView(tag: reactTag) { $0.chatView_simulateLoadHistoryTap() }
    }
    @objc func chatView_simulateEventJoinTap(_ reactTag: NSNumber, eid: NSNumber, keyword: String) {
        withView(tag: reactTag) { $0.chatView_simulateEventJoinTap(eid: eid.intValue, keyword: keyword) }
    }

    // ProductOverlayView
    @objc func productOverlay_simulateProductTap(_ reactTag: NSNumber, product: NSDictionary) {
        withView(tag: reactTag) { $0.productOverlay_simulateProductTap(product) }
    }
    @objc func productOverlay_simulatePushCardDismiss(_ reactTag: NSNumber) {
        withView(tag: reactTag) { $0.productOverlay_simulatePushCardDismiss() }
    }
    @objc func productOverlay_simulatePanelToggle(_ reactTag: NSNumber) {
        withView(tag: reactTag) { $0.productOverlay_simulatePanelToggle() }
    }

    // ProductListPanel
    @objc func productListPanel_simulateProductTap(_ reactTag: NSNumber, product: NSDictionary) {
        withView(tag: reactTag) { $0.productListPanel_simulateProductTap(product) }
    }
    @objc func productListPanel_simulateAddCart(_ reactTag: NSNumber, product: NSDictionary, spec: NSDictionary?) {
        withView(tag: reactTag) { $0.productListPanel_simulateAddCart(product, specMap: spec) }
    }
    @objc func productListPanel_simulateRestockNotice(_ reactTag: NSNumber, product: NSDictionary) {
        withView(tag: reactTag) { $0.productListPanel_simulateRestockNotice(product) }
    }

    // OperationPanelView
    @objc func operationPanel_simulateGoodsTap(_ reactTag: NSNumber) {
        withView(tag: reactTag) { $0.operationPanel_simulateGoodsTap() }
    }
    @objc func operationPanel_simulateChatToggleTap(_ reactTag: NSNumber) {
        withView(tag: reactTag) { $0.operationPanel_simulateChatToggleTap() }
    }
    @objc func operationPanel_simulateLikeTap(_ reactTag: NSNumber) {
        withView(tag: reactTag) { $0.operationPanel_simulateLikeTap() }
    }
    @objc func operationPanel_simulateShareTap(_ reactTag: NSNumber) {
        withView(tag: reactTag) { $0.operationPanel_simulateShareTap() }
    }
    @objc func operationPanel_simulateSubtitleToggleTap(_ reactTag: NSNumber) {
        withView(tag: reactTag) { $0.operationPanel_simulateSubtitleToggleTap() }
    }
    @objc func operationPanel_simulateServiceLinkTap(_ reactTag: NSNumber) {
        withView(tag: reactTag) { $0.operationPanel_simulateServiceLinkTap() }
    }
    @objc func operationPanel_simulateMoreTap(_ reactTag: NSNumber) {
        withView(tag: reactTag) { $0.operationPanel_simulateMoreTap() }
    }
    @objc func operationPanel_simulateGuestNameEditTap(_ reactTag: NSNumber) {
        withView(tag: reactTag) { $0.operationPanel_simulateGuestNameEditTap() }
    }
    @objc func operationPanel_simulateSkipStartTap(_ reactTag: NSNumber) {
        withView(tag: reactTag) { $0.operationPanel_simulateSkipStartTap() }
    }
    @objc func operationPanel_simulateBackToLiveTap(_ reactTag: NSNumber) {
        withView(tag: reactTag) { $0.operationPanel_simulateBackToLiveTap() }
    }

    // VideoInfoPanel
    @objc func videoInfoPanel_simulateSubscribeTap(_ reactTag: NSNumber) {
        withView(tag: reactTag) { $0.videoInfoPanel_simulateSubscribeTap() }
    }
    @objc func videoInfoPanel_simulateServiceLinkTap(_ reactTag: NSNumber) {
        withView(tag: reactTag) { $0.videoInfoPanel_simulateServiceLinkTap() }
    }
    @objc func videoInfoPanel_simulateShopTap(_ reactTag: NSNumber) {
        withView(tag: reactTag) { $0.videoInfoPanel_simulateShopTap() }
    }
    @objc func videoInfoPanel_simulateDismiss(_ reactTag: NSNumber) {
        withView(tag: reactTag) { $0.videoInfoPanel_simulateDismiss() }
    }
    @objc func videoInfoPanel_simulateTabChange(_ reactTag: NSNumber, tab: String) {
        withView(tag: reactTag) { $0.videoInfoPanel_simulateTabChange(tab: tab) }
    }

    // EndScreenView
    @objc func endScreen_simulateCancelTap(_ reactTag: NSNumber) {
        withView(tag: reactTag) { $0.endScreen_simulateCancelTap() }
    }
    @objc func endScreen_simulateHotItemTap(_ reactTag: NSNumber, item: NSDictionary) {
        withView(tag: reactTag) { $0.endScreen_simulateHotItemTap(item) }
    }
}
