// 在頁面載入初期，就把 Twitch 的「成人／敏感內容」警告和幾個新手引導彈窗的 localStorage
// 旗標預先設成「已同意／已關閉」，讓這些門檻盡量不要跳出來擋住播放器、需要手動點擊。
//
// content script 跑在隔離環境，但 localStorage 是依網域共用的——這裡寫入的旗標，Twitch 自己
// 頁面上的程式讀得到，所以能有效地預先同意。跑在 document_start 是為了趕在 Twitch 判斷要不要
// 顯示門檻之前就把旗標設好。
//
// 註：新版 Twitch 針對特定「內容分級」標籤（暴力、性暗示等）的門檻，不一定吃這個舊旗標；
// 那種情況由 content-player-watchdog.js 自動點掉覆蓋層的「開始觀看」按鈕當作補強。
(function () {
  const prefs = {
    mature: "true", // 成人內容警告：預先同意
    channelPointsOnboardingDismissed: "true",
    powerUpsFtueDismissed: "true",
  };
  for (const key in prefs) {
    try {
      localStorage.setItem(key, prefs[key]);
    } catch (e) {
      // 某些情況下讀不到 localStorage，忽略即可
    }
  }
})();
