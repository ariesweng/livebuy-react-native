package tv.livebuy.rn

import tv.livebuy.sdk.models.LBComment

// rn-bridge-forward-backend-error-code-and-replay-raw-core — pure wire map for ONE revealed replay
// comment on the `LBReplayChatRevealed` channel (core `onReplayChatRevealed`).
//
// Same keys and omit rules as the core's own `CHAT_HISTORY_LOADED` comment payload
// (`replayHistoryEventComments` in LivebuyPlayerView.kt + `ChatComposePayload.addRaw`, both
// `internal` to the core, so mirrored here):
//   • always: `text` / `name` / `color` / `reply` / `reply_color` / `time` / `kind` (bridge-only key,
//     already sent before this change) and `composed_text` / `composed_name` / `composed_reply`;
//   • only when non-null: `is_anonymous` (Boolean) / `host_name` / `reply_template` (String; `""` is
//     a real value and is kept).
// `composed_*` are passed in (the caller reads `LBComment.composedText` etc. in the SDK's current
// language at emit time, same as the core payload) so this stays a pure, JVM-testable function.
internal object ReplayChatCommentWire {
    fun row(
        c: LBComment,
        composedText: String,
        composedName: String,
        composedReply: String,
    ): Map<String, Any> {
        val item = linkedMapOf<String, Any>(
            "text" to c.text, "name" to c.name, "color" to c.color,
            "reply" to c.reply, "reply_color" to c.replyColor,
            "time" to c.time, "kind" to c.kind.rawValue,
        )
        c.isAnonymous?.let { item["is_anonymous"] = it }
        c.hostName?.let { item["host_name"] = it }
        c.replyTemplate?.let { item["reply_template"] = it }
        item["composed_text"] = composedText
        item["composed_name"] = composedName
        item["composed_reply"] = composedReply
        return item
    }

    /** Production entry: composed values in the SDK's current language. */
    fun row(c: LBComment): Map<String, Any> =
        row(c, c.composedText, c.composedName, c.composedReply)
}
