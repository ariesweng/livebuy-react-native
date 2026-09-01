package tv.livebuy.rn

import java.util.concurrent.CopyOnWriteArrayList

/**
 * rn-android-auto-pip-entry — opt-in `onUserLeaveHint()` bridge for the RN Android bridge.
 *
 * MIRRORS the native reference-ui `tv.livebuy.referenceui.container.LivebuyPiPUserLeaveHint`.
 *
 * WHY THIS EXISTS: `Activity.onUserLeaveHint()` fires at the CORRECT moment for entering
 * PiP — the instant the user's "leaving" gesture (Home / Recents) is recognized, WHILE the
 * Activity is still foregrounded. On API 26–30 (which has no `setAutoEnterEnabled`) this is
 * the ONLY reliable trigger. But Android delivers `onUserLeaveHint()` ONLY to the Activity
 * that overrides it — there is NO broadcast, NO `Application.ActivityLifecycleCallbacks`
 * equivalent, and an RN library CANNOT override the host app's `MainActivity`. So the bridge
 * cannot observe this signal unassisted; the host must forward it with ONE line.
 *
 * HOST WIRING (only needed for reliable API 26–30 PiP — API 31+ is fully automatic):
 * ```kotlin
 * // In the host app's MainActivity (which every RN app already owns):
 * override fun onUserLeaveHint() {
 *     super.onUserLeaveHint()
 *     LivebuyPiPUserLeaveHint.notifyUserLeaveHint()
 * }
 * ```
 * Also declare, on that Activity in AndroidManifest.xml:
 * `android:supportsPictureInPicture="true"` +
 * `android:configChanges="screenSize|smallestScreenSize|screenLayout|orientation"`.
 *
 * `LivebuyPlayerViewManager` registers a forward to `view.requestAutoPiP()` on view create and
 * unregisters it on view drop. This bridge is ADDITIVE / OPT-IN / BACKWARD-COMPATIBLE: a host
 * that never calls [notifyUserLeaveHint] gets byte-identical behavior to the built-in arm alone
 * (API 31+ reliable, API 26–30 best-effort via `onActivityStopped`). Calling it on any API level
 * is safe — on 31+ it is a redundant, harmless duplicate signal (same as core's `requestAutoPiP()`
 * tolerating repeated calls).
 */
object LivebuyPiPUserLeaveHint {

    // CopyOnWriteArrayList: registration/unregistration happen on the main thread at view
    // create/drop; notify fan-out iterates a stable snapshot without locking.
    private val listeners = CopyOnWriteArrayList<() -> Unit>()

    /** Register a forward (typically `{ view.requestAutoPiP() }`). Idempotent-safe to pair with [unregister]. */
    fun register(cb: () -> Unit) {
        listeners.add(cb)
    }

    /** Remove a previously-registered forward. */
    fun unregister(cb: () -> Unit) {
        listeners.remove(cb)
    }

    /**
     * Fan-out to every registered forward. Call from the host `MainActivity.onUserLeaveHint()`
     * override (after `super.onUserLeaveHint()`). No-op when nothing is registered.
     */
    fun notifyUserLeaveHint() {
        listeners.forEach { it() }
    }
}
