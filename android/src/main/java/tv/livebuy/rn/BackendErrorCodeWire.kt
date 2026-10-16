package tv.livebuy.rn

// rn-bridge-forward-backend-error-code-and-replay-raw-core — pure wire helpers for forwarding the
// core's raw backend `error_code` (Android `LBError.backendErrorCode`) to JS.
//
// Two channels, ONE key: `backendErrorCode` (camelCase), the key the JS side already reads —
//   • Promise reject `userInfo.backendErrorCode` (`pickBackendErrorCode` in src/LivebuySDK.ts);
//   • the `LBError` event map (`onError` hands the raw map to the host as the TS `LBError`, whose
//     `LBBackendErrorCodeField.backendErrorCode` is camelCase).
// Present only when the code is a non-empty string; otherwise the key is omitted entirely (the
// payload stays byte-identical to the pre-change bridge).
//
// Zero-Android / zero-SDK-dependency (takes the already-read `String?`, returns plain maps) so it is
// JVM-unit-testable (BackendErrorCodeWireTest). [LivebuyRNModule] reads `LBError.backendErrorCode`
// at catch time and converts the map to a `WritableMap`.
internal object BackendErrorCodeWire {
    const val KEY = "backendErrorCode"

    /** The code to forward, or null when absent / empty. */
    fun nonEmpty(code: String?): String? = code?.takeIf { it.isNotEmpty() }

    /** Reject `userInfo` entries, or null when there is nothing to forward (reject without userInfo). */
    fun rejectUserInfo(code: String?): Map<String, String>? =
        nonEmpty(code)?.let { mapOf(KEY to it) }
}
