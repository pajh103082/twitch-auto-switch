// 在 Twitch 頁面的「MAIN world（頁面真正的執行環境）」覆寫 Page Visibility API，
// 讓 Twitch 自己的程式永遠讀到「這個分頁是可見的 / 前景的」。
//
// 為什麼需要這個：
//   Twitch 的播放器與分類頁會依 document.hidden / document.visibilityState 判斷分頁是不是
//   在前景。當你切到別的分頁、或 Windows 鎖定螢幕（螢幕關閉）時，瀏覽器會把這個分頁標記成
//   hidden，Twitch 收到後就會「自動暫停影片、停止累積觀看時數與掉寶進度」；分類頁的虛擬化
//   實況卡片清單也可能因為分頁在背景而不渲染，導致掃描抓不到頻道。
//   把可見性永遠回報成「可見」，Twitch 就不會因為背景/鎖定而暫停，也會照常渲染分類頁卡片，
//   達到「長時間保持執行」以及「背景也掃得到掉寶頻道」的效果。
//
// 這個覆寫只影響「頁面自己的程式（MAIN world）」看到的值；擴充功能自己的 content script
// 跑在另一個隔離環境（isolated world），仍然讀得到「真實」的 document.hidden，所以播放器
// 監看邏輯要判斷「使用者到底有沒有在看」時不會被這個覆寫誤導。
//
// 開關：由 content-keep-active-gate.js 依「工具是否啟用」寫進 localStorage 的旗標控制。
//   旗標 === "0" → 停用覆寫（回報真實可見性）；其餘（含未設定）→ 啟用覆寫。
//   getter 每次即時讀旗標，所以在設定裡停用工具後幾秒內就會恢復原本行為，不需要重新整理。
(function () {
  const FLAG_KEY = "__atsKeepPlaying";

  function keepActiveOn() {
    try {
      return localStorage.getItem(FLAG_KEY) !== "0";
    } catch (e) {
      // 某些情況下（例如沙箱 iframe）讀不到 localStorage，預設啟用
      return true;
    }
  }

  // 保留原本的 getter，停用覆寫時要能回報真實值。
  function realGetter(proto, prop) {
    const desc = Object.getOwnPropertyDescriptor(proto, prop);
    return desc && typeof desc.get === "function" ? desc.get : null;
  }

  function override(prop, spoofedValue, proto) {
    const original = realGetter(proto, prop);
    try {
      Object.defineProperty(document, prop, {
        configurable: true,
        get: function () {
          if (keepActiveOn()) return spoofedValue;
          return original ? original.call(document) : undefined;
        },
      });
    } catch (e) {
      // 已被其他腳本鎖定等情況，忽略
    }
  }

  override("hidden", false, Document.prototype);
  override("visibilityState", "visible", Document.prototype);
  // 舊版 webkit 前綴，部分 Twitch 程式仍可能參考
  if ("webkitHidden" in document) override("webkitHidden", false, Document.prototype);
  if ("webkitVisibilityState" in document) override("webkitVisibilityState", "visible", Document.prototype);

  // 主動派發一次 visibilitychange，讓頁面上「還在等分頁變可見才恢復播放」的邏輯立刻動作。
  try {
    document.dispatchEvent(new Event("visibilitychange"));
  } catch (e) {
    // 忽略
  }
})();
