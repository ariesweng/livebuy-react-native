package tv.livebuy.rn

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * rn-android-auto-pip-entry — pure-function acceptance gate for the RN Android bridge's
 * built-in OS auto-PiP entry. [AutoPipPolicy] is zero-Android-dependency, so these run on a
 * plain JVM with no android.jar stub / Robolectric.
 */
class AutoPipPolicyTest {

    // MARK: - shouldArmAutoEnter (API 31+ setAutoEnterEnabled)

    @Test
    fun armsOnApi31PlusWhenSupported() {
        assertTrue(AutoPipPolicy.shouldArmAutoEnter(31, pipSupported = true))
        assertTrue(AutoPipPolicy.shouldArmAutoEnter(33, pipSupported = true))
    }

    @Test
    fun doesNotArmBelowApi31() {
        assertFalse(AutoPipPolicy.shouldArmAutoEnter(30, pipSupported = true))
        assertFalse(AutoPipPolicy.shouldArmAutoEnter(29, pipSupported = true))
        assertFalse(AutoPipPolicy.shouldArmAutoEnter(26, pipSupported = true))
    }

    @Test
    fun doesNotArmWhenPipUnsupported() {
        assertFalse(AutoPipPolicy.shouldArmAutoEnter(33, pipSupported = false))
    }

    // MARK: - shouldEnterPiP (consume PIP_STATE_CHANGE)

    @Test
    fun entersWhenRequestedApi26PlusSupported() {
        assertTrue(AutoPipPolicy.shouldEnterPiP(29, pipSupported = true, requested = true))
        assertTrue(AutoPipPolicy.shouldEnterPiP(26, pipSupported = true, requested = true))
        assertTrue(AutoPipPolicy.shouldEnterPiP(34, pipSupported = true, requested = true))
    }

    @Test
    fun doesNotEnterWhenNotRequested() {
        assertFalse(AutoPipPolicy.shouldEnterPiP(29, pipSupported = true, requested = false))
    }

    @Test
    fun doesNotEnterBelowApi26() {
        assertFalse(AutoPipPolicy.shouldEnterPiP(25, pipSupported = true, requested = true))
        assertFalse(AutoPipPolicy.shouldEnterPiP(24, pipSupported = true, requested = true))
    }

    @Test
    fun doesNotEnterWhenPipUnsupported() {
        assertFalse(AutoPipPolicy.shouldEnterPiP(29, pipSupported = false, requested = true))
    }

    // MARK: - isPipRequested (PIP_STATE_CHANGE param read)

    @Test
    fun isPipRequestedReadsTrueFlag() {
        assertTrue(AutoPipPolicy.isPipRequested(mapOf("active" to false, "requested" to true)))
    }

    @Test
    fun isPipRequestedFalseWhenFlagFalseOrAbsent() {
        assertFalse(AutoPipPolicy.isPipRequested(mapOf("requested" to false)))
        assertFalse(AutoPipPolicy.isPipRequested(mapOf("active" to true)))
        assertFalse(AutoPipPolicy.isPipRequested(emptyMap()))
    }
}
