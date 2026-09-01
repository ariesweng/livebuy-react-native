package tv.livebuy.rn

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import tv.livebuy.sdk.widget.FloatingWidget

internal class LivebuyFloatingWidgetViewManager(
    private val reactContext: ReactApplicationContext
) : SimpleViewManager<FloatingWidget>() {

    override fun getName(): String = "LivebuyFloatingWidgetView"

    override fun createViewInstance(context: ThemedReactContext): FloatingWidget {
        // videoId is provided via the `configure` command after mount.
        return FloatingWidget(context, videoId = "")
    }

    override fun receiveCommand(view: FloatingWidget, commandId: String, args: ReadableArray?) {
        when (commandId) {
            "simulateClose" -> view.simulateClose()
            "simulateTap"   -> view.simulateTap()
        }
    }
}
