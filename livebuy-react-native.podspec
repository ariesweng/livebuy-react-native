require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "livebuy-react-native"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.description  = package["description"]
  s.homepage     = package["repository"]["url"]
  s.license      = { :type => "UNLICENSED", :text => "Proprietary — Livebuy. All rights reserved." }
  s.authors      = { "Livebuy" => "team@livebuy.tv" }
  s.platforms    = { :ios => "14.0" }
  s.swift_version = "5.9"
  s.source       = { :git => package["repository"]["url"], :tag => "#{s.version}" }

  # RN native bridge sources:
  #   • LivebuyRNBridge.swift / .m — the RCTEventEmitter module (classic bridge:
  #     RCT_EXTERN_MODULE / RCT_EXTERN_METHOD in the .m, Swift impl alongside).
  #   • Livebuy{Player,Widget,FloatingWidget}ViewManager.swift — the RCTViewManagers.
  s.source_files = "ios/**/*.{h,m,mm,swift}"

  # React runtime. This classic (non-TurboModule) bridge only needs React-Core —
  # RCTEventEmitter / RCTViewManager / RCTBridgeModule all live there. React-Core
  # is present under both the old and new architecture, so this stays broadly
  # compatible (incl. the sample's pinned RN 0.73). This dependency is sufficient
  # for `react-native config` autolink DETECTION + `pod install` to SUCCEED.
  s.dependency "React-Core"

  # ───────────────────────────────────────────────────────────────────────────
  # Core headless SDK — DECIDED: plan B (ios-core-cocoapods-podspec-distribution).
  #
  # The Swift bridge `import LivebuySDK` and calls `Livebuy.configure(...)`, so
  # this pod must link the core `LivebuySDK` XCFramework to fully COMPILE. The
  # core is now published as a CocoaPods pod (livebuy-ios-sdk/LivebuySDK.podspec —
  # a vendored LivebuySDK.xcframework + the pinned AWS IVS 1.52.0 engine),
  # mirroring the SwiftPM dist. Declared here so autolink pulls it transitively:
  # `~> 4.0` = CocoaPods optimistic operator, [4.0.0, 5.0.0) — aligned to the major
  # boundary introduced by the 2026-07-16 brand-casing rename (commit c140f4bf,
  # `LiveBuySDK`/`LiveBuyPlayerView` -> `LivebuySDK`/`LivebuyPlayerView`), mirroring
  # the SwiftPM `from: "4.0.0"` guidance in docs/handoff/ios-partner-integration-quickstart.md.
  # Any bound published before that commit (e.g. the prior `~> 3.1`) resolves to
  # pre-rename class names and fails this bridge's `import LivebuySDK` line. This bound
  # is a point-in-time snapshot of "current major line", not a lock on one version — it
  # will need bumping again if core ever cuts a new major; don't assume `4.0` stays the
  # answer forever.
  s.dependency "LivebuySDK", "~> 4.0"
  #
  # RESOLUTION — the consumer's Podfile MUST make the `LivebuySDK` pod findable
  # (exactly like SwiftPM consumers add `.package(url:)`, or the Android SDK's
  # Pages Maven repo). Pick ONE:
  #   • spec repo (recommended once published):
  #       source "https://github.com/ariesweng/livebuy-ios-podspecs.git"
  #       source "https://cdn.cocoapods.org"
  #   • release-attached podspec (zero extra infra — attached to each dist release;
  #     substitute the release tag for whatever the current published version is —
  #     this URL pattern, not the specific version number, is what's stable):
  #       pod "LivebuySDK", :podspec =>
  #         "https://github.com/ariesweng/livebuy-ios-sdk/releases/download/<current release tag>/LivebuySDK.podspec"
  #   • local dev (monorepo checkout):
  #       pod "LivebuySDK", :podspec => "<repo>/livebuy-ios-sdk/LivebuySDK.podspec"
  #
  # Without one of these, `pod install` stops with "unable to find a specification
  # for LivebuySDK" — the correct, expected plan-B behaviour (same as SwiftPM with
  # no `.package(url:)`), telling the integrator to add the core pod source.
  # ───────────────────────────────────────────────────────────────────────────
end
