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
