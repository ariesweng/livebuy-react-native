# livebuy-react-native

Headless core of the Livebuy React Native SDK — networking, 5-second polling, HMAC request
signing, the unified event bus, and the native iOS/Android bridge (`LivebuyRNBridge`
NativeModules + `LivebuyPlayerView` native view). Renders no UI.

> **Distribution.** This repository is a **mirror** — a public, organization-owned consumption
> copy synced from the private Livebuy SDK monorepo (`react-native/` package directory). It is
> not the primary development repository; source changes happen upstream and are synced here at
> release time.

> **Part of a three-package chain.** Most integrators also want the turnkey drop-in UI:
> [`livebuy-react-native-ui`](https://github.com/ariesweng/livebuy-react-native-ui) (view-model
> layer) and [`livebuy-react-native-reference-ui`](https://github.com/ariesweng/livebuy-react-native-reference-ui)
> (reference-ui pixel layer, `LivebuyPlayer` / `LivebuyWidget`). Unlike a single Android Maven
> coordinate or an iOS SwiftPM product, npm does **not** fetch the other Livebuy packages from
> this git channel for you — declare every package you need, one dependency line each (see
> Installation).

---

## Installation

npm's standard `git` dependency syntax — point at this repo and a release tag:

```json
{
  "dependencies": {
    "livebuy-react-native": "git+https://github.com/ariesweng/livebuy-react-native.git#v2.0.2"
  }
}
```

Then `npm install` (or `yarn` / `pnpm install`). No registry account or `.npmrc` token needed —
this is a plain public git dependency.

> **Declare every package you need.** If you also use the UI packages, declare them here too:
> `livebuy-react-native-ui` and `livebuy-react-native-reference-ui` declare their Livebuy peers
> with ordinary registry version ranges, and npm 7+ installs missing peers automatically — from
> registry.npmjs.org, where Livebuy does not publish these packages. If `livebuy-react-native`
> itself is missing from your `dependencies`, npm resolves it from the registry instead of this
> repo. Only the packages you declare yourself are installed from this git channel — **so declare
> each Livebuy package you use as its own `git+https://…` dependency line** (do not rely on
> `legacy-peer-deps` to silence the peer).

> **Why a git dependency and not npm registry?** The SDK is not (yet) published to the public npm
> registry; this mirror repository is the supported remote consumption channel. The tag you pin
> (`#v2.0.2`) corresponds to this package's `package.json` `version` field at release time — the
> channel itself does not hard-code any particular version string.

### Native linking

The native iOS (`livebuy-react-native.podspec`) and Android (`android/build.gradle`) packaging
files ship inside this package and are picked up by React Native's standard autolink
(`npx react-native config`). Run `pod install` in your iOS project as usual after installing.

---

## Getting Started

```typescript
import { LivebuySDK, LBEvents, registerListener } from 'livebuy-react-native';

LivebuySDK.configure({
  apiKey: 12345,            // number in RN (String on iOS/Android/Flutter)
  secret: '<your-secret>',  // HMAC signing secret — provided by Livebuy
  shopId: 'Pw8PJ99J',       // required — provided by Livebuy
});

const unsubscribe = registerListener((event) => {
  if (event.eventName === LBEvents.DISMISS_REQUEST) {
    // close your player UI — required, or the player can never be dismissed
  }
});
```

Full API surface, event catalogue, and `simulate*` methods for fully headless (Tier 0/1)
integrations: request the **component-contracts** document from Livebuy, or see the
[React Native partner integration quickstart](https://github.com/ariesweng/livebuy-react-native/blob/main/README.md)
(request the doc link from your Livebuy contact).

---

## Related packages

| Package | Role |
|---|---|
| `livebuy-react-native` (this repo) | headless core |
| `livebuy-react-native-ui` | view-model layer for drop-in overlays (call `LivebuyUI.install()` once at startup) |
| `livebuy-react-native-reference-ui` | drop-in turnkey pixel layer (`LivebuyPlayer` / `LivebuyWidget` / `CollapsibleLivebuyPlayer` / `LivebuyLiveEntry`) |

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

---

## License

Copyright © Livebuy. All rights reserved.
