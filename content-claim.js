// 在一般 Twitch 頁面（頻道直播頁等）上，即時偵測畫面上跳出的「領取掉寶獎勵」按鈕並自動點擊。
// 這是「即時攔截」層：抓的是你正在看的那個分頁上彈出的領取提示，不會額外開分頁、不會打斷觀看。
//
// 注意：頻道點數（忠誠點數）獎勵寶箱原本也是在這裡用 DOM 點擊處理，現在已經改由
// content-gql-claim.js 透過私有 API 直接領取。這裡刻意不再重複做 DOM 點擊，是因為兩條路徑
// 同時搶著領同一個獎勵，會導致其中一條路徑在獎勵已經被領走之後，再用同一個（已失效）的
// claim 資訊呼叫一次，Twitch 可能回傳看起來像成功、但其實沒有真的再發一次獎勵的回應，
// 造成「顯示已領取，但帳號其實沒多拿到點數」的假象。
(function () {
  const CHECK_INTERVAL_MS = 3000;
  let claimTexts = [
    "Claim",
    "Claim Drop Rewards",
    "領取",
    "领取",
    "获取",
    "立即領取",
    "立即领取",
    "马上领取",
    "Получить",
    "Забрать",
  ];
  const clickedElements = new WeakSet();

  function loadSettings() {
    chrome.storage.local.get("settings", (data) => {
      const settings = data && data.settings;
      if (settings && Array.isArray(settings.claimButtonTexts) && settings.claimButtonTexts.length > 0) {
        claimTexts = settings.claimButtonTexts;
      }
    });
  }
  loadSettings();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) loadSettings();
  });

  function isVisible(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  // 為了避免誤點畫面上其他也叫「Claim」但跟掉寶無關的按鈕（例如 Prime Gaming），
  // 只有在按鈕的祖先元素 class / data 屬性看起來跟 "drop" 有關時才會點擊。
  function hasDropContext(el) {
    let node = el;
    for (let i = 0; i < 8 && node; i++) {
      const cls = typeof node.className === "string" ? node.className : "";
      const attrs = ["data-a-target", "data-test-selector", "aria-label", "id"]
        .map((name) => (node.getAttribute ? node.getAttribute(name) : null))
        .filter(Boolean)
        .join(" ");
      const combined = `${cls} ${attrs}`.toLowerCase();
      if (combined.includes("drop")) return true;
      node = node.parentElement;
    }
    return false;
  }

  function findClaimButtons() {
    const explicitButtons = Array.from(document.querySelectorAll('button, [role="button"]')).filter((el) => {
      if (clickedElements.has(el)) return false;
      if (!isVisible(el)) return false;
      const text = (el.innerText || el.textContent || "").trim();
      if (!text) return false;
      const matched = claimTexts.some((t) => text === t || text.includes(t));
      if (!matched) return false;
      return hasDropContext(el);
    });
    if (explicitButtons.length > 0) return explicitButtons;

    // 有些領取提示不是 <button>，而是卡片/浮層上的一段可點文字（沒有 button 語意標籤）。
    // 退而求其次：找完全符合文字、滑鼠移過去是手指游標的最內層元素，一樣呼叫 .click()
    // 讓事件往上冒泡觸發實際的點擊處理邏輯。
    const candidates = Array.from(document.querySelectorAll("div, span, a, p")).filter((el) => {
      if (clickedElements.has(el)) return false;
      if (!isVisible(el)) return false;
      const text = (el.innerText || el.textContent || "").trim();
      if (!text) return false;
      if (!claimTexts.some((t) => text === t)) return false;
      if (!hasDropContext(el)) return false;
      try {
        return getComputedStyle(el).cursor === "pointer";
      } catch (e) {
        return false;
      }
    });
    return candidates.filter((el) => !candidates.some((other) => other !== el && el.contains(other)));
  }

  function tryClaim() {
    findClaimButtons().forEach((btn) => {
      clickedElements.add(btn);
      const text = (btn.innerText || btn.textContent || "").trim();
      try {
        btn.click();
        chrome.runtime.sendMessage({ type: "dropClaimed", source: "player", text });
      } catch (e) {
        // 分頁正在卸載等情況，忽略即可
      }
    });
  }

  const observer = new MutationObserver(() => tryClaim());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(tryClaim, CHECK_INTERVAL_MS);
  tryClaim();
})();
