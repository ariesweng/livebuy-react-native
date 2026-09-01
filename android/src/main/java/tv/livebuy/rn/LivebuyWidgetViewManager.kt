package tv.livebuy.rn

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableNativeMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import tv.livebuy.sdk.models.LBVideoItem
import tv.livebuy.sdk.widget.LivebuyWidget

internal class LivebuyWidgetViewManager(
    private val reactContext: ReactApplicationContext
) : SimpleViewManager<LivebuyWidget>() {

    override fun getName(): String = "LivebuyWidgetView"

    override fun createViewInstance(context: ThemedReactContext): LivebuyWidget {
        // shopId will be provided via the `configure` command immediately after mount.
        return LivebuyWidget(context, shopId = "")
    }

    override fun receiveCommand(view: LivebuyWidget, commandId: String, args: ReadableArray?) {
        when (commandId) {
            "configure" -> {
                // In practice the host should pass shopId at construction time;
                // `configure` allows late-binding for declarative bridge usage.
                // LivebuyWidget does not expose a public setShopId() — no-op here;
                // host is expected to mount with the correct shopId prop.
                //
                // widget-bridge-color-core / widget-product-card-bridge-rn
                // (HAND-ALIGNED — this file does NOT compile in this repo;
                // verified by RN jest/typecheck per design.md §驗證策略). After
                // the carousel/grid POST /sdk/widget fetch the core widget view
                // retains widgetColor (Int) / widgetBgcolor (String?) /
                // productCard (String?) as read-only host state. The host
                // triggers loadFirstPage(); once they are ready, bridge them
                // to JS as the snake_case `LBWidgetResponse` event so
                // <LivebuyWidget onWidgetResponse> can map them to camelCase.
                // RAW PASSTHROUGH — never interpret or mix with sdkConfig.theme.
                view.onLoadMore = { emitWidgetResponse(view) }
                view.loadFirstPage()
                // loadFirstPage is fire-and-forget; in the hand-aligned native
                // bridge the settings are emitted from a post-fetch hook. Modeled
                // here as a direct emit call site (see emitWidgetResponse).
                emitWidgetResponse(view)
            }
            "simulateCardTap" -> {
                lbVideoItemFromMap(args?.getMap(0))?.let { view.simulateCardTap(it) }
            }
            "simulateClose" -> view.simulateClose()
            "simulateCardVisibilityChanged" -> {
                val video = lbVideoItemFromMap(args?.getMap(0)) ?: return
                val visible = args?.getBoolean(1) ?: return
                view.simulateCardVisibilityChanged(video, visible)
            }
        }
    }

    // HAND-ALIGNED (non-compiling): emit the retained widget root settings to JS via
    // the RCTDeviceEventEmitter as `LBWidgetResponse`. snake_case wire keys
    // (widget_color: Int / widget_bgcolor: String|null / product_card: String|null).
    // The floating widget never reaches here (carousel/grid only). RAW PASSTHROUGH.
    //
    // widget-product-card-bridge-rn — product_card follows the same three-state
    // convention this event already uses for widget_bgcolor: null crosses the bridge
    // as JS null via putNull, NOT as the backend default "inside". Substituting the
    // default here would erase the difference between "the backend sent nothing"
    // (linetv branch) and "the backend sent inside"; applying a default is the UI
    // layer's job. `view.productCard` is a Kotlin String? straight off the core
    // widget's read-only state, so the null branch is a genuine null (no org.json on
    // this path, hence no JSONObject.NULL sentinel).
    private fun emitWidgetResponse(view: LivebuyWidget) {
        val payload = WritableNativeMap().apply {
            putInt("widget_color", view.widgetColor)
            val bg = view.widgetBgcolor
            if (bg == null) putNull("widget_bgcolor") else putString("widget_bgcolor", bg)
            val pc = view.productCard
            if (pc == null) putNull("product_card") else putString("product_card", pc)
        }
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("LBWidgetResponse", payload)
    }
}

// MARK: - LBVideoItem deserializer (Widget bridge)

private fun lbVideoItemFromMap(map: ReadableMap?): LBVideoItem? {
    val id = map?.getString("id") ?: return null
    return LBVideoItem(
        id = id,
        type = map.getInt("type").takeIf { map.hasKey("type") } ?: 1,
        title = map.getString("title") ?: "",
        sessionName = "",
        cover = map.getString("cover") ?: "",
        preview = "",
        duration = 0,
        publishAt = "2000-01-01 00:00:00",
        watchNum = 0,
        pvNum = 0,
        liveStatus = map.getInt("liveStatus").takeIf { map.hasKey("liveStatus") } ?: 1,
        pin = 0,
        showPvNum = 0,
        liveurl = map.getString("liveurl") ?: "",
        playbackurl = map.getString("playbackurl") ?: "",
        previewTime = "00:00",
        showStock = false,
        goods = tv.livebuy.sdk.models.LBFeaturedGood(
            name = "", pic = "", price = "0",
            originalPrice = "0", soldOut = 0, stock = 0, status = 1
        ),
    )
}
