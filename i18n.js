// 共用的介面語言模組（popup、background service worker、content scripts 都會載入）。
//
// Chrome 內建的 chrome.i18n 只會跟著「瀏覽器語言」走，無法讓使用者自己切換。這個模組讓使用者
// 可以在 popup 選「自動 / 繁體中文 / English」：
//   - 選「自動」：完全交給 chrome.i18n（跟原本行為一樣）。
//   - 選特定語言：popup 會讀取 _locales/<lang>/messages.json，整份存進
//     chrome.storage.local 的 i18nMessages；所有環境都從 storage 讀這份字典來翻譯，並監聽
//     storage 變化即時切換（content scripts 不需要 web_accessible_resources 就能用）。
// 字典裡找不到的 key 一律退回 chrome.i18n.getMessage，再找不到才回傳 key 本身。
(function (root) {
  if (root.TasI18n) return; // 同一個環境重複載入時不要重複註冊監聽器

  const SUPPORTED = ["zh_TW", "en"];
  let dict = null;
  let language = "auto";
  const listeners = [];

  // 依照 chrome.i18n 的規則展開訊息：先把 $NAME$ 換成 placeholders 裡的 content（例如 "$1"），
  // 再把 $1~$9 換成傳入的參數、$$ 換成單一個 $。
  function format(entry, subs) {
    let msg = String(entry.message || "");
    const placeholders = entry.placeholders || {};
    msg = msg.replace(/\$([A-Za-z0-9_@]+)\$/g, (match, name) => {
      const p = placeholders[name.toLowerCase()] || placeholders[name];
      return p && typeof p.content === "string" ? p.content : match;
    });
    const args = subs == null ? [] : Array.isArray(subs) ? subs : [subs];
    return msg.replace(/\$(\$|[1-9])/g, (match, token) => {
      if (token === "$") return "$";
      const value = args[Number(token) - 1];
      return value === undefined ? "" : String(value);
    });
  }

  function t(key, subs) {
    if (dict && dict[key]) {
      try {
        return format(dict[key], subs);
      } catch (e) {
        // 字典格式異常時退回瀏覽器內建翻譯
      }
    }
    try {
      return chrome.i18n.getMessage(key, subs) || key;
    } catch (e) {
      return key;
    }
  }

  function apply(nextLanguage, nextDict) {
    language = SUPPORTED.includes(nextLanguage) ? nextLanguage : "auto";
    dict = language !== "auto" && nextDict && typeof nextDict === "object" ? nextDict : null;
    listeners.forEach((fn) => {
      try {
        fn(language);
      } catch (e) {
        // 單一監聽器出錯不影響其他監聽器
      }
    });
  }

  const ready = new Promise((resolve) => {
    try {
      chrome.storage.local.get(["uiLanguage", "i18nMessages"], (data) => {
        apply(data && data.uiLanguage, data && data.i18nMessages);
        resolve();
      });
    } catch (e) {
      resolve();
    }
  });

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || (!changes.uiLanguage && !changes.i18nMessages)) return;
      chrome.storage.local.get(["uiLanguage", "i18nMessages"], (data) => {
        apply(data && data.uiLanguage, data && data.i18nMessages);
      });
    });
  } catch (e) {
    // 某些環境（例如網頁本身）沒有 chrome.storage，僅使用瀏覽器內建翻譯
  }

  async function loadMessages(lang) {
    const resp = await fetch(chrome.runtime.getURL(`_locales/${lang}/messages.json`));
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  }

  // 只在 popup / background 呼叫（需要能 fetch 擴充功能自己的檔案）。
  async function setLanguage(lang) {
    if (!SUPPORTED.includes(lang)) {
      await chrome.storage.local.set({ uiLanguage: "auto" });
      await chrome.storage.local.remove("i18nMessages");
      apply("auto", null);
      return;
    }
    const messages = await loadMessages(lang);
    await chrome.storage.local.set({ uiLanguage: lang, i18nMessages: messages });
    apply(lang, messages);
  }

  // 擴充功能更新後 messages.json 可能新增了字串，重新讀一次存起來，避免用到舊字典。
  async function refreshStoredMessages() {
    await ready;
    if (language !== "auto") await setLanguage(language);
  }

  // 給 <html lang> 用的語系代碼
  function currentLocale() {
    if (language === "zh_TW") return "zh-Hant";
    if (language === "en") return "en";
    try {
      return chrome.i18n.getUILanguage();
    } catch (e) {
      return "zh-Hant";
    }
  }

  root.TasI18n = {
    t,
    ready,
    setLanguage,
    refreshStoredMessages,
    currentLocale,
    getLanguage: () => language,
    onChange: (fn) => listeners.push(fn),
  };
})(globalThis);
