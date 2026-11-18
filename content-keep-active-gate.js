// 控制 page-keep-active.js 的「保持前景」覆寫要不要生效。
// 跑在隔離環境，讀得到 chrome.storage 設定；MAIN world 的注入腳本讀不到 chrome.*，
// 所以透過頁面的 localStorage 旗標當橋樑傳遞開關狀態。
//
// 規則：只有在「整個工具是啟用狀態（settings.enabled）」時才把可見性偽裝成前景；
// 使用者把工具停用時，還原成瀏覽器真實的可見性行為（背景分頁該暫停就暫停），
// 避免只是安裝了、但沒在用的時候還一直讓所有 Twitch 分頁不暫停。
(function () {
  const FLAG_KEY = "__atsKeepPlaying";

  function apply(enabled) {
    try {
      localStorage.setItem(FLAG_KEY, enabled ? "1" : "0");
    } catch (e) {
      // 忽略
    }
  }

  function refresh() {
    chrome.storage.local.get("settings", (data) => {
      const settings = data && data.settings;
      // 預設啟用（enabled 預設就是由 popup 控制；讀不到時保守地當作啟用，
      // 因為會安裝這個工具通常就是想要它保持播放）
      const enabled = !settings || settings.enabled !== false;
      apply(enabled);
    });
  }

  refresh();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) refresh();
  });
})();
