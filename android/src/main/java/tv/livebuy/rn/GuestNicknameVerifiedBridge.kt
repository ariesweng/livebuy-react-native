package tv.livebuy.rn

// guest-nickname-checkname-on-set-rn / guest-nickname-verified-fails-loudly-rn —
// pure reject-code decision for the RN Android bridge's `setGuestNicknameVerified`.
//
// This carries the ONLY branching logic of the reject-code choice in
// [LivebuyRNModule.setGuestNicknameVerified]: given how the call failed, which wire
// `code` string to reject the Promise with. It is deliberately ZERO-Android-dependency
// and zero-SDK-dependency (plain enum/String) so it is trivially JVM-unit-testable
// (GuestNicknameVerifiedBridgeTest) without needing to resolve the network Maven
// artifact `tv.livebuy:livebuy` on the classpath — mirrors [AutoPipPolicy]'s
// relationship to [LivebuyPlayerViewManager] (rn-android-auto-pip-entry): the actual
// `catch (e: LBError.…)` type-dispatch in [LivebuyRNModule] IS the
// untestable-without-classpath shell around this pure core.
//
// guest-nickname-verified-fails-loudly-rn: RESOLVE ⟺ THE NICKNAME WAS COMMITTED.
// Every path that did not complete the commit rejects, so the code set grew from two
// to four. Naming rationale, per code:
//
// • [CODE_TAKEN] reuses the EXACT wire spelling already used for this identical
//   underlying core error on the existing `LBError` chat-error EVENT channel (see
//   `LivebuyRNModule.emitError`'s `is LBError.GuestNameTaken -> map.putString("type",
//   "guestNameTaken")`) — same error, different transport (Promise reject `code` vs
//   event `type`), so a host already familiar with the chat-error shape recognizes it.
// • [CODE_PRECONDITION_FAILED] mirrors core's `LBError.NicknameSetPreconditionFailed`
//   (blank name / no video loaded — checkName was NEVER SENT) and is aligned with the
//   iOS bridge's identical string, per the four-platform parity table in
//   `guest-nickname-verified-fails-loudly-core`'s design.md. It ALSO covers the
//   bridging failures core cannot see — no UIManager, the reactTag resolves to no view
//   or to a wrong type — because to the caller the REMEDY is identical: nothing was
//   sent, the server never ruled on this name, nothing was persisted or broadcast, and
//   retrying blind will not help. NOT because every one of those conditions is
//   observable by the caller — the two bridging cases are pure native-side races.
//   Which one it was belongs in the reject MESSAGE (free text, not contract), never
//   in the code.
// • [CODE_NOT_CONFIGURED] mirrors core's `LBError.NotConfigured`, reusing the spelling
//   [LivebuyRNModule] ALREADY uses for that same error on five other Promise methods
//   (configure / getSdkConfig / refreshConfig / fetchLatestLive / fetchWidget).
//   Deliberately NOT a new lowerCamel synonym: the four-platform parity table wrote
//   `"notConfigured"`, but this file already has one authoritative wire string for that
//   exact error on that exact transport, and a second spelling would be the very
//   synonym the lead change's own reasoning rejects. Flutter uses `NOT_CONFIGURED`
//   too, so this keeps RN and Flutter identical on this code.
// • [CODE_GENERIC] reuses this file's existing dominant Promise-reject fallback code
//   (`"LB_ERROR"`, used by login/bindSession/reportCartTrack/setAwaitGoods/…) for
//   network/server/unexpected failures.
//
// The four codes keep three categories distinguishable, which is what callers act on:
// NEVER SENT (precondition / not configured) vs SENT-AND-REFUSED (taken) vs
// SENT-OUTCOME-UNKNOWN (generic, retryable).
object GuestNicknameVerifiedBridge {

    /** Reject code for the checkName-taken case (403). */
    const val CODE_TAKEN = "guestNameTaken"

    /** Reject code for「前置條件不成立，checkName 根本沒送出」(core + bridging layers). */
    const val CODE_PRECONDITION_FAILED = "nicknameSetPreconditionFailed"

    /** Reject code for「SDK 尚未 configure」—— this file's existing spelling. */
    const val CODE_NOT_CONFIGURED = "NOT_CONFIGURED"

    /** Reject code fallback for everything else (network / server / unexpected). */
    const val CODE_GENERIC = "LB_ERROR"

    /**
     * How a `setGuestNicknameVerified` attempt failed, expressed WITHOUT any SDK type
     * so this decision stays unit-testable off the Android/SDK classpath.
     */
    enum class Failure {
        /** checkName ran and the server refused the name (403). */
        TAKEN,

        /** Nothing was sent: blank name, no video loaded, or no reachable player. */
        PRECONDITION_FAILED,

        /** `LivebuySDK.configure(...)` has not returned successfully. */
        NOT_CONFIGURED,

        /** Sent, outcome unknown: network / server / unexpected. */
        GENERIC,
    }

    /** Which reject code to use for a given failure classification. */
    fun rejectCode(failure: Failure): String = when (failure) {
        Failure.TAKEN -> CODE_TAKEN
        Failure.PRECONDITION_FAILED -> CODE_PRECONDITION_FAILED
        Failure.NOT_CONFIGURED -> CODE_NOT_CONFIGURED
        Failure.GENERIC -> CODE_GENERIC
    }
}
