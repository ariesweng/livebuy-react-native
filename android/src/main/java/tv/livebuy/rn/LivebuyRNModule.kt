package tv.livebuy.rn

import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.browser.customtabs.CustomTabsIntent
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.WritableNativeArray
import com.facebook.react.bridge.WritableNativeMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.UIManagerModule
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import tv.livebuy.sdk.LivebuySDK
import tv.livebuy.sdk.core.LBEnvironment
import tv.livebuy.sdk.core.config.SDKConfig
import tv.livebuy.sdk.events.LBCartResultCallback
import tv.livebuy.sdk.events.LBEvent
import tv.livebuy.sdk.events.LBShareContext
import tv.livebuy.sdk.events.LivebuyEventListener
import tv.livebuy.sdk.models.LBChannel
import tv.livebuy.sdk.models.LBCheckoutItem
import tv.livebuy.sdk.models.LBError
import tv.livebuy.sdk.models.LBFeaturedGood
import tv.livebuy.sdk.models.LBPlaybackProgress
import tv.livebuy.sdk.models.LBPlayerState
import tv.livebuy.sdk.models.LBPollResponse
import tv.livebuy.sdk.models.LBProduct
import tv.livebuy.sdk.models.LBSpec
import tv.livebuy.sdk.models.LBSpecOption
import tv.livebuy.sdk.models.LBUser
import tv.livebuy.sdk.models.LBVideoItem
import tv.livebuy.sdk.models.LBWidgetResponse
import tv.livebuy.sdk.player.LivebuyPlayerView
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

internal class LivebuyRNModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "LivebuyRNBridge"

    // MARK: - Cart callback pool (Task 4.1 / 4.4)
    //
    // Bridges fire-and-forget SDK → JS dispatch with the async resolve coming back from JS.
    // Capped at MAX_POOL_SIZE; oldest entry is evicted (LRU) when full, with a client_drop metric.
    private val cartCallbackPool = ConcurrentHashMap<String, PoolEntry>()
    private val poolOrder = java.util.concurrent.ConcurrentLinkedDeque<String>()
    private val timeoutHandler = Handler(Looper.getMainLooper())
    private val bridgeScope = CoroutineScope(Dispatchers.IO)

    private data class PoolEntry(
        val callback: LBCartResultCallback,
        val timeoutRunnable: Runnable
    )

    companion object {
        private const val MAX_POOL_SIZE = 100
        private const val CALLBACK_TTL_MS = 5_000L
        private val SYNC_INTERCEPTOR_EVENTS = setOf(
            LBEvent.AUTH_REQUIRED,
            LBEvent.PRODUCT_CLICK,
            LBEvent.INFO_CUSTOMER_SERVICE,
            LBEvent.VIDEO_SHARE_REQUEST,
            // rn-sync-interceptor-events-parity: mirror the native EventTypeRegistry (9 events).
            LBEvent.DISMISS_REQUEST,
            LBEvent.SERVICE_LINK_REQUEST,
            LBEvent.GUEST_NAME_EDIT_REQUEST,
            LBEvent.EVENT_JOIN_INTENT,
            LBEvent.AWARD_CLAIM_INTENT,
        )
    }

    // MARK: - Bridge listener (Task 4.3)

    // Installed on first call to registerListener() (idempotent). Forwards all SDK events to JS.
    private val sdkListener = object : LivebuyEventListener {
        override fun onEventTriggered(
            eventName: String,
            params: Map<String, Any>,
            cartCallback: LBCartResultCallback?,
            shareContext: LBShareContext?
        ): Boolean {
            val payload = WritableNativeMap().apply {
                putString("eventName", eventName)
                putMap("params", paramsToMap(params))
                if (shareContext != null) {
                    putMap("shareContext", WritableNativeMap().apply {
                        putString("defaultUrl", shareContext.shareUrl)
                        putString("defaultTitle", shareContext.title)
                    })
                }
            }

            if (cartCallback != null) {
                val id = registerCartCallback(cartCallback)
                payload.putString("callbackId", id)
            }

            emit("onSdkEvent", payload)

            // Cart return value is unused by SDK (cart waits on callback). Notifications ignore the return.
            // Sync interceptors: assume JS handles since it registered a listener — async pattern.
            return SYNC_INTERCEPTOR_EVENTS.contains(eventName)
        }
    }

    // MARK: - Pool helpers

    private fun registerCartCallback(callback: LBCartResultCallback): String {
        val id = UUID.randomUUID().toString()
        evictIfFull()

        val timeoutRunnable = Runnable {
            // Pool TTL: if JS hasn't replied in 5 s, drop the slot.
            // The SDK's own 5 s timer will fire LBCartResultCallback.expire() — this is just memory hygiene.
            cartCallbackPool.remove(id)
            poolOrder.remove(id)
        }
        cartCallbackPool[id] = PoolEntry(callback, timeoutRunnable)
        poolOrder.addLast(id)
        timeoutHandler.postDelayed(timeoutRunnable, CALLBACK_TTL_MS)
        return id
    }

    private fun evictIfFull() {
        while (cartCallbackPool.size >= MAX_POOL_SIZE) {
            val oldest = poolOrder.pollFirst() ?: break
            cartCallbackPool.remove(oldest)?.let {
                timeoutHandler.removeCallbacks(it.timeoutRunnable)
            }
            emit("LBMetric", WritableNativeMap().apply {
                putString("name", "client_drop")
                putString("reason", "callback_pool_full")
            })
        }
    }

    // MARK: - Module methods (called from JS)

    @ReactMethod
    fun configure(
        apiKey: String,
        secret: String,
        shopId: String,
        lang: String?,
        displayName: String?,
        avatarUrl: String?,
        externalUserId: String?,
        autoPipOnIntercept: Boolean,
        apiVersion: Double,
        configFetchTimeoutMs: Double,
        enableConversionAttribution: Boolean,
        // power-profile-adaptation (第 5 支 parity): opt-out, default true — 12th positional arg
        // from JS, forwarded to LivebuySDK.configure(...enablePowerProfileAdaptation). Native owns adaptation.
        enablePowerProfileAdaptation: Boolean,
        // sdk-stat-reporting (rn-stat-reporting-core): opt-in, default false — 13th positional arg
        // from JS, forwarded to LivebuySDK.configure(...enableStatReporting). Native owns all /stat sending.
        enableStatReporting: Boolean,
        // sdk-stat-endpoint-environment-selection-core (rn-stat-environment-forward-core)
        // + sdk-data-api-environment-selection-core: SDK-wide environment wire string,
        // default "production" — 14th positional arg from JS. Mapped to the native
        // LBEnvironment (unknown / anything but "develop" → PRODUCTION) and forwarded to
        // LivebuySDK.configure(...environment); native selects BOTH the data API base URL and
        // the /stat endpoint. RN never resolves a URL itself.
        environment: String,
        promise: Promise,
    ) {
        // rn-configure-external-user-id-parity: include externalUserId so configure-time member-id
        // binding reaches parity with iOS/Android/Flutter (mirrors setUser). Gate widened so a user
        // carrying ONLY an externalUserId still constructs an LBUser.
        val user = if (displayName != null || avatarUrl != null || externalUserId != null)
            LBUser(displayName = displayName ?: "", avatarUrl = avatarUrl, externalUserId = externalUserId)
        else null
        // rn-stat-environment-forward-core: map the JS wire string → native LBEnvironment.
        // Unknown / anything but "develop" falls back to PRODUCTION (source-compatible safe default).
        val env = if (environment == "develop") LBEnvironment.DEVELOP else LBEnvironment.PRODUCTION
        bridgeScope.launch {
            try {
                LivebuySDK.configure(
                    context = reactContext.applicationContext,
                    apiKey = apiKey,
                    secret = secret,
                    shopId = shopId,
                    apiVersion = apiVersion.toInt(),
                    lang = lang,
                    user = user,
                    autoPipOnIntercept = autoPipOnIntercept,
                    configFetchTimeoutMs = configFetchTimeoutMs.toInt(),
                    enableConversionAttribution = enableConversionAttribution,
                    enablePowerProfileAdaptation = enablePowerProfileAdaptation,
                    enableStatReporting = enableStatReporting,
                    environment = env,
                )
                promise.resolve(null)
            } catch (e: LBError.NotConfigured) {
                promise.reject("NOT_CONFIGURED", "HMAC / apiKey rejected by server", e)
            } catch (t: Throwable) {
                promise.reject("CONFIGURE_ERROR", t.message ?: "configure failed", t)
            }
        }
    }

    // MARK: - sdk-config bridge (add-sdk-config-transport, task 3.3)

    @ReactMethod
    fun getSdkConfig(promise: Promise) {
        try {
            promise.resolve(serializeSdkConfig(LivebuySDK.sdkConfig))
        } catch (e: LBError.NotConfigured) {
            promise.reject("NOT_CONFIGURED", "configure() not yet called", e)
        }
    }

    @ReactMethod
    fun refreshConfig(promise: Promise) {
        bridgeScope.launch {
            try {
                LivebuySDK.refreshConfig()
                promise.resolve(null)
            } catch (e: LBError.NotConfigured) {
                promise.reject("NOT_CONFIGURED", "configure() not yet called", e)
            } catch (t: Throwable) {
                promise.reject("REFRESH_ERROR", t.message ?: "refresh failed", t)
            }
        }
    }

    /**
     * Serialize `sdkConfig` for `getSdkConfig()`. The Android counterpart of iOS
     * `SDKConfig.toEventDict()` (`ios/Sources/LivebuySDK/Core/SDKConfig.swift`), which the
     * RN iOS bridge resolves verbatim — the two MUST produce the same JS-visible shape,
     * down to which keys exist.
     *
     * Typed sections (`visibility` / `theme` / `behavior`) are written field by field, so
     * an absent optional becomes an explicit `putNull` rather than a missing key. The three
     * OPAQUE bags (`layout.player` / `layout.widget` / `extensions`) are raw passthrough:
     * handed to [paramsToMap] untouched, keys and all — see [SdkConfigOpaqueBag]
     * (rn-android-sdkconfig-null-key-parity-core).
     */
    private fun serializeSdkConfig(config: SDKConfig): WritableMap = WritableNativeMap().apply {
        putInt("schemaVersion", config.schemaVersion)
        if (config.visibility == null) {
            putNull("visibility")
        } else {
            val v = config.visibility!!
            putMap("visibility", WritableNativeMap().apply {
                v.chat?.let { putBoolean("chat", it) } ?: putNull("chat")
                v.productOverlay?.let { putBoolean("productOverlay", it) } ?: putNull("productOverlay")
                v.activityNotification?.let { putBoolean("activityNotification", it) } ?: putNull("activityNotification")
                v.endScreen?.let { putBoolean("endScreen", it) } ?: putNull("endScreen")
                v.videoInfoPanel?.let { putBoolean("videoInfoPanel", it) } ?: putNull("videoInfoPanel")
            })
        }
        if (config.theme == null) {
            putNull("theme")
        } else {
            val t = config.theme!!
            putMap("theme", WritableNativeMap().apply {
                t.primaryColor?.let { putString("primaryColor", it) } ?: putNull("primaryColor")
                t.fontScale?.let { putDouble("fontScale", it.toDouble()) } ?: putNull("fontScale")
            })
        }
        if (config.behavior == null) {
            putNull("behavior")
        } else {
            putMap("behavior", WritableNativeMap())
        }
        // `layout` opaque bags — raw passthrough. [SdkConfigOpaqueBag.layout] keeps BOTH
        // `player` and `widget` as present keys (a missing bag is a `null` VALUE, not a
        // missing key), so paramsToMap emits `putNull` for it and JS sees the same shape iOS
        // builds with `layoutDict["player"] = NSNull()`.
        // `config.layout` is a cross-module nullable property (core `SDKConfig`) that Kotlin
        // can't smart-cast, so capture it into a local val first (rn-android-bridge-drift-fix-core).
        val layout = config.layout
        if (layout == null) {
            putNull("layout")
        } else {
            putMap("layout", paramsToMap(SdkConfigOpaqueBag.layout(layout.player, layout.widget)))
        }
        // `extensions` raw bag — handed to paramsToMap verbatim, with NO filtering. A key
        // whose value is JSON null MUST reach JS as a present key with value `null`: hosts
        // rely on telling "the backend has no such setting" apart from "the backend set it to
        // null" (e.g. `floating_setting.video_id`), and iOS already behaves that way — its
        // `toEventDict()` copies every entry, JSON null included, as `NSNull()`.
        // (Historical note: this used to `filterValues { it != null }`, justified by a claim
        // that the bridge had no way to put a null under an arbitrary key. That was never
        // true — see paramsToMap's `null -> putNull(k)` branch below. The filter was also a
        // no-op until core stopped leaking `org.json`'s JSONObject.NULL sentinel here
        // (android-sdkconfig-extensions-nested-normalization-core).)
        putMap("extensions", paramsToMap(config.extensions))
    }

    @ReactMethod
    fun registerListener() {
        // Idempotent: replaces any prior native-bridge listener installation.
        LivebuySDK.setEventListener(sdkListener)
    }

    @ReactMethod
    fun unregisterListener() {
        LivebuySDK.setEventListener(null)
    }

    // MARK: - In-app browser (fix-ui-template-default-parity-core)
    //
    // Navigation tool for the template layer (`livebuy-react-native-ui`) to open a
    // diversion URL in an in-app browser (Chrome Custom Tabs) without ejecting the
    // user to the system browser. Headless contract: SDK core MUST NOT call this
    // itself — only the UI template does, and only when the host has not intercepted
    // `productTap`. Empty / malformed URLs are a safe no-op (never crash).
    //
    // Requires `androidx.browser:browser:1.8.0` on the host app's Android classpath.
    // This RN package ships source-only (no module build.gradle), so the host /
    // build machine declares the dependency — see react-native/README.md §Installation.
    @ReactMethod
    fun openInAppBrowser(url: String) {
        if (url.isBlank()) return
        val activity = reactContext.currentActivity ?: return
        try {
            CustomTabsIntent.Builder().build().launchUrl(activity, Uri.parse(url))
        } catch (e: Exception) {
            // Malformed URL / no Custom Tabs provider / activity gone — safe no-op.
        }
    }

    // MARK: - Cart resolve (Task 4.1)

    @ReactMethod
    fun resolveCartRequest(
        callbackId: String,
        success: Boolean,
        appTrackCode: String?,
        errorCode: String?,
        errorMessage: String?
    ) {
        val entry = cartCallbackPool.remove(callbackId) ?: return
        poolOrder.remove(callbackId)
        timeoutHandler.removeCallbacks(entry.timeoutRunnable)

        if (success) {
            entry.callback.onSuccess(appTrackCode ?: "")
        } else {
            entry.callback.onFailure(errorCode ?: "unknown", errorMessage ?: "")
        }
    }

    // MARK: - Reverse-notification APIs (Task 4.10, 4.13)

    @ReactMethod
    fun setUser(map: ReadableMap) {
        val displayName = map.getString("displayName") ?: return
        val avatarUrl = if (map.hasKey("avatarUrl")) map.getString("avatarUrl") else null
        val externalUserId = if (map.hasKey("externalUserId")) map.getString("externalUserId") else null
        LivebuySDK.setUser(LBUser(displayName, avatarUrl, externalUserId))
    }

    @ReactMethod
    fun clearUser() {
        LivebuySDK.clearUser()
    }

    // MARK: - Conversion attribution bridge (conversion-attribution-context-rn)

    @ReactMethod
    fun captureAdClick(url: String) {
        LivebuySDK.captureAdClick(url)
    }

    @ReactMethod
    fun setFbclid(fbclid: String) {
        LivebuySDK.setFbclid(fbclid)
    }

    @ReactMethod
    fun setReferer(referer: String?) {
        LivebuySDK.setReferer(referer)
    }

    @ReactMethod
    fun clearAttributionContext() {
        LivebuySDK.clearAttributionContext()
    }

    // MARK: - Stat reporting bridge (sdk-stat-reporting, rn-stat-reporting-core)

    // Erase persisted `/stat` state (video_people per-day dedupe + in-memory retention)
    // for a host privacy / erasure request. Native owns all /stat state; mirrors
    // clearAttributionContext.
    @ReactMethod
    fun clearStatContext() {
        LivebuySDK.clearStatContext()
    }

    @ReactMethod
    fun currentFbc(promise: Promise) {
        promise.resolve(LivebuySDK.currentFbc())
    }

    @ReactMethod
    fun currentFbp(promise: Promise) {
        promise.resolve(LivebuySDK.currentFbp())
    }

    // MARK: - Power profile (power-profile-adaptation, 第 5 支 parity)

    // Read the current thermal power-profile tier. Resolves the native wire name
    // (full / reduced / conservative / survival); never null (native getter returns
    // FULL when adaptation is disabled / dormant / API < 29). Mirrors currentFbp.
    @ReactMethod
    fun currentPowerProfile(promise: Promise) {
        promise.resolve(LivebuySDK.currentPowerProfile().wireName)
    }

    @ReactMethod
    fun isLoggedIn(promise: Promise) {
        promise.resolve(LivebuySDK.isLoggedIn)
    }

    // MARK: - boundMemberId (bind-session-transition-idempotent-rn-core)
    @ReactMethod
    fun boundMemberId(promise: Promise) {
        promise.resolve(LivebuySDK.boundMemberId)
    }

    // MARK: - activeEvents accessor (active-event-accessor-rn-core)
    //
    // View-scoped Promise accessor: read-only snapshot of the current in-progress
    // live events for the player addressed by `reactTag`. Unlike the fire-and-forget
    // simulate*/command paths (ViewManager.receiveCommand), an accessor needs a return
    // value — Android Promise methods live on the module, so this resolves the wrapped
    // LivebuyPlayerView's `activeEvents()` snapshot. The view is resolved on the UI
    // thread via UIManagerModule.addUIBlock → NativeViewHierarchyManager.resolveView.
    // Each LBActiveEvent is serialized by the public `LivebuyPlayerView.activeEventParams`
    // (reused — excludes stayTime, omits empty keyword) → paramsToMap. UIManager gone /
    // wrong view type → resolves []. Mirrors iOS activeEvents.
    @ReactMethod
    fun activeEvents(reactTag: Int, promise: Promise) {
        val uiManager = reactContext.getNativeModule(UIManagerModule::class.java)
        if (uiManager == null) {
            promise.resolve(WritableNativeArray())
            return
        }
        uiManager.addUIBlock { nvhm ->
            val arr = WritableNativeArray()
            // resolveView throws IllegalViewOperationException when the tag is gone
            // (view already dropped) — treat that (and a wrong view type) as an empty
            // snapshot, mirroring the iOS `resolve([])` fallback.
            val view = try {
                nvhm.resolveView(reactTag) as? LivebuyPlayerView
            } catch (t: Throwable) {
                null
            }
            view?.activeEvents()?.forEach { event ->
                arr.pushMap(paramsToMap(LivebuyPlayerView.activeEventParams(event)))
            }
            promise.resolve(arr)
        }
    }

    // MARK: - setGuestNicknameVerified bridge (guest-nickname-checkname-on-set-rn
    //         + guest-nickname-verified-fails-loudly-rn)
    //
    // Promise-returning parity of core's `LivebuyPlayerView.setGuestNicknameVerified`
    // (guest-nickname-checkname-on-set-android). Unlike the existing fire-and-forget
    // `setGuestNickname` below (unverified — calls `LivebuySDK.setGuestNickname` directly,
    // no player context, no validation), this is a View-scoped Promise accessor keyed by
    // reactTag (same shape as `activeEvents` above) because the caller needs a
    // differentiated result: success / taken / never-sent / other error. The actual
    // suspend call runs on `bridgeScope` (the existing IO-dispatcher scope already used by
    // login/bindSession/etc in this file). Reject-code choice is delegated to the pure
    // [GuestNicknameVerifiedBridge] (see its doc comment for the naming rationale).
    //
    // guest-nickname-verified-fails-loudly-rn: RESOLVE ⟺ the nickname was committed.
    // Two things that USED to look alike must now be read separately:
    //   • HOW the view is RESOLVED still mirrors `activeEvents` — `addUIBlock` +
    //     `resolveView` + catch-to-null for a gone tag / wrong type. Unchanged.
    //   • What happens WHEN IT IS NOT FOUND no longer mirrors `activeEvents`. It used to
    //     fall through to `promise.resolve(null)`; it now REJECTS. `activeEvents` is a
    //     READ (an empty snapshot is a truthful answer), this is a WRITE (a write that
    //     did not happen must not report success). Do not "restore consistency" between
    //     the two — the asymmetry is the point.
    @ReactMethod
    fun setGuestNicknameVerified(reactTag: Int, name: String, promise: Promise) {
        val uiManager = reactContext.getNativeModule(UIManagerModule::class.java)
        if (uiManager == null) {
            promise.reject(
                GuestNicknameVerifiedBridge.rejectCode(
                    GuestNicknameVerifiedBridge.Failure.PRECONDITION_FAILED
                ),
                "setGuestNicknameVerified: no UIManager — the player view could not be " +
                    "reached, nothing was submitted."
            )
            return
        }
        uiManager.addUIBlock { nvhm ->
            // resolveView throws IllegalViewOperationException when the tag is gone
            // (view already dropped) — that, and a wrong view type, both mean "no player
            // to write to" and are rejected below (they are NOT a no-op).
            val view = try {
                nvhm.resolveView(reactTag) as? LivebuyPlayerView
            } catch (t: Throwable) {
                null
            }
            if (view == null) {
                promise.reject(
                    GuestNicknameVerifiedBridge.rejectCode(
                        GuestNicknameVerifiedBridge.Failure.PRECONDITION_FAILED
                    ),
                    "setGuestNicknameVerified: the reactTag does not resolve to a mounted " +
                        "Livebuy player view — nothing was submitted."
                )
                return@addUIBlock
            }
            bridgeScope.launch {
                try {
                    view.setGuestNicknameVerified(name)
                    promise.resolve(null)
                } catch (e: LBError.GuestNameTaken) {
                    promise.reject(
                        GuestNicknameVerifiedBridge.rejectCode(
                            GuestNicknameVerifiedBridge.Failure.TAKEN
                        ),
                        "Nickname is already taken",
                        e
                    )
                } catch (e: LBError.NicknameSetPreconditionFailed) {
                    // guest-nickname-verified-fails-loudly-android supplies this case.
                    promise.reject(
                        GuestNicknameVerifiedBridge.rejectCode(
                            GuestNicknameVerifiedBridge.Failure.PRECONDITION_FAILED
                        ),
                        "setGuestNicknameVerified: a precondition was not met (blank name, " +
                            "or no video loaded yet) — checkName was never sent.",
                        e
                    )
                } catch (e: LBError.NotConfigured) {
                    promise.reject(
                        GuestNicknameVerifiedBridge.rejectCode(
                            GuestNicknameVerifiedBridge.Failure.NOT_CONFIGURED
                        ),
                        "configure() not yet called",
                        e
                    )
                } catch (t: Throwable) {
                    promise.reject(
                        GuestNicknameVerifiedBridge.rejectCode(
                            GuestNicknameVerifiedBridge.Failure.GENERIC
                        ),
                        t.message ?: "setGuestNicknameVerified failed",
                        t
                    )
                }
            }
        }
    }

    // Set the GUEST's 留言暱稱 WITHOUT logging in (guest-nickname capability; parity native Android).
    @ReactMethod
    fun setGuestNickname(name: String) {
        LivebuySDK.setGuestNickname(name)
    }

    @ReactMethod
    fun setLanguage(lang: String) {
        LivebuySDK.setLanguage(lang)
    }

    @ReactMethod
    fun notifyCheckoutCompleted(orderId: String, sdkTrackCodes: ReadableArray, items: ReadableArray?) {
        val codes = (0 until sdkTrackCodes.size()).map { sdkTrackCodes.getString(it) ?: "" }
        val itemList = items?.let { arr ->
            (0 until arr.size()).mapNotNull { idx ->
                val m = arr.getMap(idx) ?: return@mapNotNull null
                LBCheckoutItem(
                    productId = m.getString("productId") ?: return@mapNotNull null,
                    goodsGpn = if (m.hasKey("goodsGpn")) m.getString("goodsGpn") ?: "" else "",
                    quantity = if (m.hasKey("quantity")) m.getInt("quantity") else 1,
                    price = if (m.hasKey("price")) m.getDouble("price") else 0.0,
                    sdkTrackCode = if (m.hasKey("sdkTrackCode")) m.getString("sdkTrackCode") ?: "" else ""
                )
            }
        }
        LivebuySDK.notifyCheckoutCompleted(orderId, codes, itemList)
    }

    @ReactMethod
    fun flushPendingEvents(promise: Promise) {
        bridgeScope.launch {
            try {
                val result = LivebuySDK.flushPendingEvents()
                val map = WritableNativeMap().apply {
                    putString("status", result.status)
                    putInt("uploadedCount", result.uploadedCount)
                    putInt("remainingCount", result.remainingCount)
                    putDouble("elapsedMs", result.elapsedMs.toDouble())
                }
                promise.resolve(map)
            } catch (t: Throwable) {
                promise.reject("FLUSH_ERROR", t.message ?: "flush failed", t)
            }
        }
    }

    // MARK: - fetchLatestLive

    @ReactMethod
    fun fetchLatestLive(id: String, ty: String?, promise: Promise) {
        bridgeScope.launch {
            try {
                // `ty` is optional — when JS omits it (null here), core sends no `ty`.
                val item: LBVideoItem? = LivebuySDK.fetchLatestLive(id, ty)
                if (item != null) {
                    promise.resolve(serializeVideoItem(item))
                } else {
                    promise.resolve(null)
                }
            } catch (e: IllegalStateException) {
                promise.reject("NOT_CONFIGURED", "configure() not yet called", e)
            } catch (t: Throwable) {
                promise.reject("FETCH_LATEST_LIVE_ERROR", t.message ?: "fetchLatestLive failed", t)
            }
        }
    }

    // MARK: - fetchWidget (fetch-widget-content)

    /**
     * Headless one-shot `POST /sdk/widget` fetch for the RN drop-in widget
     * container. Flattens the core [LBWidgetResponse] into a snake_case map whose
     * keys match `react-native-ui` `decodeWidgetSnapshot` (`videos` /
     * `current_page` / `last_page`) plus the web-embed colors (`widget_color` /
     * `widget_bgcolor`, the latter omitted when null) and the carousel product-card
     * display mode (`product_card`, likewise omitted when null). `videos` entries
     * reuse the existing camelCase [serializeVideoItem].
     *
     * widget-product-card-bridge-rn — `product_card` is RAW PASSTHROUGH of the core
     * [LBWidgetResponse.productCard] (`String?`, backend domain `below` / `inside` /
     * `hidden`). The key is OMITTED when core is null, which JS reads back as
     * `undefined` and normalizes to `null`. The backend default `"inside"` is
     * DELIBERATELY NOT substituted here: "the backend sent nothing" (linetv branch)
     * and "the backend sent inside" are different facts, and flattening them here
     * makes them indistinguishable for every downstream consumer. Applying a default
     * is the UI layer's job.
     *
     * The `?.let { putString(...) }` really does omit the key: `productCard` is a
     * Kotlin `String?` handed over by `WidgetResponseMapper` from a Gson-decoded DTO,
     * so a JSON null arrives as a genuine Kotlin `null` — there is no `org.json` on
     * this path and therefore no `JSONObject.NULL` sentinel (that trap lives on the
     * `Map<String, Any?>` opaque-bag path, see rn-android-sdkconfig-null-key-parity-core).
     */
    @ReactMethod
    fun fetchWidget(id: String, page: Double, promise: Promise) {
        bridgeScope.launch {
            try {
                val response: LBWidgetResponse = LivebuySDK.fetchWidget(id, page.toInt())
                val map = WritableNativeMap().apply {
                    val videos = WritableNativeArray()
                    response.videos.data.forEach { videos.pushMap(serializeVideoItem(it)) }
                    putArray("videos", videos)
                    putInt("current_page", response.videos.currentPage)
                    putInt("last_page", response.videos.lastPage)
                    putInt("widget_color", response.widgetColor)
                    // widget_bgcolor: omit the key when null (bridge convention).
                    response.widgetBgcolor?.let { putString("widget_bgcolor", it) }
                    // product_card: same convention — omit when null, NEVER "inside".
                    response.productCard?.let { putString("product_card", it) }
                }
                promise.resolve(map)
            } catch (e: IllegalStateException) {
                promise.reject("NOT_CONFIGURED", "configure() not yet called", e)
            } catch (t: Throwable) {
                promise.reject("FETCH_WIDGET_ERROR", t.message ?: "fetchWidget failed", t)
            }
        }
    }

    // video-linked-goods-core-rn: `goods` (the linked/featured product preview) is nullable on
    // the native model, and — like `LBProduct.videoId` above — the key is OMITTED entirely when
    // null (never written as a JS `null`), so JS sees `goods` as optional/`undefined`.
    private fun serializeVideoItem(item: LBVideoItem): WritableMap = WritableNativeMap().apply {
        putString("id", item.id)
        putInt("type", item.type)
        putString("title", item.title)
        putString("sessionName", item.sessionName)
        putString("cover", item.cover)
        putString("preview", item.preview)
        putInt("duration", item.duration)
        putString("publishAt", item.publishAt)
        putInt("watchNum", item.watchNum)
        putInt("pvNum", item.pvNum)
        putInt("liveStatus", item.liveStatus)
        putInt("pin", item.pin)
        putInt("showPvNum", item.showPvNum)
        putString("liveurl", item.liveurl)
        putString("playbackurl", item.playbackurl)
        putString("previewTime", item.previewTime)
        putBoolean("showStock", item.showStock)
        item.goods?.let { putMap("goods", serializeFeaturedGood(it)) }
    }

    private fun serializeFeaturedGood(good: LBFeaturedGood): WritableMap = WritableNativeMap().apply {
        putString("name", good.name)
        putString("pic", good.pic)
        putString("price", good.price)
        putString("originalPrice", good.originalPrice)
        putInt("soldOut", good.soldOut)
        putInt("stock", good.stock)
        putInt("status", good.status)
    }

    // MARK: - login (login-session-token-core)

    @ReactMethod
    fun login(memberId: String, memberName: String?, promise: Promise) {
        bridgeScope.launch {
            try {
                LivebuySDK.login(memberId, memberName)
                promise.resolve(null)
            } catch (t: Throwable) {
                promise.reject("LB_ERROR", t.message ?: "login failed", t)
            }
        }
    }

    // MARK: - bindSession / isLoggedIn (auth-bind-session-ergonomics)

    @ReactMethod
    fun bindSession(memberId: String, memberName: String?, avatarUrl: String?, promise: Promise) {
        bridgeScope.launch {
            try {
                LivebuySDK.bindSession(memberId, memberName, avatarUrl)
                promise.resolve(null)
            } catch (t: Throwable) {
                promise.reject("LB_ERROR", t.message ?: "bindSession failed", t)
            }
        }
    }

    // MARK: - addToCart (video-addcart-endpoint-core, 路線 B)

    @ReactMethod
    fun addToCart(options: ReadableMap, promise: Promise) {
        val shopId = options.getString("shopId")
        if (shopId == null) {
            promise.reject("LB_ERROR", "addToCart requires shopId")
            return
        }
        val goodsId = if (options.hasKey("goodsId")) options.getInt("goodsId") else null
        val num = if (options.hasKey("num")) options.getInt("num") else null
        val specificationId = if (options.hasKey("specificationId")) options.getInt("specificationId") else null
        val ids = if (options.hasKey("ids")) {
            options.getArray("ids")?.let { arr ->
                (0 until arr.size()).map { arr.getInt(it) }
            }
        } else null
        val live = if (options.hasKey("live")) options.getInt("live") else null
        val isLive = if (options.hasKey("isLive")) options.getInt("isLive") else null
        val isWidget = if (options.hasKey("isWidget")) options.getInt("isWidget") else null
        val inDomain = if (options.hasKey("inDomain")) options.getInt("inDomain") else null
        val userid = if (options.hasKey("userid")) options.getString("userid") else null
        val thirdpartyUserId = if (options.hasKey("thirdpartyUserId")) options.getString("thirdpartyUserId") else null
        val buyingId = if (options.hasKey("buyingId")) options.getInt("buyingId") else null
        val eventId = if (options.hasKey("eventId")) options.getInt("eventId") else null
        val guestName = if (options.hasKey("guestName")) options.getString("guestName") else null
        val dbsc = if (options.hasKey("dbsc")) options.getString("dbsc") else null
        val videoId = if (options.hasKey("videoId")) options.getString("videoId") else null
        bridgeScope.launch {
            try {
                val result = LivebuySDK.addToCart(
                    shopId = shopId,
                    goodsId = goodsId,
                    num = num,
                    specificationId = specificationId,
                    ids = ids,
                    live = live,
                    isLive = isLive,
                    isWidget = isWidget,
                    inDomain = inDomain,
                    userid = userid,
                    thirdpartyUserId = thirdpartyUserId,
                    buyingId = buyingId,
                    eventId = eventId,
                    guestName = guestName,
                    dbsc = dbsc,
                    videoId = videoId,
                )
                val map = WritableNativeMap().apply {
                    putString("goodsNo", result.goodsNo)
                    putString("specificationNo", result.specificationNo)
                    putString("buyNo", result.buyNo)
                    // addcart-track ④ — 回應含 track 時附帶（{mode, level?, fields:[{key,value}]}）；
                    // 缺 track → 維持四欄向後相容。鏡像 iOS bridge / 核心 CART_ADD_RESULT 序列化。
                    result.track?.let { track ->
                        putMap("track", WritableNativeMap().apply {
                            putString("mode", track.mode.rawValue)
                            track.level?.let { putString("level", it) }
                            putArray("fields", WritableNativeArray().apply {
                                track.fields.forEach { f ->
                                    pushMap(WritableNativeMap().apply {
                                        putString("key", f.key)
                                        putString("value", f.value)
                                    })
                                }
                            })
                        })
                    }
                }
                promise.resolve(map)
            } catch (e: LBError.CartAddDeduplicated) {
                // cart-add-tier2-unify: a 30s 重複加購 dedupe-hit → reject code
                // `cart_add_deduplicated` so JS maps the typed `{ type: 'cartAddDeduplicated' }`
                // (host treats it as「已加入購物車」, not a failure).
                promise.reject("cart_add_deduplicated", "Add-to-cart deduplicated (already added within 30 s).", e)
            } catch (e: LBError.ServerError) {
                // Convey the inner serverError code (e.g. 401 raised for an empty buy_no) as the
                // reject code so the JS `LivebuySDK.addToCart` can surface the typed LBError and
                // branch needs-login (401) vs a genuine failure (cart-needs-login-vs-failure).
                promise.reject(e.code.toString(), e.message ?: "addToCart failed", e)
            } catch (t: Throwable) {
                promise.reject("LB_ERROR", t.message ?: "addToCart failed", t)
            }
        }
    }

    // addcart-track ④ — token 平台結帳前回報 cart token (POST /sdk/video/addcart/track).
    // 委派 native LivebuySDK.reportCartTrack（conditional token、不自建 HTTP）。
    @ReactMethod
    fun reportCartTrack(shopId: String, buyNo: String, trackId: String, promise: Promise) {
        bridgeScope.launch {
            try {
                LivebuySDK.reportCartTrack(shopId = shopId, buyNo = buyNo, trackId = trackId)
                promise.resolve(null)
            } catch (t: Throwable) {
                promise.reject("LB_ERROR", t.message ?: "reportCartTrack failed", t)
            }
        }
    }

    // MARK: - goods tracking (goods-await-notice-endpoints-core)

    @ReactMethod
    fun setAwaitGoods(goodsGpn: String, enabled: Boolean, promise: Promise) {
        bridgeScope.launch {
            try {
                LivebuySDK.setAwaitGoods(goodsGpn, enabled)
                promise.resolve(null)
            } catch (t: Throwable) {
                promise.reject("LB_ERROR", t.message ?: "setAwaitGoods failed", t)
            }
        }
    }

    @ReactMethod
    fun setNoticeGoods(goodsGpn: String, enabled: Boolean, promise: Promise) {
        bridgeScope.launch {
            try {
                LivebuySDK.setNoticeGoods(goodsGpn, enabled)
                promise.resolve(null)
            } catch (t: Throwable) {
                promise.reject("LB_ERROR", t.message ?: "setNoticeGoods failed", t)
            }
        }
    }

    // MARK: - RN EventEmitter wiring stubs (required when supportedEvents exists)

    @ReactMethod
    fun addListener(eventName: String) {
        // Required by React Native NativeEventEmitter contract — no-op.
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required by React Native NativeEventEmitter contract — no-op.
    }

    // MARK: - Event emission helpers (called from LivebuyPlayerViewManager)

    fun emitStateChange(state: LBPlayerState) {
        val raw = when (state) {
            LBPlayerState.LOADING -> "loading"
            LBPlayerState.BUFFERING -> "buffering"
            LBPlayerState.PLAYING -> "playing"
            LBPlayerState.PAUSED -> "paused"
            LBPlayerState.ENDED -> "ended"
            LBPlayerState.ERROR -> "error"
            // MARK: - decouple-ui-from-logic sub-states
            LBPlayerState.AWAITING_LIVE -> "awaitingLive"
            LBPlayerState.START_SCREEN_PLAYING -> "startScreenPlaying"
            LBPlayerState.END_SCREEN_SHOWN -> "endScreenShown"
        }
        emit("LBPlayerStateChange", raw)
    }

    // Serialize a full `LBProduct` to a camelCase bridge map (product-bridge-data-core's
    // 23-field projection). Extracted from `emitProductTap` (vod-narrating-products-core-rn)
    // so the new `vodActiveProducts` filtering input — the raw products snapshot forwarded
    // alongside `LBPlaybackProgressChange` — reuses the SAME wire shape instead of drifting.
    // `price` / `originalPrice` carried as String per §price 精度 (RN host self-parses).
    // originalPrice == null → JS `null`. add-product-video-id-core-rn: `videoId` (24th field)
    // — no `putNull` fallback; the key is OMITTED entirely when null (main `goods[]` items),
    // so JS sees `videoId` as optional/`undefined`, not nullable.
    private fun productToMap(product: LBProduct): WritableNativeMap = WritableNativeMap().apply {
        // `id` is String on the Android side (core LBProduct.id: String, cross-
        // platform parity) — emit it directly, matching iOS / Flutter
        // (rn-android-bridge-drift-fix-core; dropped the now-redundant .toString()).
        putString("id", product.id)
        putString("goodsNo", product.goodsNo)
        // goodsGpn is String per spec §schema risks (was Int Gson-decoded;
        // now String — see android/.../LBModels.kt LBProduct).
        putString("goodsGpn", product.goodsGpn)
        putString("name", product.name)
        putString("price", product.price.toString())
        putString("priceShow", product.priceShow)
        if (product.originalPrice != null) putString("originalPrice", product.originalPrice.toString())
        else putNull("originalPrice")
        putString("originalPriceShow", product.originalPriceShow)
        putInt("stock", product.stock)
        putString("pic", product.pic)
        putArray("photos", stringArray(product.photos))
        putString("brief", product.brief)
        // add-product-description-core-rn: `description` — parallel to, distinct from,
        // `brief`. Tolerant decode already happened upstream in iOS/Android core; this
        // bridge point always has a non-null String (possibly "") to serialize, unlike
        // `videoId` which can be genuinely absent.
        putString("description", product.description)
        putInt("soldOut", product.soldOut)
        putInt("isHot", product.isHot)
        putInt("isOutSoon", product.isOutSoon)
        putInt("narrateStatus", product.narrateStatus)
        // Backend goods conclusion fields (goods-conclusion-fields spec; native
        // LBProduct has these as defaulted props, 1f5c730).
        putBoolean("canView", product.canView)
        putBoolean("canBuy", product.canBuy)
        putBoolean("isNarrating", product.isNarrating)
        putBoolean("needLabel", product.needLabel)
        putString("label", product.label)
        putInt("isAwait", product.isAwait)
        putInt("isAwaitNotice", product.isAwaitNotice)
        // beginTime / endTime are cross-module nullable properties (core LBProduct,
        // Int?) — Kotlin can't smart-cast them, so use ?.let / ?: (idiomatic,
        // wire-identical to the old if/else; rn-android-bridge-drift-fix-core).
        product.beginTime?.let { putInt("beginTime", it) } ?: putNull("beginTime")
        product.endTime?.let { putInt("endTime", it) } ?: putNull("endTime")
        putString("diversionUrl", product.diversionUrl)
        putArray("specifications", specArray(product.specifications))
        putArray("specOptions", specOptionArray(product.specOptions))
        product.videoId?.let { putString("videoId", it) }
    }

    // vod-narrating-products-core-rn: array-of-products serialization, reused by
    // `emitPlaybackProgressChange`'s new `products` wire key. Mirrors the existing
    // `specArray`/`specOptionArray` helper pattern below.
    private fun productsArray(products: List<LBProduct>): WritableNativeArray =
        WritableNativeArray().apply { products.forEach { pushMap(productToMap(it)) } }

    fun emitProductTap(product: LBProduct) {
        emit("LBProductTap", productToMap(product))
    }

    private fun stringArray(items: List<String>): WritableNativeArray =
        WritableNativeArray().apply { items.forEach { pushString(it) } }

    private fun specArray(specs: List<LBSpec>): WritableNativeArray =
        WritableNativeArray().apply {
            specs.forEach { spec ->
                pushMap(WritableNativeMap().apply {
                    putString("id", spec.id)
                    putString("name", spec.name)
                    putString("specificationNo", spec.specificationNo)
                    putString("price", spec.price.toString())
                    putString("priceShow", spec.priceShow)
                    if (spec.originalPrice != null) putString("originalPrice", spec.originalPrice.toString())
                    else putNull("originalPrice")
                    putString("originalPriceShow", spec.originalPriceShow)
                    putInt("stock", spec.stock)
                    putArray("photos", stringArray(spec.photos))
                })
            }
        }

    private fun specOptionArray(options: List<LBSpecOption>): WritableNativeArray =
        WritableNativeArray().apply {
            options.forEach { opt ->
                pushMap(WritableNativeMap().apply {
                    putString("name", opt.name)
                    putArray("child", stringArray(opt.child))
                })
            }
        }

    fun emitPollReceived(response: LBPollResponse) {
        val map = WritableNativeMap().apply {
            putDouble("last", response.last)
            response.liveEnd?.let { putInt("liveEnd", it) }
        }
        emit("LBPollReceived", map)
    }

    // upcoming-intro-core-rn — channel-info forward (HAND-ALIGNED; this RN native
    // bridge is NOT compiled in this repo). Emit a LIGHTWEIGHT projection of the
    // loaded `LBChannel` (only the fields the JS host's upcoming chrome needs) as a
    // snake_case payload, so the host can feed the `react-native-ui` template's
    // upcoming view-model. The player state `"awaitingLive"` alone cannot carry
    // these channel fields. Mirrors the `emitProductTap` snake_case style; the JS
    // `mapPlayerChannelInfo` maps it to the camelCase `LBPlayerChannelInfo` host shape.
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
    // one). Unlike the iOS sibling, the Android wiring point
    // (`LivebuyPlayerViewManager.kt`'s `view.onChannelRefresh = { … }`) was
    // already fixed to bind core's current callback name in archived change
    // 2026-07-11-rn-android-bridge-drift-fix-core — no wiring change needed here.
    fun emitChannelChange(channel: LBChannel) {
        val map = WritableNativeMap().apply {
            putString("publish_at", channel.publishAt)
            putString("cover", channel.cover)
            putString("start", channel.start)
            putInt("live_status", channel.liveStatus)
            // channel-type-bridge-core-rn — additive. Feeds `isFinishedLiveReplay`
            // downstream (react-native-ui); raw passthrough, not interpreted here.
            putInt("type", channel.type)
            putString("title", channel.title)
            putString("service_link", channel.shop.serviceLink)
            putString("subtitle_url", channel.subtitleUrl)
            putInt("is_subtitle", channel.isSubtitle)
            // player-channel-chrome-fields-core-rn — additive. Feeds the player
            // header chrome (avatar + title + subtitle) that iOS/Android's
            // view-model layer auto-feeds via `ingestChannel`; RN has no such
            // automatic path, hence this bridge projection.
            putString("shop_name", channel.shop.name)
            putString("shop_logo", channel.shop.logo)
            putString("share_url", channel.shareUrl)
        }
        emit("LBPlayerChannelInfo", map)
    }

    // rn-vod-playback-progress-core — dedicated VOD playback-progress channel
    // forward (HAND-ALIGNED; this RN native bridge is NOT compiled in this
    // repo). `LBPlaybackProgress` is an SDK-internal value type (never decoded
    // from API JSON), so the wire is sent CAMELCASE directly — mirrors
    // `emitPollReceived`'s style, not `emitChannelChange`'s snake_case style.
    //
    // vod-narrating-products-core-rn: `products` is a NEW additive wire key —
    // the raw, UNFILTERED products snapshot (`channel.goods`, read by the
    // caller at the moment of forward — see `LivebuyPlayerViewManager.kt`'s
    // `onPlaybackProgressChange` wiring). RN JS computes its own
    // `vodActiveProducts(products, position)` pure filter from this (mirrors
    // iOS/Android core's own algorithm rather than trusting a second copy of
    // it over the wire). No new native computation is introduced here — this
    // is pure wire-forwarding of already-resident state, reusing
    // `productToMap`/`productsArray` (the SAME wire shape `LBProductTap`
    // already uses). Defaulted to `emptyList()` so any other (unknown) call
    // site keeps compiling.
    fun emitPlaybackProgressChange(progress: LBPlaybackProgress, products: List<LBProduct> = emptyList()) {
        val map = WritableNativeMap().apply {
            putDouble("position", progress.position)
            putDouble("duration", progress.duration)
            putBoolean("isPlaying", progress.isPlaying)
            putBoolean("isReplay", progress.isReplay)
            putArray("products", productsArray(products))
        }
        emit("LBPlaybackProgressChange", map)
    }

    fun emitError(error: LBError) {
        val map = WritableNativeMap()
        when (error) {
            is LBError.Restricted       -> map.putString("type", "restricted")
            is LBError.VideoNotFound    -> map.putString("type", "videoNotFound")
            is LBError.InvalidSignature -> map.putString("type", "invalidSignature")
            is LBError.ChatRateLimited  -> map.putString("type", "chatRateLimited")
            is LBError.GuestNameTaken   -> map.putString("type", "guestNameTaken")
            is LBError.ChatRequiresLogin -> map.putString("type", "chatRequiresLogin")
            is LBError.NotLive          -> map.putString("type", "notLive")
            is LBError.SdkVersionUnsupported -> map.putString("type", "sdk_version_unsupported")
            is LBError.NetworkError -> {
                map.putString("type", "networkError")
                map.putString("message", error.cause.localizedMessage ?: "Network error")
            }
            is LBError.ServerError -> {
                map.putString("type", "serverError")
                map.putInt("code", error.code)
                map.putString("message", error.message)
            }
            is LBError.LoginFailed -> {
                // login() surfaces failures via promise.reject; event mapping is a
                // fallback. No dedicated RN union member — map to serverError.
                map.putString("type", "serverError")
                map.putInt("code", error.code)
                map.putString("message", error.message)
            }
            is LBError.SdkConfigFetchFailed -> {
                map.putString("type", "networkError")
                map.putString("message", error.underlying?.localizedMessage ?: "config fetch failed")
            }
            else -> {
                // NotConfigured / future cases — avoid a silent empty event.
                map.putString("type", "serverError")
                map.putInt("code", -1)
                map.putString("message", "unknown error")
            }
        }
        emit("LBError", map)
    }

    private fun emit(event: String, payload: Any?) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(event, payload)
    }

    // MARK: - Map conversion

    /**
     * Convert a plain Kotlin map into a React Native writable map.
     *
     * **A `null` value keeps its key.** `null` is written with `putNull(k)`, never dropped —
     * that is a CONTRACT, not an implementation accident. `sdkConfig`'s three opaque bags
     * (`extensions` / `layout.player` / `layout.widget`) are handed here unfiltered and rely
     * on it to stay key-for-key identical with iOS, where a JSON null survives as `NSNull()`
     * (rn-android-sdkconfig-null-key-parity-core). Anything that drops null-valued keys
     * belongs nowhere on this path.
     *
     * Nested `Map` / `List` values recurse (via [listToArray], which mirrors this rule with
     * `pushNull`). Values of a type this bridge has no writer for are stringified as a last
     * resort — reaching that branch for a `/sdk/config` bag means core leaked a non-plain
     * type into it.
     */
    @Suppress("UNCHECKED_CAST")
    private fun paramsToMap(params: Map<String, Any?>): WritableMap {
        val out = WritableNativeMap()
        for ((k, v) in params) {
            when (v) {
                null -> out.putNull(k)
                is Int -> out.putInt(k, v)
                is Long -> out.putDouble(k, v.toDouble())
                is Double -> out.putDouble(k, v)
                is Float -> out.putDouble(k, v.toDouble())
                is Boolean -> out.putBoolean(k, v)
                is String -> out.putString(k, v)
                is List<*> -> out.putArray(k, listToArray(v))
                is Map<*, *> -> out.putMap(k, paramsToMap(v as Map<String, Any?>))
                else -> out.putString(k, v.toString())
            }
        }
        return out
    }

    /**
     * Convert a plain Kotlin list into a React Native writable array. The [paramsToMap]
     * contract, applied to elements: **a `null` element keeps its slot** (`pushNull()`), so
     * length and element order survive the bridge unchanged. Nested `Map` / `List` elements
     * recurse back through [paramsToMap] / here.
     */
    @Suppress("UNCHECKED_CAST")
    private fun listToArray(list: List<*>): WritableNativeArray {
        val arr = WritableNativeArray()
        for (v in list) {
            when (v) {
                null -> arr.pushNull()
                is Int -> arr.pushInt(v)
                is Long -> arr.pushDouble(v.toDouble())
                is Double -> arr.pushDouble(v)
                is Float -> arr.pushDouble(v.toDouble())
                is Boolean -> arr.pushBoolean(v)
                is String -> arr.pushString(v)
                is Map<*, *> -> arr.pushMap(paramsToMap(v as Map<String, Any?>))
                is List<*> -> arr.pushArray(listToArray(v))
                else -> arr.pushString(v.toString())
            }
        }
        return arr
    }
}
