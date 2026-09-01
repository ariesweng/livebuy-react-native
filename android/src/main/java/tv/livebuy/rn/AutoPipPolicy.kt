package tv.livebuy.rn

// rn-android-auto-pip-entry — pure decision helpers for the RN Android bridge's
// built-in OS auto-PiP entry.
//
// These functions carry the ONLY branching logic of the auto-PiP wiring in
// [LivebuyPlayerViewManager] (arm timing / whether to call enterPiP / whether an
// event asked for PiP). They are deliberately ZERO-Android-dependency (plain Int /
// Boolean / Map) so they are trivially JVM-unit-testable (AutoPipPolicyTest) per
// docs/unit-test-discipline.md — the ViewManager's own wiring (resolve Activity,
// register lifecycle callbacks, post to the main thread) is the untestable side-effect
// shell around this pure core.
//
// API-level constants are inlined literals (not android.os.Build.VERSION_CODES) to keep
// this file free of any Android import, so a bare JVM test needs no android.jar stub.
object AutoPipPolicy {

    /** Build.VERSION_CODES.O — Picture-in-Picture first available. */
    private const val API_O = 26

    /** Build.VERSION_CODES.S — `setAutoEnterEnabled` first available (reliable auto-enter). */
    private const val API_S = 31

    /**
     * Whether the bridge should arm the system's own auto-enter-PiP on the host Activity
     * (`setPictureInPictureParams(...setAutoEnterEnabled(true)...)`). Only reliable on
     * API 31+, and only when the device actually supports PiP.
     */
    fun shouldArmAutoEnter(sdkInt: Int, pipSupported: Boolean): Boolean =
        sdkInt >= API_S && pipSupported

    /**
     * Whether the bridge should synchronously call `PiPHelper.enterPiP(activity)` in
     * response to a `PIP_STATE_CHANGE`. Requires the SDK to have actually requested PiP,
     * PiP to be available on the device (API 26+), and the device to support it.
     */
    fun shouldEnterPiP(sdkInt: Int, pipSupported: Boolean, requested: Boolean): Boolean =
        requested && sdkInt >= API_O && pipSupported

    /** Whether a `PIP_STATE_CHANGE` event's params asked the host to enter PiP. */
    fun isPipRequested(params: Map<String, Any>): Boolean =
        params["requested"] == true
}
