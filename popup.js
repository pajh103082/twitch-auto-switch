function t(key, subs) {
  return globalThis.TasI18n ? TasI18n.t(key, subs) : chrome.i18n.getMessage(key, subs) || key;
}

function applyI18n() {
  // 部分瀏覽器（例如某些版本的 Edge）沒有實作 getUILocale，這只是拿來設定 <html lang>
  // 屬性用的裝飾性資訊，抓不到就跳過，不能讓它擋住下面真正重要的翻譯套用流程。
  try {
    document.documentElement.lang = TasI18n.currentLocale();
  } catch (e) {
    // 忽略，不影響其他功能
  }
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.getAttribute("data-i18n-title"));
  });
}

const STATUS_LABEL_KEYS = {
  idle: "statusIdle",
  "target-live": "statusTargetLive",
  "fallback-live": "statusFallbackLive",
  checking: "statusChecking",
  error: "statusError",
  disabled: "statusDisabled",
};

const CLAIM_TYPE_LABEL_KEYS = {
  "channel-points": "claimTypeChannelPoints",
  drop: "claimTypeDrop",
  "drop-inventory": "claimTypeDropInventory",
};

function getSettings() {
  return new Promise((resolve) => chrome.storage.local.get("settings", (d) => resolve(d.settings || {})));
}

function getState() {
  return new Promise((resolve) => chrome.storage.local.get("state", (d) => resolve(d.state || {})));
}

async function renderState() {
  const state = await getState();
  document.getElementById("statusText").textContent = STATUS_LABEL_KEYS[state.status]
    ? t(STATUS_LABEL_KEYS[state.status])
    : state.status || "-";
  document.getElementById("currentChannel").textContent = state.currentChannel || "-";
  document.getElementById("lastCheck").textContent = state.lastCheckAt
    ? new Date(state.lastCheckAt).toLocaleTimeString()
    : "-";

  const errorRow = document.getElementById("errorRow");
  if (state.lastError) {
    errorRow.style.display = "flex";
    document.getElementById("lastError").textContent = state.lastError;
  } else {
    errorRow.style.display = "none";
  }

  const logList = document.getElementById("logList");
  logList.innerHTML = "";
  (state.log || []).forEach((entry) => {
    const li = document.createElement("li");
    li.textContent = entry;
    logList.appendChild(li);
  });

  document.getElementById("totalChannelPoints").textContent = (state.totalChannelPoints || 0).toLocaleString();

  const claimHistoryList = document.getElementById("claimHistoryList");
  claimHistoryList.innerHTML = "";
  (state.claimHistory || []).slice(0, 30).forEach((entry) => {
    const li = document.createElement("li");
    const time = entry.ts ? new Date(entry.ts).toLocaleTimeString() : "-";
    const typeLabel = CLAIM_TYPE_LABEL_KEYS[entry.type] ? t(CLAIM_TYPE_LABEL_KEYS[entry.type]) : entry.type;
    const amountText = typeof entry.amount === "number" ? t("amountSuffix", [String(entry.amount)]) : "";
    const channelText = entry.channel ? `［${entry.channel}］` : "";
    li.textContent = `${time} ${channelText}[${typeLabel}] ${entry.label || ""}${amountText}`.trim();
    claimHistoryList.appendChild(li);
  });
}

function applyFontSize(level) {
  document.body.setAttribute("data-font-size", level || "3");
}

function renderToggleButton(settings) {
  const enabled = settings.enabled !== false;
  const btn = document.getElementById("toggleEnabledBtn");
  btn.textContent = enabled ? t("toggleOnText") : t("toggleOffText");
  btn.classList.toggle("state-on", enabled);
  btn.classList.toggle("state-off", !enabled);
}

async function renderSettings() {
  const settings = await getSettings();
  renderToggleButton(settings);
  applyFontSize(settings.fontSizeLevel);
  document.getElementById("fontSizeLevel").value = settings.fontSizeLevel || "3";
  document.getElementById("targetChannel").value = settings.targetChannel || "lestakorabli";
  document.getElementById("categorySlug").value = settings.categorySlug || "mir-korabley";
  document.getElementById("dropsTagTexts").value = (
    settings.dropsTagTexts || ["Drops Enabled", "DropsEnabled", "掉寶", "启用掉宝", "掉落", "允許掉落", "支援掉落", "Включены", "DropsВключены"]
  ).join(",");
  document.getElementById("intervalSeconds").value = settings.intervalSeconds || 60;
  document.getElementById("dropsRecheckIntervalMinutes").value = settings.dropsRecheckIntervalMinutes || 10;
  document.getElementById("focusTab").checked = settings.focusTab === true;
  document.getElementById("adoptExistingTab").checked = settings.adoptExistingTab !== false;
  document.getElementById("idleAction").value = settings.idleAction || "none";
  document.getElementById("autoClaimDrops").checked = settings.autoClaimDrops !== false;
  document.getElementById("claimButtonTexts").value = (
    settings.claimButtonTexts || ["Claim", "Claim Drop Rewards", "領取", "领取", "获取", "立即領取", "立即领取", "马上领取", "Получить", "Забрать"]
  ).join(",");
  document.getElementById("inventoryCheckIntervalMinutes").value = settings.inventoryCheckIntervalMinutes || 5;
  document.getElementById("claimChannelPointsBonus").checked = settings.claimChannelPointsBonus !== false;
  document.getElementById("notificationsEnabled").checked = settings.notificationsEnabled !== false;
  document.getElementById("autoReloadOnError").checked = settings.autoReloadOnError !== false;
  document.getElementById("playerStallSeconds").value = settings.playerStallSeconds || 45;
  document.getElementById("reloadButtonTexts").value = (
    settings.reloadButtonTexts || [
      "Reload Player",
      "Try Again",
      "重新載入",
      "重試",
      "刷新",
      "重新整理",
      "Обновить",
      "Повторить попытку",
    ]
  ).join(",");
}

async function saveSettings() {
  const settings = await getSettings();
  const next = {
    ...settings,
    targetChannel: document.getElementById("targetChannel").value.trim() || "lestakorabli",
    categorySlug: document.getElementById("categorySlug").value.trim() || "mir-korabley",
    dropsTagTexts: document
      .getElementById("dropsTagTexts")
      .value.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    intervalSeconds: Math.max(parseInt(document.getElementById("intervalSeconds").value, 10) || 60, 30),
    dropsRecheckIntervalMinutes: Math.max(
      parseInt(document.getElementById("dropsRecheckIntervalMinutes").value, 10) || 10,
      1
    ),
    focusTab: document.getElementById("focusTab").checked,
    adoptExistingTab: document.getElementById("adoptExistingTab").checked,
    idleAction: document.getElementById("idleAction").value,
    autoClaimDrops: document.getElementById("autoClaimDrops").checked,
    claimButtonTexts: document
      .getElementById("claimButtonTexts")
      .value.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    inventoryCheckIntervalMinutes: Math.max(
      parseInt(document.getElementById("inventoryCheckIntervalMinutes").value, 10) || 5,
      1
    ),
    claimChannelPointsBonus: document.getElementById("claimChannelPointsBonus").checked,
    notificationsEnabled: document.getElementById("notificationsEnabled").checked,
    autoReloadOnError: document.getElementById("autoReloadOnError").checked,
    playerStallSeconds: Math.max(parseInt(document.getElementById("playerStallSeconds").value, 10) || 45, 10),
    reloadButtonTexts: document
      .getElementById("reloadButtonTexts")
      .value.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
  await new Promise((resolve) => chrome.storage.local.set({ settings: next }, resolve));
  chrome.runtime.sendMessage({ type: "settingsUpdated" });
}

document.getElementById("fontSizeLevel").addEventListener("change", async (event) => {
  const level = event.target.value;
  applyFontSize(level); // 立刻套用，不用等按儲存——看不清楚時應該馬上看得到效果
  // 只更新這一個欄位，避免連帶把使用者可能還在編輯、尚未按儲存的其他欄位也寫進儲存空間
  const settings = await getSettings();
  const next = { ...settings, fontSizeLevel: level };
  await new Promise((resolve) => chrome.storage.local.set({ settings: next }, resolve));
  chrome.runtime.sendMessage({ type: "settingsUpdated" });
});

// 桌面通知開關：勾選／取消當下就立刻生效並存檔，不用再按「儲存通知設定」。
// 這樣「關掉通知就不要再吵我」是即時的，避免使用者關了卻忘記按儲存、以為沒作用。
document.getElementById("notificationsEnabled").addEventListener("change", async (event) => {
  const settings = await getSettings();
  const next = { ...settings, notificationsEnabled: event.target.checked };
  await new Promise((resolve) => chrome.storage.local.set({ settings: next }, resolve));
  chrome.runtime.sendMessage({ type: "settingsUpdated" });
});

// 介面語言：選了就立刻切換並存檔（跟文字大小一樣不用按儲存）。
// 選定的語言字典存在 storage，background 的通知與 content scripts 的訊息也會跟著換。
document.getElementById("uiLanguage").addEventListener("change", async (event) => {
  const select = event.target;
  select.disabled = true;
  try {
    await TasI18n.setLanguage(select.value);
  } catch (e) {
    // 讀不到語言檔時退回「自動」，避免介面卡在一半翻譯的狀態
    await TasI18n.setLanguage("auto");
    select.value = "auto";
  }
  select.disabled = false;
  await refreshAllText();
});

async function refreshAllText() {
  applyI18n();
  await renderSettings();
  await renderState();
}

document.getElementById("checkNowBtn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "checkNow" }, () => renderState());
});

document.getElementById("toggleEnabledBtn").addEventListener("click", async () => {
  const settings = await getSettings();
  const nextEnabled = !(settings.enabled !== false);
  chrome.runtime.sendMessage({ type: "setEnabled", enabled: nextEnabled }, async () => {
    await renderSettings();
    await renderState();
  });
});

async function flashSaved(btn) {
  const original = btn.textContent;
  btn.textContent = t("savedText");
  setTimeout(() => (btn.textContent = original), 1200);
}

document.getElementById("saveBtn").addEventListener("click", async () => {
  await saveSettings();
  flashSaved(document.getElementById("saveBtn"));
});

document.getElementById("saveClaimBtn").addEventListener("click", async () => {
  await saveSettings();
  flashSaved(document.getElementById("saveClaimBtn"));
});

document.getElementById("checkInventoryNowBtn").addEventListener("click", () => {
  const btn = document.getElementById("checkInventoryNowBtn");
  const original = btn.textContent;
  btn.textContent = t("checkingBtnText");
  chrome.runtime.sendMessage({ type: "checkInventoryNow" }, () => {
    btn.textContent = original;
    renderState();
  });
});

document.getElementById("clearHistoryBtn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "clearClaimHistory" }, () => renderState());
});

document.getElementById("saveWatchdogBtn").addEventListener("click", async () => {
  await saveSettings();
  flashSaved(document.getElementById("saveWatchdogBtn"));
});

TasI18n.ready.then(async () => {
  document.getElementById("uiLanguage").value = TasI18n.getLanguage();
  await refreshAllText();
});
setInterval(renderState, 3000);
