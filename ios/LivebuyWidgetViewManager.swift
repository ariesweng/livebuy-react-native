import Foundation
import React
import LivebuySDK

// MARK: - LivebuyWidgetRNView — UIView wrapping LivebuyWidgetCore

final class LivebuyWidgetRNView: UIView {

    private(set) var widget: LivebuyWidgetCore?

    func configure(shopId: String) {
        if widget == nil {
            let w = LivebuyWidgetCore(shopId: shopId, mode: .carousel)
            widget = w
            addSubview(w)
            w.translatesAutoresizingMaskIntoConstraints = false
            NSLayoutConstraint.activate([
                w.topAnchor.constraint(equalTo: topAnchor),
                w.leadingAnchor.constraint(equalTo: leadingAnchor),
                w.trailingAnchor.constraint(equalTo: trailingAnchor),
                w.bottomAnchor.constraint(equalTo: bottomAnchor),
            ])
            // widget-bridge-color-core / widget-product-card-bridge-rn
            // (This file is not linked against a real LivebuySDK inside this
            // monorepo — no Podfile here resolves the dependency — so it is not
            // compiled by `npm run typecheck` / `npm test`, which only cover the
            // TypeScript/Jest layer and cannot catch native Swift breakage. Type
            // references here must be checked by hand against the current core
            // SDK, or via an ad hoc real `swiftc` compile — see
            // fix-rn-bridge-widget-core-rename-nullability/design.md). After the
            // carousel/grid `POST /sdk/widget` fetch the core widget view retains
            // `widgetColor`
            // (Int) / `widgetBgcolor` (String?) / `productCard` (String?) as
            // read-only host state. Bridge them to JS as a snake_case
            // `LBWidgetResponse` event so `<LivebuyWidget onWidgetResponse>` can map
            // them to camelCase. RAW PASSTHROUGH — never interpret or mix with
            // sdkConfig.theme.
            Task { @MainActor in
                await w.loadFirstPage()
                self.emitWidgetResponse()
            }
        }
    }

    /// Emits the retained widget root settings to JS via the singleton
    /// RCTEventEmitter as `LBWidgetResponse`. snake_case wire keys; the
    /// floating widget never reaches here (carousel/grid only).
    ///
    /// widget-product-card-bridge-rn — `product_card` follows the same three-state
    /// convention this event already uses for `widget_bgcolor`: nil crosses the bridge
    /// as JS `null`, NOT as the backend default `"inside"`. Substituting the default
    /// here would erase the difference between "the backend sent nothing" (linetv
    /// branch) and "the backend sent inside"; applying a default is the UI layer's job.
    private func emitWidgetResponse() {
        guard let w = widget else { return }
        LivebuyRNBridge.shared?.sendEvent(
            withName: "LBWidgetResponse",
            body: [
                "widget_color": w.widgetColor,
                // String? → NSNull when nil so the JS bridge receives `null`,
                // mapped to `widgetBgcolor: null` (raw passthrough).
                "widget_bgcolor": w.widgetBgcolor ?? NSNull(),
                // String? → NSNull when nil → `productCard: null` (raw passthrough).
                "product_card": w.productCard ?? NSNull(),
            ]
        )
    }

    // MARK: - simulate* forwarding

    func simulateCardTap(_ map: NSDictionary) {
        guard let video = lbVideoItemFromArgs(map) else { return }
        widget?.simulateCardTap(video)
    }

    func simulateClose() {
        widget?.simulateClose()
    }

    func simulateCardVisibilityChanged(_ map: NSDictionary, visible: Bool) {
        guard let video = lbVideoItemFromArgs(map) else { return }
        widget?.simulateCardVisibilityChanged(video, visible: visible)
    }
}

// MARK: - LivebuyFloatingWidgetRNView — UIView wrapping FloatingWidget

final class LivebuyFloatingWidgetRNView: UIView {

    private(set) var widget: FloatingWidget?

    func configure(videoId: String) {
        if widget == nil {
            let w = FloatingWidget(videoId: videoId)
            widget = w
            addSubview(w)
            w.translatesAutoresizingMaskIntoConstraints = false
            NSLayoutConstraint.activate([
                w.topAnchor.constraint(equalTo: topAnchor),
                w.leadingAnchor.constraint(equalTo: leadingAnchor),
                w.trailingAnchor.constraint(equalTo: trailingAnchor),
                w.bottomAnchor.constraint(equalTo: bottomAnchor),
            ])
        }
    }

    func simulateClose() { widget?.simulateClose() }
    func simulateTap()   { widget?.simulateTap() }
}

// MARK: - LivebuyWidgetViewManager — RCTViewManager

@objc(LivebuyWidgetViewManager)
final class LivebuyWidgetViewManager: RCTViewManager {

    override static func requiresMainQueueSetup() -> Bool { return true }

    override func view() -> UIView! {
        return LivebuyWidgetRNView()
    }

    private func withView(tag: NSNumber, block: @escaping (LivebuyWidgetRNView) -> Void) {
        DispatchQueue.main.async {
            guard let view = self.bridge.uiManager.view(forReactTag: tag) as? LivebuyWidgetRNView else { return }
            block(view)
        }
    }

    @objc func configure(_ reactTag: NSNumber, shopId: String) {
        withView(tag: reactTag) { $0.configure(shopId: shopId) }
    }

    @objc func simulateCardTap(_ reactTag: NSNumber, video: NSDictionary) {
        withView(tag: reactTag) { $0.simulateCardTap(video) }
    }

    @objc func simulateClose(_ reactTag: NSNumber) {
        withView(tag: reactTag) { $0.simulateClose() }
    }

    @objc func simulateCardVisibilityChanged(_ reactTag: NSNumber, video: NSDictionary, visible: Bool) {
        withView(tag: reactTag) { $0.simulateCardVisibilityChanged(video, visible: visible) }
    }
}

// MARK: - LivebuyFloatingWidgetViewManager — RCTViewManager

@objc(LivebuyFloatingWidgetViewManager)
final class LivebuyFloatingWidgetViewManager: RCTViewManager {

    override static func requiresMainQueueSetup() -> Bool { return true }

    override func view() -> UIView! {
        return LivebuyFloatingWidgetRNView()
    }

    private func withView(tag: NSNumber, block: @escaping (LivebuyFloatingWidgetRNView) -> Void) {
        DispatchQueue.main.async {
            guard let view = self.bridge.uiManager.view(forReactTag: tag) as? LivebuyFloatingWidgetRNView else { return }
            block(view)
        }
    }

    @objc func configure(_ reactTag: NSNumber, videoId: String) {
        withView(tag: reactTag) { $0.configure(videoId: videoId) }
    }

    @objc func simulateClose(_ reactTag: NSNumber) {
        withView(tag: reactTag) { $0.simulateClose() }
    }

    @objc func simulateTap(_ reactTag: NSNumber) {
        withView(tag: reactTag) { $0.simulateTap() }
    }
}

// MARK: - LBVideoItem deserializer (Widget bridge)

private func lbVideoItemFromArgs(_ map: NSDictionary) -> LBVideoItem? {
    // Reconstruct a minimal LBVideoItem from bridge-serialized fields.
    // All required LBVideoItem fields are filled with safe defaults if absent.
    guard let id = map["id"] as? String else { return nil }
    let json: [String: Any] = [
        "id": id,
        "type": (map["type"] as? Int) ?? 1,
        "title": map["title"] as? String ?? "",
        "cover": map["cover"] as? String ?? "",
        "preview": "",
        "duration": 0,
        "publish_at": "2000-01-01 00:00:00",
        "watch_num": 0,
        "pv_num": 0,
        "live_status": (map["liveStatus"] as? Int) ?? 1,
        "pin": 0,
        "show_pv_num": 0,
        "liveurl": map["liveurl"] as? String ?? "",
        "playbackurl": map["playbackurl"] as? String ?? "",
        "preview_time": "00:00",
        "show_stock": 0,
        "goods": [
            "name": "", "pic": "", "price": "0",
            "original_price": "0", "sold_out": 0, "stock": 0, "status": 1
        ] as [String: Any],
    ]
    guard let data = try? JSONSerialization.data(withJSONObject: json),
          let item = try? JSONDecoder().decode(LBVideoItem.self, from: data) else { return nil }
    return item
}
