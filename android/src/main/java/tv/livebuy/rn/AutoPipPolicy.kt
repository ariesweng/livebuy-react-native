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

    /**
     * Whether the bridge should write `setAutoEnterEnabled(false)` back onto the host Activity
     * when the wrapped view is disposed (android-bridge-auto-pip-disarm-on-dispose-core).
     * Auto-enter is a property of the ACTIVITY, not of the view: without this, a disposed player
     * leaves `setAutoEnterEnabled(true)` behind and the user's next Home press pushes whatever the
     * app is showing (e.g. a store home screen) into the PiP window. Only disarms what the bridge
     * itself armed (`armed` = the arm write actually landed) — never touches host-owned params —
     * and only on API 31+, the only level where the arm exists.
     */
    fun shouldDisarmOnDispose(sdkInt: Int, armed: Boolean): Boolean =
        armed && sdkInt >= API_S

    /** Whether a `PIP_STATE_CHANGE` event's params asked the host to enter PiP. */
    fun isPipRequested(params: Map<String, Any>): Boolean =
        params["requested"] == true

    /**
     * Whether the bridge should pause playback on `onActivityStopped`
     * (rn-android-pause-on-background-core). Real-device evidence (`dumpsys activity
     * activities`, `finishing=false`) proved the system PiP overlay's close(X) button does NOT
     * call `Activity.finish()` — it only demotes the Activity to `STOPPED`, the exact same
     * transition as a plain Home-press backgrounding. `isInPiP` MUST be the Activity's ACTUAL
     * current PiP state (`activity.isInPictureInPictureMode`), not device PiP capability: a
     * genuine OS-PiP session must keep playing (the PiP thumbnail needs a live frame), while by
     * the time close(X) delivers `onActivityStopped`, `isInPictureInPictureMode` has already
     * flipped to `false` — so this single check covers both the plain-background and the
     * PiP-close(X) triggers without a dedicated close-specific branch. Mirrors the Flutter
     * sibling change's `tv.livebuy.flutter.AutoPipPolicy.shouldPauseOnStop`.
     */
    fun shouldPauseOnStop(isInPiP: Boolean, wasPlaying: Boolean): Boolean =
        !isInPiP && wasPlaying

    /**
     * Whether the bridge should resume playback on `onActivityStarted`
     * (rn-android-pause-on-background-core). Only resumes a pause THIS forwarder caused — never
     * overrides a pause the user or host caused independently.
     */
    fun shouldResumeOnStart(pausedByThis: Boolean): Boolean =
        pausedByThis
}
