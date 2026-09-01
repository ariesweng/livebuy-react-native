package tv.livebuy.rn

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * guest-nickname-checkname-on-set-rn / guest-nickname-verified-fails-loudly-rn —
 * pure-function acceptance gate for the RN Android bridge's `setGuestNicknameVerified`
 * reject-code decision. [GuestNicknameVerifiedBridge] is zero-Android/zero-SDK-dependency,
 * so these run on a plain JVM with no android.jar stub / Robolectric / network-resolved
 * Maven artifact (mirrors AutoPipPolicyTest).
 */
class GuestNicknameVerifiedBridgeTest {

    @Test
    fun takenMapsToGuestNameTakenCode() {
        assertEquals(
            "guestNameTaken",
            GuestNicknameVerifiedBridge.rejectCode(GuestNicknameVerifiedBridge.Failure.TAKEN)
        )
    }

    @Test
    fun preconditionFailedMapsToItsOwnCode() {
        assertEquals(
            "nicknameSetPreconditionFailed",
            GuestNicknameVerifiedBridge.rejectCode(
                GuestNicknameVerifiedBridge.Failure.PRECONDITION_FAILED
            )
        )
    }

    @Test
    fun notConfiguredMapsToThisFilesExistingSpelling() {
        // guest-nickname-verified-fails-loudly-rn 決策 B: SCREAMING_SNAKE, reusing the
        // spelling LivebuyRNModule already uses for LBError.NotConfigured on five other
        // Promise methods — NOT a new lowerCamel synonym for the same error.
        assertEquals(
            "NOT_CONFIGURED",
            GuestNicknameVerifiedBridge.rejectCode(
                GuestNicknameVerifiedBridge.Failure.NOT_CONFIGURED
            )
        )
    }

    @Test
    fun otherMapsToGenericLbErrorCode() {
        assertEquals(
            "LB_ERROR",
            GuestNicknameVerifiedBridge.rejectCode(GuestNicknameVerifiedBridge.Failure.GENERIC)
        )
    }

    @Test
    fun codesArePinnedExactly() {
        // Pins the exact wire spellings — these are the contract host apps `catch` on
        // (design.md 決策 B / D); an accidental rename here is a breaking change.
        assertEquals("guestNameTaken", GuestNicknameVerifiedBridge.CODE_TAKEN)
        assertEquals(
            "nicknameSetPreconditionFailed",
            GuestNicknameVerifiedBridge.CODE_PRECONDITION_FAILED
        )
        assertEquals("NOT_CONFIGURED", GuestNicknameVerifiedBridge.CODE_NOT_CONFIGURED)
        assertEquals("LB_ERROR", GuestNicknameVerifiedBridge.CODE_GENERIC)
    }

    @Test
    fun everyFailureKindMapsToADistinctCode() {
        // The three caller-visible categories (never sent / sent-and-refused /
        // sent-outcome-unknown) MUST stay distinguishable; collapsing any two codes
        // silently would defeat that.
        val codes = GuestNicknameVerifiedBridge.Failure.values()
            .map { GuestNicknameVerifiedBridge.rejectCode(it) }
        assertEquals(GuestNicknameVerifiedBridge.Failure.values().size, codes.toSet().size)
        assertTrue(codes.none { it.isEmpty() })
    }
}
