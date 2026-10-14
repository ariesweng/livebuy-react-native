package tv.livebuy.rn

// vod-end-loop-rn-core — pure JS wire string → "is advance?" decision for the RN Android
// bridge's `configure(..., vodEndBehavior)`.
//
// The JS layer forwards the VOD / 回放 natural-end behavior as a wire string ('loop' /
// 'advance'). Only the exact string "advance" selects the native
// `LBVodEndBehavior.ADVANCE`; anything else (including "loop", null or an unknown value)
// falls back to the `LOOP` default — the same fallback as the JS-side
// `resolveVodEndBehavior` and the iOS bridge's `vodEndBehaviorFromWire`.
//
// Deliberately ZERO-Android / ZERO-SDK-dependency (returns a plain Boolean rather than the
// SDK enum) so it is JVM-unit-testable (VodEndBehaviorWireTest, via the jvm-test project)
// without resolving `tv.livebuy:livebuy`; [LivebuyRNModule.configure] maps the Boolean to
// `LBVodEndBehavior` — mirrors [GuestNicknameVerifiedBridge]'s relationship to the module.
internal object VodEndBehaviorWire {
    const val ADVANCE = "advance"
    const val LOOP = "loop"

    fun isAdvance(wire: String?): Boolean = wire == ADVANCE
}
