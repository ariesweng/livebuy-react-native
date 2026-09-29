/**
 * JS 端 pending-retry 註冊表（rn-dispatch-auth-required-js-pending-retry-core）。
 *
 * 原生 `registerPendingRetry` 吃原生 closure，JS closure 無法跨 bridge，故 RN 端 template / host
 * 自己的 JS closure 存在這裡。token 以 `js-` 為前綴，與原生 token 不碰撞。純模組，無副作用依賴，便於單測。
 */
export const JS_RETRY_TOKEN_PREFIX = 'js-';

const pending = new Map<string, () => void>();
let counter = 0;

/** 產生 `js-` 前綴的 opaque token（遞增計數 + 隨機片段）。 */
export function makeJsRetryToken(): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 10);
  return `${JS_RETRY_TOKEN_PREFIX}${counter.toString(36)}-${rand}`;
}

export function registerJsPendingRetry(action: () => void): string {
  let token = makeJsRetryToken();
  while (pending.has(token)) token = makeJsRetryToken();
  pending.set(token, action);
  return token;
}

/** 一次性取出並移除；未命中回 undefined。 */
export function takeJsPendingRetry(token: string): (() => void) | undefined {
  const action = pending.get(token);
  if (action) pending.delete(token);
  return action;
}

/** 移除但不執行；回傳是否命中。 */
export function discardJsPendingRetry(token: string): boolean {
  return pending.delete(token);
}

export function clearJsPendingRetries(): void {
  pending.clear();
}
