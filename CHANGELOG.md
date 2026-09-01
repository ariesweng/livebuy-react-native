# Changelog

All notable changes to `livebuy-react-native` (distributed via this mirror repository) will be
documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Distribution.** This package is served as a public git dependency
> (`git+https://github.com/ariesweng/livebuy-react-native.git#v<ver>`). The published `<ver>` is
> read from this package's own `package.json` `version` field at release time; the channel itself
> is version-agnostic.

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
