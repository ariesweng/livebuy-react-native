package tv.livebuy.rn

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * rn-android-sdkconfig-null-key-parity-core — acceptance gate for the bridge-facing shape
 * of the `sdkConfig` opaque bags.
 *
 * Every assertion here is written to tell "the key is present with a null value" apart from
 * "the key was dropped" — `assertNull(map["k"])` alone CANNOT do that (a missing key also
 * reads back as null), so each null assertion is paired with `containsKey`. That pairing is
 * the whole point: the implementation this change replaces filtered null-valued keys out,
 * and a test that only checked "the non-null entries are still there" would have passed
 * against both.
 *
 * [SdkConfigOpaqueBag] is zero-Android / zero-React / zero-SDK by construction, so this runs
 * on a plain JVM with no android.jar stub, no Robolectric and no network-resolved Maven
 * artifact — the same arrangement as AutoPipPolicyTest / GuestNicknameVerifiedBridgeTest,
 * and the only executable coverage available for a module this repo cannot build.
 */
class SdkConfigOpaqueBagTest {

    // MARK: - absent bags stay as present keys

    @Test
    fun bothKeysExistWhenBothBagsAreAbsent() {
        // iOS writes `layoutDict["player"] = NSNull()` for an absent bag, so JS sees
        // `{ player: null, widget: null }` — NOT `{}`. Android must match.
        val out = SdkConfigOpaqueBag.layout(player = null, widget = null)

        assertTrue("player key must exist even when the bag is absent", out.containsKey("player"))
        assertTrue("widget key must exist even when the bag is absent", out.containsKey("widget"))
        assertNull(out["player"])
        assertNull(out["widget"])
        assertEquals(setOf("player", "widget"), out.keys)
    }

    @Test
    fun absentWidgetStillGetsAKeyWhenPlayerIsPresent() {
        val out = SdkConfigOpaqueBag.layout(player = mapOf("rows" to 3), widget = null)

        assertTrue(out.containsKey("widget"))
        assertNull(out["widget"])
        assertEquals(mapOf("rows" to 3), out["player"])
    }

    // MARK: - null-VALUED keys inside a bag survive

    @Test
    fun nullValuedKeyInsidePlayerBagIsKeptWithANullValue() {
        val player = mapOf("accent" to null, "rows" to 3)

        @Suppress("UNCHECKED_CAST")
        val outPlayer = SdkConfigOpaqueBag.layout(player, null)["player"] as Map<String, Any?>

        assertTrue("a null-valued key must NOT be dropped", outPlayer.containsKey("accent"))
        assertNull(outPlayer["accent"])
        assertEquals(3, outPlayer["rows"])
        assertEquals(setOf("accent", "rows"), outPlayer.keys)
    }

    @Test
    fun aBagThatIsEntirelyNullValuedDoesNotCollapseToEmpty() {
        // The sharpest form of the regression: under the old `filterValues { it != null }`
        // this bag reached JS as `{}` while iOS delivered three null-valued keys.
        val widget = mapOf("a" to null, "b" to null, "c" to null)

        @Suppress("UNCHECKED_CAST")
        val outWidget = SdkConfigOpaqueBag.layout(null, widget)["widget"] as Map<String, Any?>

        assertEquals(3, outWidget.size)
        assertEquals(setOf("a", "b", "c"), outWidget.keys)
        assertTrue(outWidget.values.all { it == null })
    }

    // MARK: - bags are passed through untouched, at any depth

    @Test
    fun bagIsTheSameInstanceSoNothingCanHaveBeenFilteredOrCopied() {
        val player = mapOf("accent" to null, "rows" to 3)
        val widget = mapOf("cols" to null)

        val out = SdkConfigOpaqueBag.layout(player, widget)

        assertSame("player bag must be handed over untouched", player, out["player"])
        assertSame("widget bag must be handed over untouched", widget, out["widget"])
    }

    @Test
    fun nestedObjectAndArrayNullsAreUntouched() {
        // Shaped after what `/sdk/config` is DEFINED to return for `extensions.floating_setting`
        // — a flat, single-level eight-field object (master enable/position/timing/delay + app
        // scope live/video/video_source/video_id, no `app` nesting) whose `video_id` default is
        // JSON null. Authority is the backend source (`SdkConfigService::$floatingDefault`) and
        // `openspec/specs/backend/sdk-config.md`, not a captured response. Plus an array carrying
        // a null element — both must reach the bridge intact so that paramsToMap / listToArray
        // can emit putNull / pushNull for them.
        val player = mapOf(
            "floating_setting" to mapOf(
                "enable" to 1,
                "position" to "left_bottom",
                "timing" to "immediate",
                "delay" to 3,
                "live" to 1,
                "video" to 0,
                "video_source" to "latest",
                "video_id" to null,
            ),
            "tags" to listOf("a", 2, null, mapOf("k" to "v")),
        )

        @Suppress("UNCHECKED_CAST")
        val outPlayer = SdkConfigOpaqueBag.layout(player, null)["player"] as Map<String, Any?>

        @Suppress("UNCHECKED_CAST")
        val floatingSetting = outPlayer["floating_setting"] as Map<String, Any?>
        assertTrue("nested null-valued key must survive", floatingSetting.containsKey("video_id"))
        assertNull(floatingSetting["video_id"])
        assertEquals(1, floatingSetting["live"])
        assertEquals("latest", floatingSetting["video_source"])
        // Master-layer fields ride along flattened, and the whole key set survives the trip —
        // a bag that loses (or nests) any of these is what this gate exists to catch.
        assertEquals(1, floatingSetting["enable"])
        assertEquals("left_bottom", floatingSetting["position"])
        assertEquals("immediate", floatingSetting["timing"])
        assertEquals(3, floatingSetting["delay"])
        assertEquals(
            setOf(
                "enable", "position", "timing", "delay",
                "live", "video", "video_source", "video_id",
            ),
            floatingSetting.keys,
        )

        val tags = outPlayer["tags"] as List<*>
        assertEquals("a null element must keep its slot", 4, tags.size)
        assertEquals(listOf("a", 2, null, mapOf("k" to "v")), tags)
    }

    @Test
    fun aBagWithNoNullsIsUnchanged() {
        // The no-null case must be a pure identity — this change must not perturb the
        // payload shape production hosts see today.
        val player = mapOf("show_stock" to 1, "widget_view_type" to "full_w")

        val out = SdkConfigOpaqueBag.layout(player, null)

        assertEquals(player, out["player"])
        assertEquals(setOf("player", "widget"), out.keys)
    }

    // MARK: - the wrapper itself never invents or renames keys

    @Test
    fun exactlyTwoKeysAreProducedForEveryInputCombination() {
        val bags = listOf(null, emptyMap(), mapOf("x" to null), mapOf("x" to 1))
        for (player in bags) {
            for (widget in bags) {
                val out = SdkConfigOpaqueBag.layout(player, widget)
                assertEquals(
                    "layout must always be exactly {player, widget} — player=$player widget=$widget",
                    listOf("player", "widget"),
                    out.keys.toList(),
                )
            }
        }
    }
}
