import Foundation
import LivebuySDK

// rn-bridge-forward-backend-error-code-and-replay-raw-core — pure wire helpers for the RN iOS bridge.
//
// 1. Backend error code: the core's raw backend `error_code` (`LBError.backendErrorCode`, read at
//    catch time) goes to JS under ONE key, `backendErrorCode` (camelCase) —
//      • Promise reject: in the rejecting `NSError.userInfo` (RN copies it to the JS error's
//        `userInfo`, which `pickBackendErrorCode` in src/LivebuySDK.ts reads);
//      • `LBError` event body: as a top-level key (the TS `LBError.backendErrorCode` field).
//    Present only when non-empty; otherwise nothing changes (same error object / same body).
// 2. Replay chat reveal: one revealed `LBComment` → the `LBReplayChatRevealed` row, with the same
//    keys / omit rules as the core's `CHAT_HISTORY_LOADED` comments (`replayHistoryEventComments` +
//    `ChatComposePayload.addRaw`, both internal to the core, so mirrored here).
extension LivebuyRNBridge {

    static let backendErrorCodeKey = "backendErrorCode"

    /// The code to forward, or nil when absent / empty.
    static func nonEmptyBackendErrorCode(_ code: String?) -> String? {
        guard let code = code, !code.isEmpty else { return nil }
        return code
    }

    /// The error to hand to `reject`: unchanged when there is no code; otherwise an `NSError` with
    /// the same domain / code / userInfo plus `backendErrorCode`.
    static func rejectionError(_ error: Error?, backendErrorCode: String?) -> Error? {
        guard let code = nonEmptyBackendErrorCode(backendErrorCode) else { return error }
        let ns = error.map { $0 as NSError }
        var info = ns?.userInfo ?? [:]
        if let ns = ns, info[NSLocalizedDescriptionKey] == nil {
            info[NSLocalizedDescriptionKey] = ns.localizedDescription
        }
        info[backendErrorCodeKey] = code
        return NSError(domain: ns?.domain ?? "LivebuyRNBridge", code: ns?.code ?? 0, userInfo: info)
    }

    /// Production entry: reads `LBError.backendErrorCode` from the caught error.
    static func rejectionError(_ error: Error) -> Error? {
        rejectionError(error, backendErrorCode: (error as? LBError)?.backendErrorCode)
    }

    /// Adds `backendErrorCode` to an `LBError` event body when non-empty.
    static func errorEventBody(_ base: [String: Any], backendErrorCode: String?) -> [String: Any] {
        guard let code = nonEmptyBackendErrorCode(backendErrorCode) else { return base }
        var body = base
        body[backendErrorCodeKey] = code
        return body
    }

    /// One `LBReplayChatRevealed` row. `composed_*` always; `is_anonymous` / `host_name` /
    /// `reply_template` only when non-nil (`""` is a real value and is kept).
    static func replayChatCommentRow(_ c: LBComment, composedText: String,
                                     composedName: String, composedReply: String) -> [String: Any] {
        var row: [String: Any] = [
            "text": c.text, "name": c.name, "color": c.color,
            "reply": c.reply, "reply_color": c.replyColor,
            "time": c.time, "kind": c.kind.rawValue,
            "composed_text": composedText, "composed_name": composedName,
            "composed_reply": composedReply,
        ]
        if let anonymous = c.isAnonymous { row["is_anonymous"] = anonymous }
        if let hostName = c.hostName { row["host_name"] = hostName }
        if let replyTemplate = c.replyTemplate { row["reply_template"] = replyTemplate }
        return row
    }

    /// Production entry: composed values in the SDK's current language (same as the core payload).
    static func replayChatCommentRow(_ c: LBComment) -> [String: Any] {
        replayChatCommentRow(c, composedText: c.composedText, composedName: c.composedName,
                             composedReply: c.composedReply)
    }
}
