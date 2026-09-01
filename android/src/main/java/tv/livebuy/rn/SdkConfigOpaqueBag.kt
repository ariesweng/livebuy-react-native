package tv.livebuy.rn

// rn-android-sdkconfig-null-key-parity-core — the bridge-facing shape of the
// `sdkConfig` opaque bags.
//
// `sdkConfig` carries three OPAQUE bags that the SDK never interprets:
// `extensions`, `layout.player` and `layout.widget`. They exist so the backend can
// add fields in the merchant back-office WITHOUT an SDK release, which only works if
// every platform hands JS the SAME set of keys. In particular a key whose value is
// JSON `null` MUST survive the trip — a host has to be able to tell "the backend has
// no such setting" apart from "the backend set it to null" (`floating_setting.video_id`
// is exactly that: null means "no pinned video", absent would mean "no such knob").
//
// iOS is the behavior baseline. `SDKConfig.toEventDict()` writes
// `layoutDict["player"] = NSNull()` for an absent bag and copies every extensions
// entry verbatim (`ext[k] = v.value`, where a JSON null is an `NSNull`), and the RN
// iOS bridge resolves that dictionary with zero filtering — so on iOS the key is
// always there, as JS `null`. [layout] below is the Android half of that contract.
//
// WHY THIS IS ITS OWN OBJECT: `react-native/android` is an AGP library module meant
// to be autolinked into a host app — it is NOT in any `settings.gradle`, and its
// React dependency (`com.facebook.react:react-android`) is version-injected by the
// host, so this repo cannot build it and `LivebuyRNModule` cannot be unit-tested
// here at all. Keeping this decision in a ZERO-Android / ZERO-React / ZERO-SDK
// object makes it compilable and runnable on a plain JVM (`SdkConfigOpaqueBagTest`),
// which is the only executable evidence available for this contract. Same seam
// pattern as [AutoPipPolicy] (rn-android-auto-pip-entry) and
// [GuestNicknameVerifiedBridge] (guest-nickname-verified-fails-loudly-rn): the pure
// core is tested, the `WritableNativeMap` shell around it is not testable here.
object SdkConfigOpaqueBag {

    /**
     * Bridge-facing shape of `SDKConfig.layout`.
     *
     * Both `"player"` and `"widget"` are ALWAYS present in the returned map. An
     * absent bag stays a Kotlin `null` VALUE under its key rather than a missing
     * key, so that `LivebuyRNModule.paramsToMap` emits `putNull("player")` and JS
     * sees `{ player: null, widget: … }` — byte-for-byte the shape iOS produces with
     * `layoutDict["player"] = NSNull()`.
     *
     * The bags themselves are returned UNTOUCHED: no key is added, dropped or
     * renamed, and no value is inspected — including keys whose value is `null`,
     * which is the whole point of this function. Filtering a bag here (or at the
     * call site) would make Android hand JS fewer keys than iOS for the same
     * `/sdk/config` response.
     *
     * @param player `SDKConfig.TemplateLayout.player`, or `null` when the backend
     *   sent no `layout.player` at all.
     * @param widget `SDKConfig.TemplateLayout.widget`, or `null` when the backend
     *   sent no `layout.widget` at all.
     */
    fun layout(
        player: Map<String, Any?>?,
        widget: Map<String, Any?>?
    ): Map<String, Any?> = mapOf(
        "player" to player,
        "widget" to widget,
    )
}
