// AUTO-GENERATED FILE - DO NOT EDIT.
// Source: tools/event-codegen/events.json
// Regenerate: node tools/event-codegen/codegen.js --write

export const LBEvents = {
  /** 用戶進入影音 Widget 並開始播放。 */
  VIDEO_OPEN: "VIDEO_OPEN",
  /** 用戶滑動切換至下一支影片。 */
  VIDEO_SWITCH: "VIDEO_SWITCH",
  /** 用戶點擊按讚。 */
  VIDEO_LIKE: "VIDEO_LIKE",
  /** 用戶送出留言。 */
  VIDEO_COMMENT: "VIDEO_COMMENT",
  /** 用戶完成分享動作後的純通知（分享內容客製見 VIDEO_SHARE_REQUEST）。 */
  VIDEO_SHARE: "VIDEO_SHARE",
  /** 影片觀看心跳。每播放 5 秒或到 25/50/75/100% 節點時觸發；間隔可由 log_config 動態調整、可抽樣。 */
  VIDEO_HEARTBEAT: "VIDEO_HEARTBEAT",
  /** 用戶點開影片商品資訊面板。 */
  INFO_PRODUCT_VIEW: "INFO_PRODUCT_VIEW",
  /** 用戶在影音內點擊領取優惠券。 */
  COUPON_CLAIM: "COUPON_CLAIM",
  /** 第三方呼叫 setUser / clearUser 後 SDK 派發的身份變更通知。 */
  AUTH_STATE_CHANGED: "AUTH_STATE_CHANGED",
  /** 第三方呼叫 setLanguage 後 SDK 派發的語言變更通知。 */
  LANGUAGE_CHANGED: "LANGUAGE_CHANGED",
  /** 第三方呼叫 notifyCheckoutCompleted 後 SDK 派發的訂單完成通知。 */
  CHECKOUT_COMPLETED: "CHECKOUT_COMPLETED",
  /** 到貨追蹤 API（POST /sdk/goods/await）成功（code==200）後 SDK 背景派發的通知型事件。供 host 同步 UI 開關狀態。 */
  AWAIT_GOODS_CHANGED: "AWAIT_GOODS_CHANGED",
  /** 補貨通知 API（POST /sdk/goods/notice）成功（code==200）後 SDK 背景派發的通知型事件。供 host 同步 UI 開關狀態。 */
  NOTICE_GOODS_CHANGED: "NOTICE_GOODS_CHANGED",
  /** 加購（Tier 2）：SDK addToCart() 成功打 POST /sdk/video/addcart 之後派發的通知型事件（背景派發、不可攔截、無 cartCallback）。host 加入自家購物車 + 把 sdk_track_code/track_id 存進訂單 → best-effort reportCartTrack；成交歸因走 host order webhook（強制）。award-product-auto-cart：商品獎品領獎成功時 SDK 也會自動觸發一次加購，該筆事件多帶 award_winner_id（＝中獎票券 id，同 AWARD_CLAIM_RESULT 的 winner_id）供 host 識別「這筆是獎品」；一般加購整個省略此 key。 */
  CART_ADD_REQUEST: "CART_ADD_REQUEST",
  /** 用戶未登入時觸發核心互動。回傳 true 接手登入流程；30 秒內呼叫 setUser 可 auto-replay。 */
  AUTH_REQUIRED: "AUTH_REQUIRED",
  /** 用戶點擊商品圖。回傳 true 由第三方接手商品詳情頁。 */
  PRODUCT_CLICK: "PRODUCT_CLICK",
  /** 用戶點擊分享按鈕。透過 shareContext 可覆寫網址與標題；回傳 true 完全接手分享 sheet。 */
  VIDEO_SHARE_REQUEST: "VIDEO_SHARE_REQUEST",
  /** 用戶點擊客服按鈕。回傳 true 由第三方接手客服系統。 */
  INFO_CUSTOMER_SERVICE: "INFO_CUSTOMER_SERVICE",
  /** Player 狀態機轉換廣播（loading / buffering / playing / paused / ended / error）。 */
  VIDEO_STATE_CHANGE: "VIDEO_STATE_CHANGE",
  /** PollManager 每 5 秒 /sdk/video/messages 成功回應後的 raw payload 廣播（第三方可自行 post-process）。 */
  POLL_RECEIVED: "POLL_RECEIVED",
  /** 任一 Player 或子元件 API 失敗的統一錯誤出口。 */
  VIDEO_ERROR: "VIDEO_ERROR",
  /** ChatView 可見性翻轉。 */
  CHAT_TOGGLE: "CHAT_TOGGLE",
  /** ProductOverlay 商品列表面板開合。 */
  PRODUCT_PANEL_TOGGLE: "PRODUCT_PANEL_TOGGLE",
  /** ProductOverlay 推播卡收起（autoDismiss / userTap / replacedByNew）。 */
  PRODUCT_CARD_DISMISS: "PRODUCT_CARD_DISMISS",
  /** SubtitleTrack 字幕開關翻轉。 */
  SUBTITLE_TOGGLE: "SUBTITLE_TOGGLE",
  /** 用戶觸發聯繫客服連結。回傳 true 由第三方接手開連結；無 listener / 回 false 時 SDK no-op。 */
  SERVICE_LINK_REQUEST: "SERVICE_LINK_REQUEST",
  /** Guest 用戶觸發顯示名稱修改。回傳 true 由第三方提供 UI 流程；host 之後呼叫 LivebuySDK.setUser。 */
  GUEST_NAME_EDIT_REQUEST: "GUEST_NAME_EDIT_REQUEST",
  /** 用戶觸發關閉播放器。回傳 true 由第三方執行 dismiss/pop；無 listener 時 SDK no-op（host 必須 listen 否則 player 無法關閉）。注意：用戶意圖是『關閉』Player，因此不觸發 auto-PiP（與 PRODUCT_CLICK / INFO_CUSTOMER_SERVICE 等 navigation 不同）。 */
  DISMISS_REQUEST: "DISMISS_REQUEST",
  /** 訂閱/取消訂閱 API 成功後的廣播。 */
  SUBSCRIBE_CHANGED: "SUBSCRIBE_CHANGED",
  /** 用戶於 chat event-begin 訊息觸發「加入活動」。回傳 true 由第三方接手；無 listener 時 SDK no-op（不自動 sendChat，避免雙重提交）。 */
  EVENT_JOIN_INTENT: "EVENT_JOIN_INTENT",
  /** PiP 進入 / 離開狀態廣播。 */
  PIP_STATE_CHANGE: "PIP_STATE_CHANGE",
  /** Widget 卡片進入/離開可見區（影響預覽播放與 maxConcurrentPreviews LRU）。 */
  CARD_VISIBILITY_CHANGED: "CARD_VISIBILITY_CHANGED",
  /** Widget grid 模式滾動觸底，請求下一頁。 */
  LOAD_MORE: "LOAD_MORE",
  /** Widget floating 視窗被關閉（sticky for session）。 */
  WIDGET_CLOSE: "WIDGET_CLOSE",
  /** 愛心 API 250ms throttle 後實際呼叫成功的廣播（UI 層可同步動畫節拍）。 */
  LIKE_PERFORMED: "LIKE_PERFORMED",
  /** configure() 完成後一次性派發；通知 host App 缺漏的平台 capability（背景音 mode、PiP entitlement、AndroidManifest 等）。 */
  CAPABILITY_WARNING: "CAPABILITY_WARNING",
  /** Player ⇄ FloatingWidget minimize/expand transition 完成（v1.x scope deferred，永不 emit；下一個 UI propose 啟用）。 */
  MINIMIZE_STATE_CHANGE: "MINIMIZE_STATE_CHANGE",
  /** 後端回應 header X-API-Deprecation=true 時派發；SDK 版本即將被退役但仍可運作。每 process lifecycle 至多 emit 一次（per api-versioning spec）。 */
  SDK_DEPRECATION_NOTICE: "SDK_DEPRECATION_NOTICE",
  /** /sdk/config 拉取或 parse 失敗時派發；payload 告知失敗來源（configure / background_refresh / refresh / cache_corrupted）與是否退回 fallback default。不去重。 */
  SDK_CONFIG_LOAD_FAILED: "SDK_CONFIG_LOAD_FAILED",
  /** /sdk/config 背景 refresh 或 refreshConfig() 成功且新值與舊值 raw JSON 不同時派發。Payload `previous` / `current` 為完整 SDKConfig snapshot(object)。SDK 不主動 re-render；host 自行決定是否 reload view。 */
  SDK_CONFIG_REFRESHED: "SDK_CONFIG_REFRESHED",
  /** 用戶確認領取中獎獎品（template 於 LBWinSheet 確認後呼叫 requestAwardClaim）。回傳 true 由第三方接手領獎流程；未攔截時 SDK 呼叫 POST /sdk/video/claim（預設為 API call，非 no-op）。params.id 為 participant ticket id（= winner.id），非 video_id、非 award code。 */
  AWARD_CLAIM_INTENT: "AWARD_CLAIM_INTENT",
  /** SDK 完成內建領獎 API（POST /sdk/video/claim）後背景派發的通知，不可攔截。params 10 key 分兩類：記憶體來源 status、award_type=winner.award.type、winner_id=winner.id 恆帶，event_title=winner.title 非空才帶；API 回應來源 event_id、award_name、award_image_url、award_stock 僅成功時帶（award_code／award_expiration 限 discount；award_stock 含 0＝無庫存）。失敗（含 email 缺漏 fail-fast 未打 API）只帶記憶體來源。nil／空字串的 key 整個省略、不送空字串。status 僅 claimed（code 200）／failed（code 500，後端不區分已領取／過期／非中獎／bad-id），其他 unknown_ 前綴。SDK 不導頁、不渲染 UI；discount 型不加入購物車，product 型為明確例外——claim 成功即派本事件（不等加購）、加購成功再派 CART_ADD_REQUEST（多帶 award_winner_id）；加購失敗時 status 仍為 claimed 且不派任何事件，故 product 的 claimed 若無配對 CART_ADD_REQUEST 即代表獎品未進結帳清單。host 不應自行重複加購。 */
  AWARD_CLAIM_RESULT: "AWARD_CLAIM_RESULT",
  /** SDK 從 POST /sdk/video/goods 回應取得個人化中獎 winner（登入態才有值）時派發的通知型事件。params 帶完整 winner（id/event_id/title/award_type/award_name/award_code）。供 host/template 顯示中獎入口並接續領獎流程；沿用 winner 去重，同一 winner.id 不重複派發。 */
  WIN_RECEIVED: "WIN_RECEIVED",
  /** 用戶點擊『查看購物車』CTA（商品列表底部 / 商品詳情頁）後 SDK 派發的通知型事件（背景派發、不可攔截、無 cartCallback）。template 不擁有任何購物車/結帳頁（D4），host 收到後自行收起/縮小播放器並導航至自家購物車頁。params 含 video_id（必）與 product_id（選填，詳情頁 CTA 才有，列表底部 CTA 省略 key）。 */
  VIEW_CART: "VIEW_CART",
  /** 回放（已結束直播 finished-live replay）進場自動載入觀眾歷史留言後 SDK 派發的通知型事件（背景派發、不可攔截、無 callback）。跟著分頁游標翻到底抓取全部歷史留言，全部頁抓完後一次派發（不再只給第一頁）。drop-in（reference-ui）經 chatView 直接渲染、不靠此事件；headless host（RN/Flutter）無 chatView 且回放不啟 PollManager 故 POLL_RECEIVED 不會送，需經此事件取得回放歷史留言以自繪聊天。params 含 video_id、is_replay_seed、comments（每筆 text/name/color/reply/reply_color/time，已依 time 播放偏移升序排列，time 為距影片開始播放的秒數偏移，供 host 自行同步時間軸）。 */
  CHAT_HISTORY_LOADED: "CHAT_HISTORY_LOADED",
  /** 熱狀態感知的 power profile tier 改變時 SDK 派發的通知型事件（iOS：ProcessInfo.thermalState 映射 full/reduced/conservative/survival，僅 tier 實際改變才發、去重；升溫即時、降溫需 hysteresis dwell）。param profile 為新 tier 的 wire 名稱（full/reduced/conservative/survival）。供 reference-ui 節流動畫等自適應；SDK 內部畫質 cap／輪詢 backoff 由內部 push sink 驅動、不依賴此公開事件。iOS-only emit（Android/RN/Flutter 常數已生成但尚無 emit 邏輯＝parity gap follow-up）。opt-out 關閉時不發。 */
  POWER_PROFILE_CHANGED: "POWER_PROFILE_CHANGED",
  /** SDK 從 POST /sdk/video/goods 回應 event[] 取得一個尚未通知過的進行中直播活動（直播抽獎）時派發的通知型事件（背景派發、不可攔截、無 callback），供 host/template 自繪活動倒數、獎品預告或『加入活動』入口文案。params 含進行中活動結構化欄位 id/title/keyword?/duration/surplus/award（每筆 award 為 type/name/code，複用 winner award 結構）；keyword 為加入活動口令（可 null/空＝無可參加 keyword）。fire-once per event.id（同一 event.id 不重複派發，去重集合隨影片切換清空）；surplus 為派發當下快照，host 以 duration + 收到事件的牆上時間本地推算即時倒數。stayTime（turnkey 內部停留門檻）不入 params。RN/Flutter 經既有統一 listener bridge 自動透傳，無 emit 程式碼。 */
  ACTIVE_EVENT_STARTED: "ACTIVE_EVENT_STARTED",
} as const;

export type LBEventName = typeof LBEvents[keyof typeof LBEvents];

export const LB_EVENT_NAMES: readonly LBEventName[] = ["VIDEO_OPEN", "VIDEO_SWITCH", "VIDEO_LIKE", "VIDEO_COMMENT", "VIDEO_SHARE", "VIDEO_HEARTBEAT", "INFO_PRODUCT_VIEW", "COUPON_CLAIM", "AUTH_STATE_CHANGED", "LANGUAGE_CHANGED", "CHECKOUT_COMPLETED", "AWAIT_GOODS_CHANGED", "NOTICE_GOODS_CHANGED", "CART_ADD_REQUEST", "AUTH_REQUIRED", "PRODUCT_CLICK", "VIDEO_SHARE_REQUEST", "INFO_CUSTOMER_SERVICE", "VIDEO_STATE_CHANGE", "POLL_RECEIVED", "VIDEO_ERROR", "CHAT_TOGGLE", "PRODUCT_PANEL_TOGGLE", "PRODUCT_CARD_DISMISS", "SUBTITLE_TOGGLE", "SERVICE_LINK_REQUEST", "GUEST_NAME_EDIT_REQUEST", "DISMISS_REQUEST", "SUBSCRIBE_CHANGED", "EVENT_JOIN_INTENT", "PIP_STATE_CHANGE", "CARD_VISIBILITY_CHANGED", "LOAD_MORE", "WIDGET_CLOSE", "LIKE_PERFORMED", "CAPABILITY_WARNING", "MINIMIZE_STATE_CHANGE", "SDK_DEPRECATION_NOTICE", "SDK_CONFIG_LOAD_FAILED", "SDK_CONFIG_REFRESHED", "AWARD_CLAIM_INTENT", "AWARD_CLAIM_RESULT", "WIN_RECEIVED", "VIEW_CART", "CHAT_HISTORY_LOADED", "POWER_PROFILE_CHANGED", "ACTIVE_EVENT_STARTED"];
