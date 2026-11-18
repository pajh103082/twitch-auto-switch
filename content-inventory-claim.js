// 在 https://www.twitch.tv/drops/inventory 頁面上，掃描所有可領取的掉寶獎勵並依序點擊領取。
// 這是「定期補漏」層：background 會開一個不搶焦點的背景分頁載入這個頁面，叫這支腳本把
// 目前庫存裡所有已就緒但還沒領的獎勵領完，再把結果回報回去，background 領完就會關閉分頁。
(function () {
  const MAX_ROUNDS = 10;
  const CLICK_WAIT_MS = 1200;

  function isVisible(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  // 有些領取按鈕實際上不是 <button>，而是卡片上一個滑鼠移過去才會顯示的覆蓋層
  // （常見於卡片式 UI，例如 hover 才出現的「立即領取」浮層），不見得有 button 語意標籤。
  // 這裡先找標準按鈕，找不到再退而求其次：找出畫面上文字「完全等於」領取字樣、
  // 且滑鼠移過去是手指游標（cursor: pointer，代表可點擊）的最內層元素，直接呼叫 .click()
  // ——即使不是 <button>，click() 事件一樣會往上冒泡，觸發外層真正的點擊處理邏輯。
  function findClaimButtons(claimTexts) {
    const explicitButtons = Array.from(document.querySelectorAll('button, [role="button"]')).filter((el) => {
      if (!isVisible(el)) return false;
      const text = (el.innerText || el.textContent || "").trim();
      if (!text) return false;
      return claimTexts.some((t) => text === t || text.includes(t));
    });
    if (explicitButtons.length > 0) return explicitButtons;

    const candidates = Array.from(document.querySelectorAll("div, span, a, p")).filter((el) => {
      if (!isVisible(el)) return false;
      const text = (el.innerText || el.textContent || "").trim();
      if (!text) return false;
      if (!claimTexts.some((t) => text === t)) return false;
      try {
        return getComputedStyle(el).cursor === "pointer";
      } catch (e) {
        return false;
      }
    });
    // 只保留最內層（沒有其他候選元素是它的子孫）的元素，避免點到一個包住整張卡片的大容器
    return candidates.filter((el) => !candidates.some((other) => other !== el && el.contains(other)));
  }

  // 嘗試從按鈕所在的卡片抓一個可讀的獎勵名稱（例如標題文字），抓不到就回傳空字串。
  function findRewardLabel(button) {
    let node = button;
    for (let i = 0; i < 6 && node; i++) {
      const heading = node.querySelector && node.querySelector('h3, h4, [class*="title" i]');
      const text = heading && heading.textContent ? heading.textContent.trim() : "";
      if (text) return text;
      node = node.parentElement;
    }
    return "";
  }

  async function claimAll(claimTexts) {
    const claimed = [];
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const buttons = findClaimButtons(claimTexts);
      if (buttons.length === 0) break;
      const label = findRewardLabel(buttons[0]);
      buttons[0].click();
      claimed.push(label);
      await new Promise((resolve) => setTimeout(resolve, CLICK_WAIT_MS));
    }
    return claimed;
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === "claimInventoryDrops") {
      const claimTexts =
        msg.claimButtonTexts && msg.claimButtonTexts.length
          ? msg.claimButtonTexts
          : ["Claim", "Claim Drop Rewards", "領取", "领取", "获取", "立即領取", "立即领取", "马上领取", "Получить", "Забрать"];
      claimAll(claimTexts).then((claimed) => sendResponse({ claimed }));
      return true; // 非同步回應
    }
  });
})();
