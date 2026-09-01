package tv.livebuy.rn

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class LivebuyRNPackage : ReactPackage {

    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(LivebuyRNModule(reactContext))

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        listOf(
            LivebuyPlayerViewManager(reactContext),
            LivebuyWidgetViewManager(reactContext),
            LivebuyFloatingWidgetViewManager(reactContext),
        )
}
