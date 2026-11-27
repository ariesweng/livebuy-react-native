package tv.livebuy.rn

// rn-open-in-app-browser-scheme-guard-core — scheme guard for the RN bridge's
// `openInAppBrowser(url)` sink.
//
// `openInAppBrowser` is the only native URL-opening sink JS can call. Without this guard
// `CustomTabsIntent.launchUrl` would receive any non-blank string; Custom Tabs carries no
// package, so a non-web scheme (`intent:`, `market:`, an app's custom scheme, …) becomes an
// implicit ACTION_VIEW that another app can handle. Only http / https URLs with a host are
// browsable in an in-app browser; everything else is a safe no-op at the call site.
//
// Rule (kept identical to the JS wrapper's `isInAppBrowsableUrl` in
// react-native/src/LBInAppBrowserURL.ts):
//   1. the string starts with an RFC 3986 scheme followed by `:` — no leading whitespace;
//   2. that scheme, case-insensitively, is `http` or `https`;
//   3. the scheme is followed by exactly `//`;
//   4. the authority (up to the first `/`, `?` or `#`), minus any `userinfo@` and `:port`,
//      leaves a non-empty host.
// It is deliberately a string check, not `java.net.URI` (which rejects many real-world
// shop links with unencoded characters) and not `android.net.Uri` (not available on a
// plain JVM). Deliberately ZERO-Android / ZERO-SDK-dependency so the jvm-test project
// (InAppBrowserUrlPolicyTest) can run it.
internal object InAppBrowserUrlPolicy {
    private val SCHEME = Regex("^([A-Za-z][A-Za-z0-9+.\\-]*):")
    private val WEB_SCHEMES = setOf("http", "https")

    fun isInAppBrowsableUrl(url: String?): Boolean {
        if (url == null) return false
        val match = SCHEME.find(url) ?: return false
        if (match.groupValues[1].lowercase() !in WEB_SCHEMES) return false
        val rest = url.substring(match.range.last + 1)
        if (!rest.startsWith("//")) return false
        return hostOf(rest.substring(2)).isNotEmpty()
    }

    private fun hostOf(afterSlashes: String): String {
        val end = afterSlashes.indexOfFirst { it == '/' || it == '?' || it == '#' }
        val authority = if (end < 0) afterSlashes else afterSlashes.substring(0, end)
        val hostPort = authority.substringAfterLast('@')
        if (hostPort.startsWith("[")) {
            val close = hostPort.indexOf(']')
            return if (close > 1) hostPort.substring(1, close) else ""
        }
        return hostPort.substringBefore(':').trim()
    }
}
