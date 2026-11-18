// Twitch 自動轉台工具 - background service worker
//
// 流程：
//   1. 用 Twitch 公開網站前端也在用的 GQL 端點（Client-Id 是公開值，非帳號機密）查詢
//      指定實況主是否開台。
//   2. 若沒開台，導覽「管理分頁」到指定分類的 directory 頁面，交給
//      content-directory.js 掃描畫面上帶有「掉寶」標籤的實況卡片，回報頻道清單。
//   3. 從清單中挑一個頻道切過去；若目前頁面本來就是清單中的頻道，則不重複切台。
//   4. 都沒有符合條件的實況主時，維持現狀（閒置）。
//   5. 掉寶／頻道點數的自動領取分兩條路徑：
//      - 主要：content-gql-claim.js 直接呼叫 Twitch 私有 GQL mutation 領取（搭配
//        page-integrity-bridge.js 取得反機器人驗證 token），在管理分頁上執行，不用另開分頁。
//      - 備援：上面那條路徑失敗時，改用 content-claim.js（即時攔截畫面上的領取按鈕）
//        跟 content-inventory-claim.js（開一個背景分頁掃描 drops/inventory 頁面按鈕）。

importScripts("i18n.js"); // 使用者可在 popup 手動切換介面語言（見 i18n.js）

function t(key, subs) {
  return globalThis.TasI18n ? TasI18n.t(key, subs) : chrome.i18n.getMessage(key, subs) || key;
}

const GQL_ENDPOINT = "https://gql.twitch.tv/gql";
// Twitch 網頁版前端固定使用的公開 Client-Id（非使用者帳號機密資訊，僅用於呼叫公開 GQL 介面）。
const GQL_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";
const ALARM_NAME = "twitch-auto-switch-check";
const CLAIM_ALARM_NAME = "twitch-auto-switch-claim-check";
const DIRECTORY_SCAN_TIMEOUT_MS = 12000;
const INVENTORY_CLAIM_TIMEOUT_MS = 20000;

const DEFAULT_SETTINGS = {
  enabled: false, // 預設先關閉，需要使用者自己按開關才會開始自動切台/領取，避免一裝好就自動執行
  targetChannel: "lestakorabli",
  categorySlug: "mir-korabley",
  dropsTagTexts: ["Drops Enabled", "DropsEnabled", "掉寶", "启用掉宝", "掉落", "允許掉落", "支援掉落", "Включены", "DropsВключены"],
  intervalSeconds: 60,
  dropsRecheckIntervalMinutes: 10, // 備援頻道還在直播時，隔多久重新確認一次「掉寶還有沒有開」
  focusTab: false, // 預設不聚焦分頁：背景掛台工具，自動切台時不搶焦點、不打斷使用者
  idleAction: "none", // "none" | "home"
  adoptExistingTab: true,
  managedTabId: null,
  autoClaimDrops: true,
  claimButtonTexts: ["Claim", "Claim Drop Rewards", "領取", "领取", "获取", "立即領取", "立即领取", "马上领取", "Получить", "Забрать"],
  inventoryCheckIntervalMinutes: 5,
  claimChannelPointsBonus: true,
  notificationsEnabled: true,
  fontSizeLevel: "3", // popup 文字大小，"1"（最小）~"5"（最大），"3" 是預設中等大小
  autoReloadOnError: true,
  playerStallSeconds: 45,
  reloadButtonTexts: [
    "Reload Player",
    "Try Again",
    "重新載入",
    "重試",
    "刷新",
    "重新整理",
    "Обновить",
    "Повторить попытку",
  ],
};

const DEFAULT_STATE = {
  status: "disabled", // idle | target-live | fallback-live | checking | error | disabled
  currentChannel: null,
  lastCheckAt: null,
  lastError: null,
  log: [],
  claimHistory: [], // {ts, type: "drop" | "drop-inventory" | "channel-points", label, amount, channel}
  totalChannelPoints: 0,
  fallbackVerifiedAt: null, // 上次確認目前備援頻道仍符合掉寶條件的時間
  failedChannels: {}, // 播放器多次重試仍失敗、暫時跳過的頻道：{ login: 到期時間戳 }
};

const CLAIM_HISTORY_LIMIT = 200;

// 播放器在某個頻道重試多次仍失敗時，這個頻道要暫時跳過多久才再給它機會。
const FAILED_CHANNEL_COOLDOWN_MS = 30 * 60 * 1000;

// 取出目前仍在「暫時跳過」期間內的頻道（已過期的自動忽略）。
function getBlockedChannels(state) {
  const now = Date.now();
  const map = (state && state.failedChannels) || {};
  return new Set(Object.keys(map).filter((login) => map[login] > now));
}

const BADGE_COLORS = {
  "target-live": "#00b26e",
  "fallback-live": "#9147ff",
  idle: "#6b6b74",
  checking: "#f0a020",
  error: "#d0021b",
  disabled: "#3a3a3d",
};
const BADGE_TEXT = {
  "target-live": "●",
  "fallback-live": "●",
  checking: "…",
  error: "!",
  disabled: "⏸",
  idle: "",
};

function updateBadge(status) {
  try {
    chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS[status] || "#6b6b74" });
    chrome.action.setBadgeText({ text: BADGE_TEXT[status] !== undefined ? BADGE_TEXT[status] : "" });
  } catch (e) {
    // 部分環境（例如測試）可能沒有 chrome.action，忽略即可
  }
}

let notificationIdCounter = 0;

// 桌面通知，受「啟用桌面通知」設定開關控制，避免使用者覺得太吵可以直接關掉
async function notify(title, message) {
  const settings = await getSettings();
  if (!settings.notificationsEnabled) return;
  try {
    notificationIdCounter += 1;
    chrome.notifications.create(`twitch-auto-switch-${Date.now()}-${notificationIdCounter}`, {
      type: "basic",
      iconUrl: "icon/icon128.png",
      title,
      message,
    });
  } catch (e) {
    // 部分環境可能沒有 chrome.notifications 或通知權限被系統關閉，忽略即可
  }
}

let isChecking = false;
const pendingDirectoryScans = new Map(); // requestId -> {resolve, timeoutHandle}

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get("settings", (data) => {
      resolve({ ...DEFAULT_SETTINGS, ...(data.settings || {}) });
    });
  });
}

function saveSettings(partial) {
  return getSettings().then((current) => {
    const next = { ...current, ...partial };
    return new Promise((resolve) => {
      chrome.storage.local.set({ settings: next }, () => resolve(next));
    });
  });
}

function getState() {
  return new Promise((resolve) => {
    chrome.storage.local.get("state", (data) => {
      resolve({ ...DEFAULT_STATE, ...(data.state || {}) });
    });
  });
}

async function updateState(partial, logMessage) {
  const current = await getState();
  const next = { ...current, ...partial, lastCheckAt: Date.now() };
  if (logMessage) {
    const entry = `${new Date().toLocaleTimeString()} - ${logMessage}`;
    next.log = [entry, ...current.log].slice(0, 30);
  }
  await new Promise((resolve) => chrome.storage.local.set({ state: next }, resolve));
  if (next.status) {
    updateBadge(next.status);
  }
  return next;
}

async function addClaimHistoryEntries(entries) {
  if (!entries || entries.length === 0) return;
  const current = await getState();
  const totalDelta = entries.reduce((sum, e) => sum + (e.type === "channel-points" && typeof e.amount === "number" ? e.amount : 0), 0);
  const claimHistory = [...entries, ...(current.claimHistory || [])].slice(0, CLAIM_HISTORY_LIMIT);
  await updateState({
    claimHistory,
    totalChannelPoints: (current.totalChannelPoints || 0) + totalDelta,
  });
}

async function ensureAlarm() {
  const settings = await getSettings();
  if (!settings.enabled) {
    chrome.alarms.clear(ALARM_NAME);
    return;
  }
  const periodMinutes = Math.max(settings.intervalSeconds / 60, 0.5);
  chrome.alarms.clear(ALARM_NAME, () => {
    chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: periodMinutes,
      periodInMinutes: periodMinutes,
    });
  });
}

async function ensureClaimAlarm() {
  const settings = await getSettings();
  if (!settings.enabled || !settings.autoClaimDrops) {
    chrome.alarms.clear(CLAIM_ALARM_NAME);
    return;
  }
  const periodMinutes = Math.max(settings.inventoryCheckIntervalMinutes || 5, 1);
  chrome.alarms.clear(CLAIM_ALARM_NAME, () => {
    chrome.alarms.create(CLAIM_ALARM_NAME, {
      delayInMinutes: periodMinutes,
      periodInMinutes: periodMinutes,
    });
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  const data = await new Promise((resolve) => chrome.storage.local.get("settings", resolve));
  if (!data.settings) {
    await saveSettings(DEFAULT_SETTINGS);
  }
  await updateState(DEFAULT_STATE);
  await ensureAlarm();
  await ensureClaimAlarm();
  // 擴充功能更新後重新載入使用者選的語言字典，確保新增的字串也有翻譯
  TasI18n.refreshStoredMessages().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  ensureClaimAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    runCheck();
  }
  if (alarm.name === CLAIM_ALARM_NAME) {
    runInventoryClaimCheck();
  }
});

// ---- GQL：查詢頻道是否直播中 ----
// 找不到該頻道（帳號名稱打錯或不存在）時，會丟出 code === "CHANNEL_NOT_FOUND" 的錯誤，
// 呼叫端可依情境決定要不要把它當成明確錯誤呈現給使用者。
async function isChannelLive(login) {
  const resp = await fetch(GQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Client-Id": GQL_CLIENT_ID,
    },
    body: JSON.stringify({ query: `query { user(login: "${login}") { stream { id } } } ` }),
  });
  if (!resp.ok) {
    throw new Error(t("errGqlHttpFailed", [String(resp.status)]));
  }
  const json = await resp.json();
  const user = json && json.data && json.data.user;
  if (!user) {
    const err = new Error(t("errChannelNotFound", [login]));
    err.code = "CHANNEL_NOT_FOUND";
    throw err;
  }
  return !!user.stream;
}

// ---- 管理分頁：取得、接管既有分頁、或建立 ----
async function findExistingTwitchTab() {
  const tabs = await chrome.tabs.query({ url: "https://www.twitch.tv/*" });
  if (!tabs || tabs.length === 0) return null;
  // 排除 /directory /drops 這類工具性頁面（包含掉寶自動領取用的背景分頁），
  // 避免被誤接管成觀看用的管理分頁
  const candidates = tabs.filter((t) => {
    try {
      const path = new URL(t.url).pathname.toLowerCase();
      return !path.startsWith("/directory/") && !path.startsWith("/drops/");
    } catch (e) {
      return false;
    }
  });
  if (candidates.length === 0) return null;
  // 優先接管：目前作用中的分頁 > 正在看某頻道的分頁 > 隨便一個 twitch 分頁
  const active = candidates.find((t) => t.active);
  if (active) return active;
  const channelTab = candidates.find((t) => currentChannelFromUrl(t.url) !== null);
  if (channelTab) return channelTab;
  return candidates[0];
}

// 避免 Chrome 在記憶體不足時把管理分頁自動「丟棄」（discard）導致直播中斷、觀看時數歸零
async function markTabNonDiscardable(tabId) {
  try {
    await chrome.tabs.update(tabId, { autoDiscardable: false });
  } catch (e) {
    // 分頁可能已不存在，忽略即可
  }
}

async function getManagedTab() {
  const settings = await getSettings();
  if (settings.managedTabId) {
    try {
      const tab = await chrome.tabs.get(settings.managedTabId);
      if (tab && !tab.discarded) {
        await markTabNonDiscardable(tab.id);
        return tab;
      }
    } catch (e) {
      // 分頁已不存在，繼續往下尋找或建立
    }
  }
  if (settings.adoptExistingTab) {
    const existing = await findExistingTwitchTab();
    if (existing) {
      await saveSettings({ managedTabId: existing.id });
      await markTabNonDiscardable(existing.id);
      return existing;
    }
  }
  const tab = await chrome.tabs.create({ url: "https://www.twitch.tv/", active: !!settings.focusTab });
  await saveSettings({ managedTabId: tab.id });
  await markTabNonDiscardable(tab.id);
  return tab;
}

function currentChannelFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== "www.twitch.tv") return null;
    const path = u.pathname.replace(/^\//, "").replace(/\/$/, "");
    if (!path || path.startsWith("directory") || path.startsWith("videos") || path.startsWith("settings")) {
      return null;
    }
    if (path.includes("/")) return null;
    return path;
  } catch (e) {
    return null;
  }
}

async function navigateManagedTab(url) {
  const settings = await getSettings();
  const tab = await getManagedTab();
  // 只在同一個視窗內把分頁設為作用中（受 focusTab 控制）；刻意「不」呼叫
  // chrome.windows.update({ focused: true }) 把整個視窗拉到前景——那會在視窗處於背景時
  // 讓 Windows 工具列的瀏覽器按鈕閃橘色「請求注意」、把自動隱藏的工具列喚醒，非常干擾。
  // 這個工具是背景掛台用的，自動切台時不應該搶走使用者正在做的事情的焦點。
  await chrome.tabs.update(tab.id, { url, active: !!settings.focusTab });
  return tab;
}

function waitForTabComplete(tabId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let done = false;
    const timeoutHandle = setTimeout(() => {
      if (!done) {
        done = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(false);
      }
    }, timeoutMs);
    function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === "complete") {
        if (!done) {
          done = true;
          clearTimeout(timeoutHandle);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve(true);
        }
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// ---- 掃描分類 directory 頁面找出有掉寶標籤的頻道 ----
// 分類 slug 打錯／不存在時，Twitch 會把頁面導到別的網址或顯示找不到頁面，
// 這裡會偵測出來並丟出 code === "CATEGORY_NOT_FOUND" 的錯誤。
async function scanCategoryForDropsChannels(settings) {
  const tab = await getManagedTab();
  const directoryUrl = `https://www.twitch.tv/directory/category/${encodeURIComponent(settings.categorySlug)}`;
  await chrome.tabs.update(tab.id, { url: directoryUrl, active: !!settings.focusTab });
  await waitForTabComplete(tab.id);

  let finalUrl = "";
  try {
    const finalTab = await chrome.tabs.get(tab.id);
    finalUrl = finalTab && finalTab.url ? finalTab.url : "";
  } catch (e) {
    finalUrl = "";
  }
  const finalPath = finalUrl ? new URL(finalUrl).pathname : "";
  if (!finalPath.toLowerCase().startsWith("/directory/category/")) {
    const err = new Error(t("errCategoryNotFound", [settings.categorySlug]));
    err.code = "CATEGORY_NOT_FOUND";
    throw err;
  }

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const resultPromise = new Promise((resolve) => {
    const timeoutHandle = setTimeout(() => {
      pendingDirectoryScans.delete(requestId);
      resolve({ channels: [], notFound: false });
    }, DIRECTORY_SCAN_TIMEOUT_MS);
    pendingDirectoryScans.set(requestId, { resolve, timeoutHandle });
  });

  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: "scanDirectory",
      requestId,
      dropsTagTexts: settings.dropsTagTexts,
    });
  } catch (e) {
    // content script 尚未就緒，等待逾時後回傳空結果
  }

  const result = await resultPromise;
  if (result.notFound) {
    const err = new Error(t("errCategoryNotFound", [settings.categorySlug]));
    err.code = "CATEGORY_NOT_FOUND";
    throw err;
  }
  return result.channels;
}

// ---- 定期補漏：領取掉寶獎勵 ----
// 優先走「私有 GQL API」路徑（content-gql-claim.js，直接在管理分頁上執行，不用另開分頁）；
// 如果那條路徑本身失敗（例如還沒登入、拿不到反機器人驗證 token），才退回原本開一個不搶
// 焦點的背景分頁去 drops/inventory 掃描按鈕文字的做法，當作保險。
const API_CLAIM_TIMEOUT_MS = 30000;

function sendMessageWithTimeout(tabId, message, timeoutMs) {
  return Promise.race([
    chrome.tabs.sendMessage(tabId, message).catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

async function runInventoryClaimCheckViaApi(settings) {
  const tab = await getManagedTab();
  const resp = await sendMessageWithTimeout(tab.id, { type: "claimDropsViaApi" }, API_CLAIM_TIMEOUT_MS);

  if (!resp || !resp.ok) {
    return { handled: false, reason: (resp && resp.error) || t("errNoResponse") };
  }

  const claimed = resp.claimed || [];
  if (claimed.length > 0) {
    const now = Date.now();
    const entries = claimed
      .map((label) => ({ ts: now, type: "drop-inventory", label: label || t("defaultDropRewardName"), amount: null, channel: null }))
      .reverse();
    await addClaimHistoryEntries(entries);
    // 這幾筆已經寫進「獎勵領取紀錄」了，活動紀錄不用再重複記一次同樣的內容，
    // 只保留桌面通知（可在設定關閉）。
    await notify(t("notifyClaimTitle"), t("msgApiInventoryClaimed", [String(claimed.length)]));
  }

  // 掉寶查完了，順便在同一個管理分頁上主動查一次「目前這個頻道」的頻道點數領取狀態，
  // 不用等 Twitch 自己的頁面剛好去查（那條路徑也還在跑，當作更即時的旁路）。
  if (settings.claimChannelPointsBonus) {
    try {
      const pointsResp = await sendMessageWithTimeout(tab.id, { type: "checkChannelPointsViaApi" }, API_CLAIM_TIMEOUT_MS);
      if (pointsResp && !pointsResp.ok) {
        await updateState({}, t("msgChannelPointsApiQueryFailed", [String(pointsResp.error)]));
      }
      // 成功領到的通知/紀錄已經在 content-gql-claim.js 觸發的 dropClaimed 訊息裡處理過了
    } catch (e) {
      // 頻道點數這條路失敗不影響掉寶的結果，忽略即可
    }
  }

  return { handled: true };
}

async function runInventoryClaimCheckViaDom(settings) {
  let tab = null;
  try {
    tab = await chrome.tabs.create({ url: "https://www.twitch.tv/drops/inventory", active: false });
    await waitForTabComplete(tab.id, 20000);

    const resp = await sendMessageWithTimeout(
      tab.id,
      { type: "claimInventoryDrops", claimButtonTexts: settings.claimButtonTexts },
      INVENTORY_CLAIM_TIMEOUT_MS
    );
    const claimed = (resp && resp.claimed) || [];
    if (claimed.length > 0) {
      const now = Date.now();
      const entries = claimed
        .map((label) => ({ ts: now, type: "drop-inventory", label: label || t("defaultDropRewardName"), amount: null, channel: null }))
        .reverse();
      await addClaimHistoryEntries(entries);
      // 同上，已經寫進「獎勵領取紀錄」了，活動紀錄不重複記，只保留桌面通知。
      await notify(t("notifyClaimTitle"), t("msgDomInventoryClaimed", [String(claimed.length)]));
    }
  } catch (e) {
    await updateState({}, t("msgInventoryCheckFailed", [String((e && e.message) || e)]));
  } finally {
    if (tab) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch (e) {
        // 分頁可能已被使用者關掉，忽略即可
      }
    }
  }
}

async function runInventoryClaimCheck() {
  const settings = await getSettings();
  if (!settings.enabled || !settings.autoClaimDrops) return;

  let apiResult = null;
  try {
    apiResult = await runInventoryClaimCheckViaApi(settings);
  } catch (e) {
    apiResult = { handled: false, reason: String((e && e.message) || e) };
  }

  if (apiResult && apiResult.handled) return;

  await updateState({}, t("msgApiClaimFallback", [String((apiResult && apiResult.reason) || "")]));
  await runInventoryClaimCheckViaDom(settings);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "dropClaimed") {
    (async () => {
      const isChannelPoints = msg.source === "channel-points";
      const label = isChannelPoints ? t("defaultChannelPointsRewardName") : t("defaultDropRewardName");
      const channel = sender && sender.tab && sender.tab.url ? currentChannelFromUrl(sender.tab.url) : null;
      const amount = isChannelPoints && typeof msg.amount === "number" ? msg.amount : null;
      await addClaimHistoryEntries([
        {
          ts: Date.now(),
          type: isChannelPoints ? "channel-points" : "drop",
          label: msg.text || "",
          amount,
          channel,
        },
      ]);
      const amountSuffix = amount ? t("amountSuffix", [String(amount)]) : "";
      // 這筆已經寫進「獎勵領取紀錄」了，活動紀錄不重複記，只保留桌面通知。
      await notify(t("notifyClaimTitle"), t("msgRealtimeClaim", [label, msg.text || t("msgUnknownRewardName"), amountSuffix]));
    })();
    return;
  }
  if (msg && msg.type === "playerGaveUp") {
    // 播放器在這個頻道重試多次仍然失敗：暫時把它列入跳過名單，馬上重新檢查、改切到別的實況主。
    (async () => {
      const login = (msg.channel || "").toLowerCase();
      if (!login) return;
      const settings = await getSettings();
      if (!settings.enabled) return; // 工具停用中就不要自動換台
      const state = await getState();
      const failedChannels = { ...(state.failedChannels || {}) };
      // 順便清掉已經過期的項目，避免名單一直變長
      const now = Date.now();
      Object.keys(failedChannels).forEach((k) => {
        if (failedChannels[k] <= now) delete failedChannels[k];
      });
      failedChannels[login] = now + FAILED_CHANNEL_COOLDOWN_MS;
      await updateState(
        { failedChannels, fallbackVerifiedAt: null },
        t("msgChannelGaveUp", [login, String(FAILED_CHANNEL_COOLDOWN_MS / 60000)])
      );
      runCheck();
    })();
    return;
  }
  if (msg && msg.type === "playerAutoReload") {
    (async () => {
      // 播放器的強制續播／自動重整屬於「例行自我修復」動作，只寫進活動紀錄即可，
      // 刻意不發 Windows 系統通知——這種事件很頻繁，每次都跳通知會一直打擾使用者
      // （尤其自動重整時桌面右下角一直彈「瀏覽器被刷新」）。想回顧仍可看 popup 的活動紀錄。
      await updateState({}, t("msgPlayerMonitor", [msg.reason || ""]));
    })();
    return;
  }
  if (msg && msg.type === "clearClaimHistory") {
    updateState({ claimHistory: [], totalChannelPoints: 0 }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg && msg.type === "checkInventoryNow") {
    runInventoryClaimCheck().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg && msg.type === "directoryScanResult") {
    const pending = pendingDirectoryScans.get(msg.requestId);
    if (pending) {
      clearTimeout(pending.timeoutHandle);
      pendingDirectoryScans.delete(msg.requestId);
      pending.resolve({ channels: msg.channels || [], notFound: !!msg.notFound });
    }
    return;
  }
  if (msg && msg.type === "checkNow") {
    runCheck().then(() => sendResponse({ ok: true }));
    return true; // async response
  }
  if (msg && msg.type === "getState") {
    getState().then((state) => sendResponse(state));
    return true;
  }
  if (msg && msg.type === "settingsUpdated") {
    ensureAlarm();
    ensureClaimAlarm();
  }
  if (msg && msg.type === "setEnabled") {
    (async () => {
      await saveSettings({ enabled: !!msg.enabled });
      await ensureAlarm();
      await ensureClaimAlarm();
      if (!msg.enabled) {
        await updateState({ status: "disabled" }, t("msgManualStop"));
      } else {
        await updateState({ status: "checking" }, t("msgManualStart"));
        // 開啟開關就一次把所有排程都觸發一輪（切台檢查 + 掉寶/點數領取檢查），
        // 不用使用者自己再手動點「立即檢查」跟「立即檢查掉寶庫存」才會全部動起來。
        runCheck();
        runInventoryClaimCheck();
      }
      sendResponse({ ok: true });
    })();
    return true;
  }
});

// ---- 主檢查流程 ----
async function runCheck() {
  if (isChecking) return;
  isChecking = true;
  try {
    const settings = await getSettings();
    if (!settings.enabled) {
      await updateState({ status: "disabled" });
      return;
    }
    await updateState({ status: "checking" });

    let targetLive = false;
    try {
      targetLive = await isChannelLive(settings.targetChannel);
    } catch (e) {
      const message = e && e.code === "CHANNEL_NOT_FOUND" ? e.message : t("errQueryChannelFailed", [settings.targetChannel, String((e && e.message) || e)]);
      await updateState({ status: "error", lastError: message }, message);
      await notify(t("notifyErrorTitle"), message);
      return;
    }

    // 播放器重試多次仍失敗而被暫時跳過的頻道（包含目標實況主本人：他的直播一直播不起來時，
    // 先改看分類裡其他有掉寶的實況主，冷卻時間過了再回來）。
    const blocked = getBlockedChannels(await getState());
    const isBlocked = (login) => !!login && blocked.has(login.toLowerCase());

    if (targetLive && !isBlocked(settings.targetChannel)) {
      const tab = await getManagedTab();
      const nowChannel = currentChannelFromUrl(tab.url || "");
      if (nowChannel !== settings.targetChannel) {
        await navigateManagedTab(`https://www.twitch.tv/${settings.targetChannel}`);
        const message = t("msgTargetLiveSwitching", [settings.targetChannel]);
        await updateState({ status: "target-live", currentChannel: settings.targetChannel, lastError: null }, message);
        await notify(t("notifySwitchTitle"), message);
      } else {
        await updateState({ status: "target-live", currentChannel: settings.targetChannel, lastError: null });
      }
      return;
    }

    // 目標實況主未上線。如果目前分頁已經在看其他頻道，且該頻道還在直播，
    // 平常就完全不要動分頁（不重新整理、不切台），避免打斷觀看時數／掉寶累計；
    // 但每隔一段時間（「掉寶條件重新確認間隔」）還是要重新掃描一次分類頁，確認這個頻道
    // 是不是中途被關掉掉寶了——只看「還有沒有在直播」不夠，主播可能還在開台但已經沒開
    // 掉寶了，這種情況也要換到別的合格頻道，不能因為「還在直播」就一直卡著不動。
    const tab = await getManagedTab();
    const nowChannel = currentChannelFromUrl(tab.url || "");
    const currentState = await getState();
    let channels = null; // 如果重新確認時已經掃描過，這裡直接重複使用，不用再掃一次

    // 目前頻道若在跳過名單裡（播放器一直壞掉），就不要繼續留著，直接往下找別的頻道。
    if (nowChannel && nowChannel !== settings.targetChannel && !isBlocked(nowChannel)) {
      let stillLive = true;
      try {
        stillLive = await isChannelLive(nowChannel);
      } catch (e) {
        // 頻道不存在（可能已被刪除／改名）視為需要換台；其他查詢錯誤則保守處理，
        // 先不要打斷目前的直播，等下次檢查再說
        stillLive = e && e.code === "CHANNEL_NOT_FOUND" ? false : true;
      }

      if (stillLive) {
        // 「還沒到重新確認的時間」這個判斷，只有在分頁目前顯示的頻道跟我們上次記錄的
        // 一致時才能相信——如果不一致（例如 Twitch 的 Raid 機制把你強制跳轉到別的頻道、
        // 或是剛開啟這個工具時分頁本來就停在跟設定條件不相干的頻道/分類），代表這個頻道
        // 根本沒有被我們驗證過，舊的計時器不能沿用，要無視計時器立刻重新確認一次。
        const channelChangedUnexpectedly = currentState.currentChannel !== nowChannel;
        const recheckIntervalMs = Math.max(settings.dropsRecheckIntervalMinutes || 10, 1) * 60 * 1000;
        const dueForRecheck =
          channelChangedUnexpectedly ||
          !currentState.fallbackVerifiedAt ||
          Date.now() - currentState.fallbackVerifiedAt >= recheckIntervalMs;

        if (!dueForRecheck) {
          await updateState({ status: "fallback-live", currentChannel: nowChannel, lastError: null });
          return;
        }

        try {
          channels = await scanCategoryForDropsChannels(settings);
        } catch (e) {
          // 重新確認失敗（例如暫時的網路問題）就保守處理，先不打斷目前的直播，下次再試
          await updateState({ status: "fallback-live", currentChannel: nowChannel, lastError: null });
          return;
        }

        if (channels.includes(nowChannel)) {
          await updateState({
            status: "fallback-live",
            currentChannel: nowChannel,
            fallbackVerifiedAt: Date.now(),
            lastError: null,
          });
          return;
        }
        // 掉寶條件不再符合了（channels 已經是這次掃描的結果，下面會直接拿來挑新頻道）
      }
    }

    // 目前沒有可以繼續看的頻道（下播了、掉寶被關掉、或本來就沒在看），才需要掃描分類頁
    // 找新的掉寶頻道，這一步才會真正切換／重新整理分頁。
    if (channels === null) {
      try {
        channels = await scanCategoryForDropsChannels(settings);
      } catch (e) {
        const message = e && e.code === "CATEGORY_NOT_FOUND" ? e.message : t("errScanCategoryFailed", [String((e && e.message) || e)]);
        await updateState({ status: "error", lastError: message }, message);
        await notify(t("notifyErrorTitle"), message);
        return;
      }
    }

    // 挑新頻道時排除暫時跳過的頻道（還有目標實況主本人，他若被跳過也不要被當成備援頻道挑回來）。
    channels = channels.filter((c) => !isBlocked(c) && c !== settings.targetChannel);

    if (channels.length > 0) {
      const picked = channels[Math.floor(Math.random() * channels.length)];
      await navigateManagedTab(`https://www.twitch.tv/${picked}`);
      const message = t("msgFoundFallbackChannel", [String(channels.length), picked]);
      await updateState(
        { status: "fallback-live", currentChannel: picked, fallbackVerifiedAt: Date.now(), lastError: null },
        message
      );
      await notify(t("notifySwitchTitle"), message);
      return;
    }

    // 都沒有符合條件的實況主 -> 閒置
    if (settings.idleAction === "home" && (nowChannel !== null || !(tab.url || "").includes("twitch.tv"))) {
      await navigateManagedTab("https://www.twitch.tv/");
    }
    await updateState({ status: "idle", currentChannel: null, lastError: null }, t("msgIdle"));
  } finally {
    isChecking = false;
  }
}
