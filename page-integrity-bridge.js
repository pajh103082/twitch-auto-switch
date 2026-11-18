// 這支腳本會被注入到 Twitch 網頁「本身的」執行環境（世界）裡，不是擴充功能的隔離環境
// （manifest.json 裡設定 "world": "MAIN"）。
//
// 目的：內容腳本（content-gql-claim.js）沒辦法直接拿到 Twitch 網站用來通過反機器人驗證
// （Kasada）的 Client-Integrity token —— 這個 token 只有在真正的網頁環境裡、由 Twitch
// 自己載入的 KPSDK 腳本才能產生。這裡的做法是：
//   1. 監聽內容腳本用 postMessage 送來的「幫我要一個 integrity token」請求。
//   2. 等 Twitch 自己的 KPSDK 準備好之後，用（已被下面攔截的）fetch 去打
//      https://gql.twitch.tv/integrity —— 因為這個 fetch 是在網頁本身的環境執行，
//      會被 KPSDK 自動附加它需要的驗證資訊，所以能拿到合法的 token。
//   3. 攔截這個請求的回應，把 token 用 postMessage 轉發回內容腳本。
//
// 順便攔截 Twitch 自己頁面本來就會定期查詢的「這個頻道是否有可領取的頻道點數獎勵」
// （ChannelPointsContext）回應，直接把結果轉發出去，不用自己額外發請求。
(function () {
  if (window.__atsIntegrityBridgeInstalled) return;
  window.__atsIntegrityBridgeInstalled = true;

  const originalFetch = window.fetch;

  window.fetch = function (...args) {
    const promise = originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0] && args[0].url;

      if (url && url.indexOf("https://gql.twitch.tv/integrity") === 0) {
        promise
          .then((resp) =>
            resp
              .clone()
              .json()
              .then((data) => {
                if (data && data.token) {
                  window.postMessage({ atsClaimBridge: { integrity: data } }, "*");
                }
              })
          )
          .catch(() => {});
      }

      if (url && url.indexOf("https://gql.twitch.tv/gql") === 0) {
        promise
          .then((resp) =>
            resp
              .clone()
              .json()
              .then((arr) => {
                if (!Array.isArray(arr)) return;
                arr.forEach((item) => {
                  try {
                    if (item.extensions && item.extensions.operationName === "ChannelPointsContext") {
                      const claim =
                        item.data &&
                        item.data.community &&
                        item.data.community.channel &&
                        item.data.community.channel.self &&
                        item.data.community.channel.self.communityPoints &&
                        item.data.community.channel.self.communityPoints.availableClaim;
                      if (claim) {
                        window.postMessage(
                          {
                            atsClaimBridge: {
                              channelPointsClaim: {
                                claimID: claim.id,
                                channelID: item.data.community.channel.id,
                              },
                            },
                          },
                          "*"
                        );
                      }
                    }
                  } catch (e) {
                    // 忽略單筆解析錯誤，不影響其他項目
                  }
                });
              })
          )
          .catch(() => {});
      }
    } catch (e) {
      // 忽略解析錯誤，不影響原本的 fetch 行為
    }
    return promise;
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const headers = event.data && event.data.atsRequestIntegrity;
    if (!headers) return;

    let tries = 150; // 最多輪詢約 15 秒，等 KPSDK 準備好
    const tryFetch = () => {
      if (tries-- <= 0) return;
      if ("KPSDK" in window && typeof window.KPSDK.isReady === "function" && !window.KPSDK.isReady()) {
        setTimeout(tryFetch, 100);
        return;
      }
      // 這裡要帶上內容腳本傳來的完整 headers（含 Authorization／Client-Session-Id 等），
      // Twitch 的 /integrity 端點需要知道是哪個已登入的使用者、哪個 session 才會發合法 token。
      window.fetch("https://gql.twitch.tv/integrity", { method: "POST", headers }).catch(() => {});
    };
    tryFetch();
  });
})();
