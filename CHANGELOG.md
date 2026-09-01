# Changelog

All notable changes to `livebuy-react-native` (distributed via this mirror repository) will be
documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Distribution.** This package is served as a public git dependency
> (`git+https://github.com/ariesweng/livebuy-react-native.git#v<ver>`). The published `<ver>` is
> read from this package's own `package.json` `version` field at release time; the channel itself
> is version-agnostic.

## [2.0.2] - 2026-09-02

### Fixed

`2.0.1` fixed the originally-reported iOS compile error, but the same and a neighboring native
bridge file had never actually compiled far enough for several other pre-existing bugs to
surface. This release fixes all of them, found by actually compiling the real native bridge
source against the real, currently-published core SDK end-to-end:

- **iOS**: two more bugs in the widget bridge (a type-inference issue in the widget-response
  event emitter; a model no longer decodable via `JSONDecoder`).
- **iOS**: the main player bridge (`LivebuyRNBridge.swift`) had never compiled successfully
  against a real SDK at all — three more non-decodable-model issues, 26 sub-component command
  handlers reaching into now-inaccessible internal SDK properties (rewired to the SDK's public
  action API), an `apiKey` type mismatch, and one missing forwarding method.
- **Android**: no changes — `2.0.1` already fixed everything reported there.

If you installed `2.0.1` (iOS) and it still didn't compile, upgrade to `2.0.2` — no other changes,
no migration needed. If you hit a *different* native compile error after installing `2.0.2`,
please report it.

## [2.0.1] - 2026-09-01

### Fixed

- **iOS bridge failed to compile** — `LivebuyWidgetViewManager.swift` referenced a bare
  `LivebuyWidget` type that no longer exists in the `LivebuySDK` module (renamed to
  `LivebuyWidgetCore` upstream); every 4.x core SDK version hit
  `error: cannot find type 'LivebuyWidget' in scope`. Fixed by updating the reference to
  `LivebuyWidgetCore` — behavior and signature are unchanged.
- **Android bridge failed to compile** — three command handlers in
  `LivebuyPlayerViewManager.kt` (`load` / `sendChat` / `requestEventJoin`) passed a nullable
  `String?` where the core SDK requires non-null `String`, producing `Argument type mismatch`
  errors. Fixed with the same null-handling already used by sibling commands in the same file.
- **Android bridge failed to compile on newer React Native** — `LivebuyRNModule.kt` called an
  unqualified `currentActivity`, which no longer resolves on React Native versions where the
  base `ReactContextBaseJavaModule` class was rewritten in Kotlin (observed on RN 0.85+,
  including 0.87.1 with the New Architecture). Fixed by using `reactContext.currentActivity`.

If you installed `2.0.0` and hit any of the errors above, upgrade to `2.0.1` — no other changes,
no migration needed.

## [2.0.0] - 2026-09-01

### Added

First real release of the `livebuy-react-native` mirror repository. Headless core bridge for
iOS/Android (native `LivebuyRNBridge` + `LivebuyPlayerView`), request signing, polling, and the
unified event bus. See the [React Native partner integration
quickstart](https://github.com/ariesweng/livebuy-react-native/blob/main/README.md) or request the
**component-contracts** document from your Livebuy contact for the full API surface and event
catalogue.
