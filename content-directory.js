// 在 Twitch 分類 (directory) 頁面上，掃描目前畫面上的實況卡片，
// 找出帶有「掉寶 / Drops Enabled」標籤文字的頻道連結，回報給 background。
(function () {
  const SCAN_RETRY_DELAY_MS = 800;
  const SCAN_MAX_WAIT_MS = 10000;

  function collectMatchingChannels(dropsTagTexts) {
    const results = new Set();
    const anchors = Array.from(document.querySelectorAll('a[href^="/"]')).filter((a) => {
      let path;
      try {
        path = new URL(a.href).pathname;
      } catch (e) {
        return false;
      }
      // 頻道首頁連結格式為 /channelLogin，排除 /directory /videos /p 等非頻道路徑
      return /^\/[a-zA-Z0-9_]{2,25}$/.test(path) && !/^\/(directory|videos|p|settings|subs|payments|wallet|drops)$/i.test(path);
    });

    anchors.forEach((a) => {
      let container = a.closest("article") || a.parentElement;
      for (let i = 0; i < 6 && container; i++) {
        const text = container.innerText || "";
        if (dropsTagTexts.some((tag) => text.includes(tag))) {
          const login = new URL(a.href).pathname.replace("/", "");
          if (login) results.add(login);
          break;
        }
        container = container.parentElement;
      }
    });

    return Array.from(results);
  }

  const NOT_FOUND_MARKERS = [
    "Page Not Found",
    "page not found",
    "temporarily unavailable",
    "Sorry. Unless you've got a time machine",
    "找不到此頁面",
    "此分類不存在",
    "找不到頁面",
  ];

  function detectNotFound() {
    const text = document.body ? document.body.innerText : "";
    return NOT_FOUND_MARKERS.some((marker) => text.includes(marker));
  }

  // Twitch 分類頁的實況卡片清單是虛擬化的，一開始只渲染第一屏。輕輕往下捲一點可以
  // 觸發它多載入幾張卡片，讓掃描更容易找到有掉寶標籤的頻道；捲完再回到最上面。
  function nudgeScroll() {
    try {
      window.scrollTo(0, document.body.scrollHeight);
      setTimeout(() => {
        try {
          window.scrollTo(0, 0);
        } catch (e) {}
      }, 400);
    } catch (e) {
      // 忽略
    }
  }

  async function scan(requestId, dropsTagTexts) {
    const deadline = Date.now() + SCAN_MAX_WAIT_MS;
    let found = [];
    let scrolls = 0;
    while (Date.now() < deadline) {
      found = collectMatchingChannels(dropsTagTexts);
      if (found.length > 0) break;
      // 前幾輪還沒找到就捲動一下催促延遲載入的卡片渲染出來
      if (scrolls < 3) {
        nudgeScroll();
        scrolls += 1;
      }
      await new Promise((resolve) => setTimeout(resolve, SCAN_RETRY_DELAY_MS));
    }
    const notFound = found.length === 0 && detectNotFound();
    chrome.runtime.sendMessage({ type: "directoryScanResult", requestId, channels: found, notFound });
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "scanDirectory") {
      scan(
        msg.requestId,
        msg.dropsTagTexts || ["Drops Enabled", "DropsEnabled", "掉寶", "启用掉宝", "掉落", "允許掉落", "支援掉落", "Включены", "DropsВключены"]
      );
    }
  });
})();
