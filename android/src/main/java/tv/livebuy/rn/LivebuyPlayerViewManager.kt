package tv.livebuy.rn

import android.app.Activity
import android.app.Application
import android.app.PictureInPictureParams
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Rational
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import kotlinx.coroutines.launch
import tv.livebuy.sdk.events.LBCartResultCallback
import tv.livebuy.sdk.events.LBEvent
import tv.livebuy.sdk.events.LBListenerToken
import tv.livebuy.sdk.events.LBShareContext
import tv.livebuy.sdk.events.LivebuyEventListener
import tv.livebuy.sdk.models.LBAward
import tv.livebuy.sdk.models.LBAwardClaimInput
import tv.livebuy.sdk.models.LBChannel
import tv.livebuy.sdk.models.LBHotItem
import tv.livebuy.sdk.models.LBPlaybackProgress
import tv.livebuy.sdk.models.LBProduct
import tv.livebuy.sdk.models.LBSpec
import tv.livebuy.sdk.models.LBSpecOption
import tv.livebuy.sdk.models.LBWinner
import tv.livebuy.sdk.player.LivebuyPlayerView
import tv.livebuy.sdk.player.PiPHelper
import tv.livebuy.sdk.player.VideoInfoPanel

/**
 * Narrow, structurally-equal (Kotlin `data class`) snapshot of ONLY the 8 fields
 * `LBPlayerChannelInfo` projects (rb-react-native-subtitle-channel-info-bridge-core
 * §momentState dedupe). Deliberately NOT a whole-[LBChannel] comparison — `LBChannel`
 * carries many more fields (goods, nav, spec, watchNum, …) that have no bearing on this
 * projection; comparing the full model would re-fire on changes this event doesn't even
 * carry, while comparing nothing at all (always emitting) would spam the RN bridge on
 * every unrelated `onMomentStateChange` publish (subtitle CC toggle, viewer-count tick,
 * chat-visibility flip, end-screen countdown tick, product-overlay updates, …) that
 * leaves these 8 fields unchanged.
 */
private data class ChannelInfoSnapshot(
    val publishAt: String,
    val cover: String,
    val start: String,
    val liveStatus: Int,
    val title: String,
    val serviceLink: String,
    val subtitleUrl: String,
    val isSubtitle: Int,
) {
    companion object {
        fun from(channel: LBChannel) = ChannelInfoSnapshot(
            publishAt = channel.publishAt,
            cover = channel.cover,
            start = channel.start,
            liveStatus = channel.liveStatus,
            title = channel.title,
            serviceLink = channel.shop.serviceLink,
            subtitleUrl = channel.subtitleUrl,
            isSubtitle = channel.isSubtitle,
        )
    }
}

internal class LivebuyPlayerViewManager(
    private val reactContext: ReactApplicationContext
) : SimpleViewManager<LivebuyPlayerView>() {

    override fun getName(): String = "LivebuyPlayerView"

    // rn-android-auto-pip-entry — per-view auto-PiP wiring, keyed by the native view so
    // onDropViewInstance can tear it down. Accessed only on the UI thread (RN view
    // create/drop), so a plain map is sufficient. Strongly retains the auxiliary event
    // listener (core `addEventListener` holds it WEAKLY — the caller must retain it).
    private val pipWirings = mutableMapOf<LivebuyPlayerView, AutoPipWiring>()

    // rb-react-native-subtitle-channel-info-bridge-core — per-view onMomentStateChange
    // dedupe state, keyed by the native view (mirrors `pipWirings` above). Reset on
    // `release`/`unload` (`receiveCommand`) so a later `load()` on this SAME view
    // reusing byte-identical channel content is NOT silently swallowed by a stale
    // pre-unload snapshot; removed entirely in `onDropViewInstance`.
    private val channelInfoSnapshots = mutableMapOf<LivebuyPlayerView, ChannelInfoSnapshot?>()

    override fun createViewInstance(context: ThemedReactContext): LivebuyPlayerView {
        val view = LivebuyPlayerView(context)
        val module = reactContext.getNativeModule(LivebuyRNModule::class.java)
        view.onStateChange  = { state   -> module?.emitStateChange(state) }
        view.onProductTap   = { product -> module?.emitProductTap(product) }
        view.onPollReceived = { resp    -> module?.emitPollReceived(resp) }
        view.onError        = { error   -> module?.emitError(error) }
        // upcoming-intro-core-rn — channel-info forward. Mirrors the other view
        // callbacks; emits the lightweight channel projection for the JS host's
        // upcoming chrome data source. Binds core's current callback name
        // `onChannelRefresh` (renamed from the retired `onChannelChange`;
        // rn-android-bridge-drift-fix-core) — same `(LBChannel) -> Unit` signature
        // and「頻道刷新、不重啟播放」semantics. Only fires on the 20s LIVE periodic
        // channel-settings refresh (`applyRefreshedChannel`, gated `liveStatus == 1`)
        // — it can NEVER fire for initial load / VOD / upcoming. See
        // `onMomentStateChange` right below, which additively closes that gap. Kept
        // (not removed) for LIVE mid-stream settings changes (e.g. a merchant editing
        // `title`/`subtitle_url` while already live) — `onMomentStateChange` does NOT
        // reach this call site (`applyRefreshedChannel` does not call
        // `publishMomentState()`).
        view.onChannelRefresh = { channel ->
            channelInfoSnapshots[view] = ChannelInfoSnapshot.from(channel)
            module?.emitChannelChange(channel)
        }
        // rb-react-native-subtitle-channel-info-bridge-core — additive coverage for
        // VOD / upcoming / initial-load channel-info emission, closing the gap
        // `onChannelRefresh` (above) structurally cannot reach. `onMomentStateChange`
        // fires unconditionally on every channel (re)load (VOD/LIVE/upcoming —
        // `configureFromChannel`'s `publishMomentState()` call,
        // `LivebuyPlayerView.kt` ~line 2142) with `view.channel` ALREADY set to the
        // just-loaded channel by the time it fires. This RN bridge is free to bind
        // it: `react-native/android/build.gradle` depends ONLY on `tv.livebuy:livebuy`
        // (core), never `:livebuy-ui` / `:livebuy-reference-ui` — the native template
        // layer that exclusively claims `onChannelRefresh`/`onMomentStateChange` for
        // its own attachment (`TemplateAttachment.kt`) is absent from this build
        // target, so there is no single-owner contention here.
        //
        // `onMomentStateChange` ALSO fires on many unrelated moment-state publishes
        // that carry the SAME channel (subtitle CC toggle, viewer-count tick,
        // chat-visibility flip, end-screen countdown tick, product-overlay updates,
        // …) — deduped via `ChannelInfoSnapshot` so this doesn't turn into an
        // unconditional-per-tick RN bridge crossing. The dedupe key deliberately does
        // NOT use video id alone: an upcoming→live `liveStatus` flip (30s preview
        // poll) keeps the same id but IS a real change this event must still carry.
        view.onMomentStateChange = {
            val ch = view.channel
            if (ch != null) {
                val snapshot = ChannelInfoSnapshot.from(ch)
                if (snapshot != channelInfoSnapshots[view]) {
                    channelInfoSnapshots[view] = snapshot
                    module?.emitChannelChange(ch)
                }
            }
        }
        // rn-vod-playback-progress-core — dedicated VOD playback-progress
        // channel forward. Core already exposes `onPlaybackProgressChange` +
        // `LBPlaybackProgress` (isReplay slice, component-contracts §Player
        // （Android）VOD playback-progress 頻道 — isReplay slice parity); this
        // is pure event forwarding, mirroring `onChannelRefresh` above.
        // NOTE: `togglePlayPause`/`seekBy` commands are intentionally NOT
        // wired below (`receiveCommand`) — core has no such methods yet.
        view.onPlaybackProgressChange = { progress -> module?.emitPlaybackProgressChange(progress) }

        // rb-react-native-subtitle-channel-info-bridge-core — seed the dedupe map so
        // `onMomentStateChange`'s lookup above never index-misses (Kotlin `Map` `get`
        // returns null for a missing key regardless, so this is not load-bearing for
        // correctness — it documents the initial "no channel seen yet" state).
        channelInfoSnapshots[view] = null

        // rn-android-auto-pip-entry — build the OS auto-PiP entry INTO the bridge so RN
        // partners don't have to write native Kotlin. The wrapped native LivebuyPlayerView
        // is HEADLESS View-mode: its requestAutoPiP() only dispatches PIP_STATE_CHANGE
        // (it never self-calls enterPictureInPictureMode() — that stays host territory per
        // the headless contract). Without this, RN Android could never enter PiP: nothing
        // armed the trigger, and nothing consumed the event to call enterPiP. This mirrors
        // the native drop-in `:livebuy-reference-ui` `ArmAutoPiP` + sample `ExampleEventListener`
        // (same core seams), moved from a Compose container into per-view ViewManager wiring.
        reactContext.currentActivity?.let { activity ->
            pipWirings[view] = installAutoPip(view, activity)
        }
        return view
    }

    // rn-android-auto-pip-entry — release the per-view auto-PiP wiring so the auxiliary
    // listener / Activity lifecycle callback / onUserLeaveHint forward do not leak or fire
    // for an already-dropped view.
    override fun onDropViewInstance(view: LivebuyPlayerView) {
        pipWirings.remove(view)?.dispose()
        // rb-react-native-subtitle-channel-info-bridge-core — drop this view's dedupe
        // entry so the map doesn't leak view references past teardown.
        channelInfoSnapshots.remove(view)
        super.onDropViewInstance(view)
    }

    /**
     * Wires OS auto-PiP for one [view] against its host [activity] (rn-android-auto-pip-entry):
     *  1. API 31+ → `setAutoEnterEnabled(true)` (system-driven, fully reliable, zero host code).
     *  2. API 26–30 → best-effort `onActivityStopped` → `requestAutoPiP()` (documented limitation).
     *  3. consume `PIP_STATE_CHANGE(requested=true)` → main-thread `PiPHelper.enterPiP(activity)`.
     *  4. register an opt-in `onUserLeaveHint` forward (host升級 API 26–30 為可靠).
     * All decisions route through the pure [AutoPipPolicy]; the returned [AutoPipWiring] retains
     * every registration for [onDropViewInstance] cleanup.
     */
    private fun installAutoPip(view: LivebuyPlayerView, activity: Activity): AutoPipWiring {
        val mainHandler = Handler(Looper.getMainLooper())

        // (1) API 31+: hand PiP entry timing entirely to the system. Guarded by an explicit
        // SDK_INT check so the API 31 `setAutoEnterEnabled` / API 26 `setPictureInPictureParams`
        // calls are lint/compile-legal; AutoPipPolicy carries the same threshold as the invariant.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            AutoPipPolicy.shouldArmAutoEnter(Build.VERSION.SDK_INT, PiPHelper.isPiPSupported(activity))
        ) {
            activity.setPictureInPictureParams(
                PictureInPictureParams.Builder()
                    .setAspectRatio(Rational(9, 16))
                    .setAutoEnterEnabled(true)
                    .build()
            )
        }

        // (2) API 26–30 best-effort: forward a GENUINE background (onActivityStopped, filtered to
        // this host Activity) to core's requestAutoPiP(). onActivityStopped (not onPause / RN
        // onHostPause) is chosen because onPause fires on ANY focus loss (e.g. a dialog) — too
        // wide, would wrongly enter PiP. Framework ActivityLifecycleCallbacks avoids any
        // androidx.lifecycle dependency on this bridge module.
        val lifecycleCallbacks = object : Application.ActivityLifecycleCallbacks {
            override fun onActivityStopped(a: Activity) {
                if (a === activity) view.requestAutoPiP()
            }
            override fun onActivityCreated(a: Activity, savedInstanceState: Bundle?) {}
            override fun onActivityStarted(a: Activity) {}
            override fun onActivityResumed(a: Activity) {}
            override fun onActivityPaused(a: Activity) {}
            override fun onActivitySaveInstanceState(a: Activity, outState: Bundle) {}
            override fun onActivityDestroyed(a: Activity) {}
        }
        activity.application.registerActivityLifecycleCallbacks(lifecycleCallbacks)

        // (3) Consume PIP_STATE_CHANGE(requested=true) → actually enter PiP. Uses the core
        // multi-listener seam addEventListener (auxiliary — COEXISTS with the host's primary
        // JS-forwarding listener, so JS still receives onSdkEvent(PIP_STATE_CHANGE)); returns
        // false so it never intercepts. enterPictureInPictureMode MUST run on the main thread.
        val listener = object : LivebuyEventListener {
            override fun onEventTriggered(
                eventName: String,
                params: Map<String, Any>,
                cartCallback: LBCartResultCallback?,
                shareContext: LBShareContext?,
            ): Boolean {
                if (eventName == LBEvent.PIP_STATE_CHANGE && AutoPipPolicy.isPipRequested(params)) {
                    mainHandler.post {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                            AutoPipPolicy.shouldEnterPiP(
                                Build.VERSION.SDK_INT,
                                PiPHelper.isPiPSupported(activity),
                                requested = true,
                            )
                        ) {
                            PiPHelper.enterPiP(activity)
                        }
                    }
                }
                return false
            }
        }
        val token = view.addEventListener(listener)

        // (4) opt-in onUserLeaveHint forward (host升級 API 26–30 為可靠, see LivebuyPiPUserLeaveHint).
        val userLeaveForward: () -> Unit = { view.requestAutoPiP() }
        LivebuyPiPUserLeaveHint.register(userLeaveForward)

        return AutoPipWiring(view, activity, token, listener, lifecycleCallbacks, userLeaveForward)
    }

    /**
     * Retains + tears down one view's auto-PiP wiring (rn-android-auto-pip-entry). [listener] is
     * held strongly here because core's `addEventListener` keeps only a WEAK reference.
     */
    private class AutoPipWiring(
        private val view: LivebuyPlayerView,
        private val activity: Activity,
        private val token: LBListenerToken,
        @Suppress("unused") private val listener: LivebuyEventListener,
        private val lifecycleCallbacks: Application.ActivityLifecycleCallbacks,
        private val userLeaveForward: () -> Unit,
    ) {
        fun dispose() {
            view.removeEventListener(token)
            activity.application.unregisterActivityLifecycleCallbacks(lifecycleCallbacks)
            LivebuyPiPUserLeaveHint.unregister(userLeaveForward)
        }
    }

    override fun receiveCommand(view: LivebuyPlayerView, commandId: String, args: ReadableArray?) {
        when (commandId) {
            "load"      -> view.load(args!!.getString(0))
            // `release` is the legacy command name from the pre-headless API.
            // headless SDK renamed it to `unload`; we keep `release` as an
            // alias so the existing useEffect-cleanup path in LivebuyPlayer.tsx
            // keeps working without forcing every host app to rebuild.
            //
            // rb-react-native-subtitle-channel-info-bridge-core: both branches also
            // reset the onMomentStateChange dedupe (`view.unload()` clears core's
            // `channel` — the guard in `onMomentStateChange` above already no-ops on
            // that — but a LATER `load()` reusing this SAME view with byte-identical
            // channel content must not be swallowed by a stale pre-unload snapshot).
            "release"   -> { view.unload(); channelInfoSnapshots[view] = null }
            "unload"    -> { view.unload(); channelInfoSnapshots[view] = null }
            "play"      -> view.play()
            "pause"     -> view.pause()
            "setMuted"  -> view.setMuted(args!!.getBoolean(0))
            "seek"      -> view.seek(args!!.getDouble(0))
            // MARK: - rn-vod-playback-progress-core follow-up (NOT done here)
            // "togglePlayPause" / "seekBy" commands are intentionally absent:
            // `LivebuyPlayerView` (Android core) has no `togglePlayPause()` /
            // `seekBy(Double)` methods yet — it only has the isReplay-slice
            // `onPlaybackProgressChange` forward (wired above in
            // createViewInstance). The JS ref methods dispatch these command
            // names regardless (iOS-side parity), so on Android they land here
            // as an unmatched `commandId` and are a silent no-op (no crash, no
            // RN "Unsupported command" — this `when` has no `else` throw).
            // Wire real cases here once Android core adds the 1Hz pump /
            // `togglePlayPause()` / `seekBy()` / `vodScrubAllowed` (see
            // component-contracts §Player（Android）VOD playback-progress 頻道
            // — isReplay slice parity's 範圍界定 note).
            "sendChat"  -> {
                // Optional eventId (for event-begin chat replies — spec
                // §LBPushMsg event 欄位 + sendChat extension).
                val message = args!!.getString(0)
                val eventId = if (args.size() >= 2 && args.getType(1) == com.facebook.react.bridge.ReadableType.Number) {
                    args.getInt(1)
                } else null
                // Use MainScope (a process-singleton main-thread scope) for
                // fire-and-forget; the underlying sendChat() implementation
                // handles its own error / state — we don't await.
                kotlinx.coroutines.MainScope().launch {
                    view.sendChat(message, eventId)
                }
            }
            // MARK: - new commands per spec §Player Public methods
            "skipStart"        -> view.skipStart()
            "cancelAutoNext"   -> view.cancelAutoNext()
            "requestEventJoin" -> view.requestEventJoin(
                args!!.getInt(0),
                args.getString(1)
            )
            // view-cart-event-rn-core: 查看購物車 CTA → core seam (emit VIEW_CART).
            // Optional productId（詳情頁帶、列表底部省略 → null → native 省略 product_id key）。
            "requestViewCart" -> view.requestViewCart(
                if (args != null && args.size() >= 1 && !args.isNull(0)) args.getString(0) else null
            )
            "reportEventStay" -> {
                // 直播抽獎停留補登（fire-and-forget；native reportEventStay 自行背景送出）。
                // Optional stayTime（host 計算的已觀看秒數）。
                val stayTime = if (args!!.size() >= 2 && args.getType(1) == com.facebook.react.bridge.ReadableType.Number) {
                    args.getInt(1)
                } else null
                view.reportEventStay(args.getInt(0), stayTime)
            }
            "requestAwardClaim" -> {
                val winner = lbWinnerFromMap(args!!.getMap(0)) ?: return
                val contact = if (args.size() >= 2 && !args.isNull(1)) lbAwardInputFromMap(args.getMap(1)) else null
                view.requestAwardClaim(winner, contact)
            }
            "minimize"         -> view.minimize()
            "expand"           -> view.expand()

            // rn-android-pip-mode-forward-core: forward the host Android Activity's
            // onPictureInPictureModeChanged confirmation into the wrapped native
            // LivebuyPlayerView (View-mode gap; an RN-embedded native view cannot
            // observe Activity.onPictureInPictureModeChanged). Calls the core public
            // seam exposed by android-view-mode-pip-forward-core (7f3b053d). Android-
            // only — the JS ref guards Platform.OS === 'android', so this command
            // never dispatches on iOS (mirrors the setMuted boolean-arg read).
            "notifyPictureInPictureModeChanged" ->
                view.notifyPictureInPictureModeChanged(args!!.getBoolean(0))

            // MARK: - Sub-component simulate* commands (expand-simulate-bridge-parity)

            // ChatView
            "chatView_simulateSendTap" -> {
                val text = args!!.getString(0) ?: ""
                val eventId = if (args.size() >= 2 && args.getType(1) == com.facebook.react.bridge.ReadableType.Number) args.getInt(1) else null
                view.chatView.simulateSendTap(text, eventId)
            }
            "chatView_simulateLoadHistoryTap"   -> view.chatView.simulateLoadHistoryTap()
            "chatView_simulateEventJoinTap"     -> view.chatView.simulateEventJoinTap(args!!.getInt(0), args.getString(1) ?: "")

            // ProductOverlayView
            "productOverlay_simulateProductTap" -> {
                lbProductFromMap(args!!.getMap(0))?.let { view.productOverlayView.simulateProductTap(it) }
            }
            "productOverlay_simulatePushCardDismiss" -> view.productOverlayView.simulatePushCardDismiss()
            "productOverlay_simulatePanelToggle"     -> view.productOverlayView.simulatePanelToggle()

            // ProductListPanel
            "productListPanel_simulateProductTap" -> {
                lbProductFromMap(args!!.getMap(0))?.let { view.productListPanel.simulateProductTap(it) }
            }
            "productListPanel_simulateAddCart" -> {
                val product = lbProductFromMap(args!!.getMap(0)) ?: return
                val spec = if (args.size() >= 2 && !args.isNull(1)) lbSpecFromMap(args.getMap(1)) else null
                view.productListPanel.simulateAddCart(product, spec)
            }
            "productListPanel_simulateRestockNotice" -> {
                lbProductFromMap(args!!.getMap(0))?.let { view.productListPanel.simulateRestockNotice(it) }
            }

            // OperationPanelView
            "operationPanel_simulateGoodsTap"          -> view.operationPanelView.simulateGoodsTap()
            "operationPanel_simulateChatToggleTap"     -> view.operationPanelView.simulateChatToggleTap()
            "operationPanel_simulateLikeTap"           -> view.operationPanelView.simulateLikeTap()
            "operationPanel_simulateShareTap"          -> view.operationPanelView.simulateShareTap()
            "operationPanel_simulateSubtitleToggleTap" -> view.operationPanelView.simulateSubtitleToggleTap()
            "operationPanel_simulateServiceLinkTap"    -> view.operationPanelView.simulateServiceLinkTap()
            "operationPanel_simulateMoreTap"           -> view.operationPanelView.simulateMoreTap()
            "operationPanel_simulateGuestNameEditTap"  -> view.operationPanelView.simulateGuestNameEditTap()
            "operationPanel_simulateSkipStartTap"      -> view.operationPanelView.simulateSkipStartTap()
            "operationPanel_simulateBackToLiveTap"     -> view.operationPanelView.simulateBackToLiveTap()

            // VideoInfoPanel
            "videoInfoPanel_simulateSubscribeTap"  -> view.videoInfoPanel.simulateSubscribeTap()
            "videoInfoPanel_simulateServiceLinkTap"-> view.videoInfoPanel.simulateServiceLinkTap()
            "videoInfoPanel_simulateShopTap"       -> view.videoInfoPanel.simulateShopTap()
            "videoInfoPanel_simulateDismiss"       -> view.videoInfoPanel.simulateDismiss()
            "videoInfoPanel_simulateTabChange"     -> {
                val tab = if (args!!.getString(0) == "notice") VideoInfoPanel.Tab.NOTICE else VideoInfoPanel.Tab.INFO
                view.videoInfoPanel.simulateTabChange(tab)
            }

            // EndScreenView
            "endScreen_simulateCancelTap"   -> view.endScreenView.simulateCancelTap()
            "endScreen_simulateHotItemTap"  -> {
                lbHotItemFromMap(args!!.getMap(0))?.let { view.endScreenView.simulateHotItemTap(it) }
            }
        }
    }
}

// MARK: - Bridge deserializers (expand-simulate-bridge-parity)
//
// Convert camelCase bridge args (as serialized by emitProductTap etc.) into
// SDK model objects. Missing fields default to zero/empty — adequate for
// simulate* intent signals that only need to trigger the callback chain.

private fun lbProductFromMap(map: ReadableMap?): LBProduct? {
    // LBProduct.id is String (core cross-platform parity, 7468cba6) — read it as a
    // String, not toIntOrNull() (rn-android-bridge-drift-fix-core). Matches the
    // String-id reads in lbSpecFromMap / lbHotItemFromMap; return null only when the
    // `id` key is absent (an arbitrary non-numeric id is a valid product, not a drop).
    val id = map?.getString("id") ?: return null
    // product-bridge-data-core: stop hardcoding 0/[]. Read full field set from
    // the camelCase bridge map; only fall back when a key is absent.
    return LBProduct(
        id = id,
        goodsNo = map.getString("goodsNo") ?: "",
        goodsGpn = map.getString("goodsGpn") ?: "",
        name = map.getString("name") ?: "",
        price = readDouble(map, "price") ?: 0.0,
        priceShow = map.getString("priceShow") ?: "",
        originalPrice = readDouble(map, "originalPrice"),
        originalPriceShow = map.getString("originalPriceShow") ?: "",
        stock = readInt(map, "stock") ?: 0,
        pic = map.getString("pic") ?: "",
        photos = readStringList(map, "photos"),
        brief = map.getString("brief") ?: "",
        // add-product-description-core-rn: JS -> native reverse path (simulate* test hook),
        // same missing-key-tolerant style as `brief`.
        description = map.getString("description") ?: "",
        soldOut = readFlag(map, "soldOut"),
        isHot = readFlag(map, "isHot"),
        isOutSoon = readFlag(map, "isOutSoon"),
        narrateStatus = readInt(map, "narrateStatus") ?: 0,
        // Goods conclusion fields (goods-conclusion-fields spec): absent → native
        // LBProduct's defaulted value (canView/canBuy true, isNarrating/needLabel
        // false, label ""), matching 1f5c730 + the iOS-derived defaults.
        canView = readBool(map, "canView", true),
        canBuy = readBool(map, "canBuy", true),
        isNarrating = readBool(map, "isNarrating", false),
        needLabel = readBool(map, "needLabel", false),
        label = map.getString("label") ?: "",
        isAwait = readFlag(map, "isAwait"),
        isAwaitNotice = readFlag(map, "isAwaitNotice"),
        beginTime = readInt(map, "beginTime"),
        endTime = readInt(map, "endTime"),
        diversionUrl = map.getString("diversionUrl") ?: "",
        specifications = readSpecList(map, "specifications"),
        specOptions = readSpecOptionList(map, "specOptions"),
        // add-product-video-id-core-rn: `getString` already returns null when the
        // key is absent — no extra fallback needed, letting a host simulate an
        // `other_goods[]`-sourced product via a `simulate*` call.
        videoId = map.getString("videoId"),
    )
}

private fun lbSpecFromMap(map: ReadableMap?): LBSpec? {
    val id = map?.getString("id") ?: return null
    return LBSpec(
        id = id,
        name = map.getString("name") ?: "",
        specificationNo = map.getString("specificationNo") ?: "",
        price = readDouble(map, "price") ?: 0.0,
        priceShow = map.getString("priceShow") ?: "",
        originalPrice = readDouble(map, "originalPrice"),
        originalPriceShow = map.getString("originalPriceShow") ?: "",
        stock = readInt(map, "stock") ?: 0,
        photos = readStringList(map, "photos"),
    )
}

// MARK: - product-bridge-data-core ReadableMap coercion helpers
//
// `price` / `originalPrice` arrive as String (§price 精度); accept Number too.
// `originalPrice` absent / "" / 0 → null (no original price).

private fun readDouble(map: ReadableMap, key: String): Double? {
    if (!map.hasKey(key) || map.isNull(key)) return null
    val d = when (map.getType(key)) {
        ReadableType.String -> map.getString(key)?.toDoubleOrNull()
        ReadableType.Number -> map.getDouble(key)
        else -> null
    } ?: return null
    return if (d == 0.0) null else d
}

private fun readInt(map: ReadableMap, key: String): Int? {
    if (!map.hasKey(key) || map.isNull(key)) return null
    return when (map.getType(key)) {
        ReadableType.Number -> map.getInt(key)
        ReadableType.String -> map.getString(key)?.toIntOrNull()
        else -> null
    }
}

/** 0/1 flag — tolerate Boolean, Number, or String. Absent → 0. */
private fun readFlag(map: ReadableMap, key: String): Int {
    if (!map.hasKey(key) || map.isNull(key)) return 0
    return when (map.getType(key)) {
        ReadableType.Boolean -> if (map.getBoolean(key)) 1 else 0
        ReadableType.Number -> map.getInt(key)
        ReadableType.String -> map.getString(key)?.toIntOrNull() ?: 0
        else -> 0
    }
}

/** Boolean — tolerate Boolean / Int 0/1 / String; absent → [default] (native LBProduct default). */
private fun readBool(map: ReadableMap, key: String, default: Boolean): Boolean {
    if (!map.hasKey(key) || map.isNull(key)) return default
    return when (map.getType(key)) {
        ReadableType.Boolean -> map.getBoolean(key)
        ReadableType.Number -> map.getInt(key) != 0
        ReadableType.String -> map.getString(key).let { it == "true" || it == "1" }
        else -> default
    }
}

private fun readStringList(map: ReadableMap, key: String): List<String> {
    if (!map.hasKey(key) || map.isNull(key)) return emptyList()
    val arr = map.getArray(key) ?: return emptyList()
    return (0 until arr.size()).mapNotNull { arr.getString(it) }
}

private fun readStringList(arr: ReadableArray?): List<String> {
    if (arr == null) return emptyList()
    return (0 until arr.size()).mapNotNull { arr.getString(it) }
}

private fun readSpecList(map: ReadableMap, key: String): List<LBSpec> {
    if (!map.hasKey(key) || map.isNull(key)) return emptyList()
    val arr = map.getArray(key) ?: return emptyList()
    return (0 until arr.size()).mapNotNull { lbSpecFromMap(arr.getMap(it)) }
}

private fun readSpecOptionList(map: ReadableMap, key: String): List<LBSpecOption> {
    if (!map.hasKey(key) || map.isNull(key)) return emptyList()
    val arr = map.getArray(key) ?: return emptyList()
    return (0 until arr.size()).map { i ->
        val e = arr.getMap(i)
        LBSpecOption(
            name = e?.getString("name") ?: "",
            child = readStringList(if (e != null && e.hasKey("child") && !e.isNull("child")) e.getArray("child") else null),
        )
    }
}

private fun lbHotItemFromMap(map: ReadableMap?): LBHotItem? {
    val id = map?.getString("id") ?: return null
    // duration is a formatted string (e.g. "38:36"); watchNum NOT in model
    // (CLAUDE.md invariant: not present in API hot[] response).
    return LBHotItem(
        id = id,
        cover = map.getString("cover") ?: "",
        title = map.getString("title") ?: "",
        duration = map.getString("duration") ?: "00:00",
    )
}

private fun lbWinnerFromMap(map: ReadableMap?): LBWinner? {
    val id = map?.getString("id") ?: return null
    val awardMap = if (map.hasKey("award") && !map.isNull("award")) map.getMap("award") else null
    val award = LBAward(
        type = awardMap?.getString("type") ?: "",
        code = awardMap?.getString("code") ?: "",
        name = awardMap?.getString("name") ?: "",
    )
    return LBWinner(
        id = id,
        eventId = if (map.hasKey("eventId") && !map.isNull("eventId")) map.getInt("eventId") else 0,
        title = map.getString("title") ?: "",
        award = award,
    )
}

private fun lbAwardInputFromMap(map: ReadableMap?): LBAwardClaimInput? {
    val email = map?.getString("email") ?: return null
    return LBAwardClaimInput(email = email)
}
