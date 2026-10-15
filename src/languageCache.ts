// i18n-language-source-rn-core — JS-side synchronous cache of the native core's
// current language (iOS `Livebuy.currentLanguage` / Android `LivebuySDK.currentLanguage`).
//
// RN wraps the native core on both platforms, so the language priority
// (host > device system language > API `lang` > `en`) and the
// `LANGUAGE_CHANGED` dispatch timing are inherited from native. What RN lacked
// was a way for JS (e.g. `react-native-reference-ui`) to READ the current
// language. This module keeps a synchronous snapshot, refreshed by:
//   - an async native read (`fetch`, i.e. `LivebuyRNBridge.getLanguage()`), and
//   - the unified `LANGUAGE_CHANGED { from, to }` event (`to` is applied).
//
// Race rule (sequence number, "newest wins"): every native read captures the
// sequence value at issue time, and every applied event bumps the sequence. A
// read's response is applied only if no event arrived and no newer read was
// issued in between. So a stale read that resolves after a `LANGUAGE_CHANGED`
// can never overwrite the newer value carried by the event.
//
// Kept as a factory with injected deps so it is unit-testable without the RN
// runtime; `LivebuySDK.ts` wires the singleton to the real bridge + emitter.

import type { LBLocaleCode } from './LivebuySDK';

export const LB_SUPPORTED_LOCALES: readonly LBLocaleCode[] = ['zh-TW', 'zh-CN', 'en', 'ms-MY', 'id-ID'];

/**
 * Initial value before any native read / event arrives (= the native core's final
 * fallback, `en` — `i18n-fallback-en-rn-core`).
 */
export const LB_FALLBACK_LOCALE: LBLocaleCode = 'en';

export function isLBLocaleCode(value: unknown): value is LBLocaleCode {
  return typeof value === 'string' && (LB_SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export type LBLanguageListener = (lang: LBLocaleCode) => void;

export interface LanguageCacheDeps {
  /** Native read. May return a non-Promise (e.g. an unset jest mock) — tolerated. */
  fetch: () => unknown;
}

export interface LanguageCache {
  /** Current cached value (synchronous). */
  readonly current: LBLocaleCode;
  /** Issue a native read; resolves the native value; applies it unless superseded. */
  refresh(): Promise<LBLocaleCode>;
  /** Apply a `LANGUAGE_CHANGED` event's `to` (ignored if unsupported). Always wins over in-flight reads. */
  applyEvent(to: unknown): void;
  /** Subscribe; notified only when the cached value actually changes. Returns unsubscribe. */
  addListener(listener: LBLanguageListener): () => void;
}

export function createLanguageCache(deps: LanguageCacheDeps): LanguageCache {
  let current: LBLocaleCode = LB_FALLBACK_LOCALE;
  let seq = 0;
  const listeners = new Set<LBLanguageListener>();

  function set(next: LBLocaleCode): void {
    if (next === current) return;
    current = next;
    // Snapshot so a listener unsubscribing during notification is safe.
    Array.from(listeners).forEach((l) => {
      try {
        l(next);
      } catch {
        // One faulty listener must not block the others.
      }
    });
  }

  function refresh(): Promise<LBLocaleCode> {
    const issuedAt = ++seq;
    let raw: unknown;
    try {
      raw = deps.fetch();
    } catch (e) {
      return Promise.reject(e);
    }
    return Promise.resolve(raw).then((value) => {
      if (!isLBLocaleCode(value)) {
        throw new Error(`getLanguage: unexpected native value ${String(value)}`);
      }
      if (issuedAt === seq) set(value);
      return value;
    });
  }

  function applyEvent(to: unknown): void {
    if (!isLBLocaleCode(to)) return;
    seq++; // invalidate every in-flight read
    set(to);
  }

  function addListener(listener: LBLanguageListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    get current() {
      return current;
    },
    refresh,
    applyEvent,
    addListener,
  };
}
