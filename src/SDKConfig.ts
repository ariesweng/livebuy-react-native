// Type definitions for SDKConfig, mirroring `openspec/specs/sdk-config/spec.md`
// §"SDKConfig DTO 結構". The native side (iOS / Android) owns the cache and
// SWR logic; JS only receives serialized snapshots via `getSdkConfig()` /
// the `SDK_CONFIG_REFRESHED` / `SDK_CONFIG_LOAD_FAILED` event payloads.

export interface LBSdkVisibility {
  chat: boolean | null;
  productOverlay: boolean | null;
  activityNotification: boolean | null;
  endScreen: boolean | null;
  videoInfoPanel: boolean | null;
}

export interface LBSdkTheme {
  primaryColor: string | null;
  fontScale: number | null;
}

// Schema v1 reserves `behavior` empty — host should not put anything in it.
export type LBSdkBehavior = Record<string, never>;

/**
 * Opaque layout settings for the `livebuy-ui` template layer.
 * SDK core does NOT interpret or validate the map contents — values are
 * passed through as-is to the template layer at Widget/Player instantiate time.
 */
export interface LBSdkTemplateLayout {
  player: Record<string, unknown> | null;
  widget: Record<string, unknown> | null;
}

export interface SDKConfig {
  schemaVersion: number;
  visibility: LBSdkVisibility | null;
  theme: LBSdkTheme | null;
  behavior: LBSdkBehavior | null;
  layout: LBSdkTemplateLayout | null;
  extensions: Record<string, unknown>;
}

// Event payload types for the unified event listener (per
// `event-interceptor/spec.md` §"SDK_CONFIG_LOAD_FAILED 事件" / §"SDK_CONFIG_REFRESHED 事件").

export type LBSdkConfigLoadFailedSource =
  | 'configure'
  | 'background_refresh'
  | 'refresh'
  | 'cache_corrupted';

export interface LBSdkConfigLoadFailedParams {
  source: LBSdkConfigLoadFailedSource;
  fell_back_to_default: boolean;
  error_code: string;
  /**
   * 後端回應頂層 `error_code` 的原始字串（`backend-error-code-rn-core`，後端錯誤代碼目錄，例如
   * `shop_not_found` / `shop_disabled` / `unknown_error`）。**有值才帶**：只在 config 抓取失敗來自後端回應、
   * 且該回應帶 `error_code` 時出現；網路失敗、快取損毀、舊後端（不回 `error_code`）或 RN 包的原生 core
   * 不含 backend-error-code（iOS / Android core 4.29.0 及更早；需 4.29.0 之後的下一版）時整個省略（`undefined`）。
   * 與上方 `error_code`（SDK 公開穩定字串）是兩個不同的鍵，`error_code` 的值不變。
   * native bridge 對事件 params 整包泛型透傳，bridge 的原生 pin 升版後此鍵自動到達 JS。
   */
  backend_error_code?: string;
}

export type LBSdkConfigRefreshedSource = 'background_refresh' | 'refresh';

export interface LBSdkConfigRefreshedParams {
  source: LBSdkConfigRefreshedSource;
  /**
   * Snapshot of `sdkConfig` immediately before the refresh. `null` only in
   * the (currently unreachable) edge case where refresh is dispatched
   * without a prior cached value — kept nullable for spec-schema symmetry.
   */
  previous: SDKConfig | null;
  /** Snapshot of `sdkConfig` after the refresh — the new value. */
  current: SDKConfig;
}
