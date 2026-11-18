// 透過 Twitch 內部（非公開文件記載的）GQL mutation 直接領取掉寶 / 頻道點數獎勵，
// 而不是掃描畫面上的按鈕文字。這裡呼叫的 operationName / persistedQuery hash 是從
// 參考擴充功能（Automatic Twitch Drops Miner）的原始碼裡找到的，行為上等同它的做法：
//   1. 讀取 Twitch 自己網頁的 auth-token cookie，組成 Authorization: OAuth <token>。
//   2. 透過 page-integrity-bridge.js（注入到網頁本身環境）取得 Client-Integrity token
//      —— 這個 token 是 Twitch 反機器人偵測（Kasada）要求的，沒有它這些 mutation 會被拒絕。
//   3. 用這兩個 header 呼叫 Twitch 私有 GQL：
//      - Inventory 查詢：列出目前有哪些掉寶已達成但還沒領。
//      - DropsPage_ClaimDropRewards：實際領取指定的掉寶。
//      - ClaimCommunityPoints：實際領取頻道點數獎勵（金額由 API 直接回傳，精準不用用猜的）。
//
// 這一步等同於直接參與解開 Twitch 用來偵測自動化行為的驗證機制，跟單純模擬點擊按鈕不同，
// 已經跟使用者確認過這個取捨。
(function () {
  function t(key, subs) {
    return globalThis.TasI18n ? TasI18n.t(key, subs) : chrome.i18n.getMessage(key, subs) || key;
  }

  const GQL_ENDPOINT = "https://gql.twitch.tv/gql";
  const CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";
  // 沿用參考擴充功能使用的 Client-Version 值——這只是一個版本標籤格式的字串，
  // 不是帳號機密資訊，Twitch 的 GQL 似乎只檢查格式而非比對特定值。
  const CLIENT_VERSION = "1681539c-7310-4729-8bf6-383e2e8f9f1f";
  const INTEGRITY_TIMEOUT_MS = 16000;

  const INVENTORY_QUERY_HASH = "09acb7d3d7e605a92bdfdcc465f6aa481b71c234d8686a9ba38ea5ed51507592";
  const CLAIM_DROP_HASH = "a455deea71bdc9015b78eb49f4acfbce8baa7ccbedd28e549bb025bd0f751930";
  const CLAIM_POINTS_HASH = "46aaeebe02c99afdf4fc97c7c0cba964124bf6b0af229395f1f6d1feed05b3d0";
  const CHANNEL_POINTS_CONTEXT_HASH = "374314de591e69925fce3ddc2bcf085796f56ebb8cad67a0daa3165c03adc345";

  function randomHex(len) {
    let s = "";
    while (s.length < len) s += Math.floor(Math.random() * 16).toString(16);
    return s.slice(0, len);
  }

  // 這個分頁載入期間固定使用同一組 session/device id，模擬一次正常的瀏覽 session。
  const sessionId = randomHex(16);
  const deviceId = randomHex(32);

  function getAuthToken() {
    const m = document.cookie.match(/(?:^|; )auth-token=([^;]*)/);
    return m ? m[1] : null;
  }

  // 組出「還沒有 Client-Integrity」的基礎 headers，連同這組 headers 一起去跟主世界要
  // integrity token——因為 Twitch 的 /integrity 端點需要知道「這是哪個已登入的使用者、
  // 哪個 session」才會發合法的 token，不能只帶 Client-Id 空手去要。
  function buildBaseHeaders(token) {
    return {
      "Content-Type": "application/json",
      "Client-Id": CLIENT_ID,
      "Client-Version": CLIENT_VERSION,
      "Client-Session-Id": sessionId,
      "X-Device-Id": deviceId,
      Authorization: `OAuth ${token}`,
    };
  }

  function requestIntegrityToken(baseHeaders) {
    return new Promise((resolve, reject) => {
      let done = false;
      const listener = (event) => {
        if (event.source !== window) return;
        const bridge = event.data && event.data.atsClaimBridge;
        if (bridge && bridge.integrity && bridge.integrity.token) {
          if (!done) {
            done = true;
            window.removeEventListener("message", listener);
            resolve(bridge.integrity.token);
          }
        }
      };
      window.addEventListener("message", listener);
      window.postMessage({ atsRequestIntegrity: baseHeaders }, "*");
      setTimeout(() => {
        if (!done) {
          done = true;
          window.removeEventListener("message", listener);
          reject(new Error("integrity-timeout"));
        }
      }, INTEGRITY_TIMEOUT_MS);
    });
  }

  async function gqlCall(headers, operationName, hash, variables) {
    const resp = await fetch(GQL_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify([
        {
          operationName,
          extensions: { persistedQuery: { sha256Hash: hash, version: 1 } },
          variables,
        },
      ]),
    });
    if (!resp.ok) {
      const err = new Error(t("errGqlOperationHttpFailed", [operationName, String(resp.status)]));
      err.code = "GQL_HTTP_ERROR";
      throw err;
    }
    const json = await resp.json();
    // Twitch 的 GQL 即使查詢/驗證失敗，HTTP 狀態碼通常還是 200，只是內容帶著
    // errors 陣列——一定要檢查這個，不然驗證失敗會被誤判成「查詢成功、只是沒東西可領」。
    const errors = (json && json[0] && json[0].errors) || null;
    if (errors && errors.length) {
      const err = new Error(t("errGqlOperationResponseError", [operationName, errors.map((e) => e.message).join("; ")]));
      err.code = "GQL_RESPONSE_ERROR";
      throw err;
    }
    return json;
  }

  async function claimDropsViaApi() {
    const token = getAuthToken();
    if (!token) return { ok: false, error: t("errNotLoggedIn") };

    const baseHeaders = buildBaseHeaders(token);
    let integrityToken;
    try {
      integrityToken = await requestIntegrityToken(baseHeaders);
    } catch (e) {
      return { ok: false, error: t("errIntegrityTimeout") };
    }

    const headers = { ...baseHeaders, "Client-Integrity": integrityToken };

    let invJson;
    try {
      invJson = await gqlCall(headers, "Inventory", INVENTORY_QUERY_HASH, { fetchRewardCampaigns: false });
    } catch (e) {
      return { ok: false, error: t("errInventoryQueryFailed", [String(e && e.message)]) };
    }

    const claimable = [];
    try {
      const campaigns =
        (invJson[0] &&
          invJson[0].data &&
          invJson[0].data.currentUser &&
          invJson[0].data.currentUser.inventory &&
          invJson[0].data.currentUser.inventory.dropCampaignsInProgress) ||
        [];
      campaigns.forEach((campaign) => {
        (campaign.timeBasedDrops || []).forEach((drop) => {
          if (drop.self && drop.self.dropInstanceID && !drop.self.isClaimed && (drop.benefitEdges || []).length) {
            const firstBenefit = drop.benefitEdges[0] && drop.benefitEdges[0].benefit;
            claimable.push({
              dropInstanceID: drop.self.dropInstanceID,
              name: (firstBenefit && firstBenefit.name) || drop.name || t("defaultDropRewardName"),
            });
          }
        });
      });
    } catch (e) {
      // 解析失敗就當作沒有可領取的，讓外層走 DOM 備援
    }

    const claimed = [];
    let lastClaimError = null;
    for (const drop of claimable) {
      try {
        const claimJson = await gqlCall(headers, "DropsPage_ClaimDropRewards", CLAIM_DROP_HASH, {
          input: { dropInstanceID: drop.dropInstanceID },
        });
        if (claimJson[0] && claimJson[0].data && claimJson[0].data.claimDropRewards) {
          claimed.push(drop.name);
        }
      } catch (e) {
        // 單筆領取失敗不影響其他筆，繼續嘗試下一筆，但記下最後一次的錯誤方便診斷
        lastClaimError = e && e.message;
      }
    }

    // 查得到「有東西可領」，卻一筆都沒領成功，回報成失敗讓外層知道要走備援，
    // 而不是誤判成「查完了、剛好沒有可領的」。
    if (claimable.length > 0 && claimed.length === 0) {
      return {
        ok: false,
        error: t("errAllClaimsFailed", [String(claimable.length), lastClaimError || t("defaultUnknownError")]),
      };
    }

    return { ok: true, claimed };
  }

  // 判斷目前分頁是不是「正在看某個頻道」，回傳頻道 login；不是的話回傳 null。
  // 邏輯對照參考擴充功能的 we()/_e()：排除 directory、drops、videos 等保留路徑跟 clip 網址。
  const RESERVED_PATHS = [
    "",
    "videos",
    "directory",
    "subscriptions",
    "drops",
    "wallet",
    "settings",
    "embed",
    "popout",
    "p",
    "payments",
  ];
  function getCurrentChannelLogin() {
    if (/\/clip\//i.test(location.pathname)) return null;
    const first = location.pathname.split("/")[1] || "";
    if (RESERVED_PATHS.includes(first.toLowerCase())) return null;
    return first;
  }

  // 主動路徑跟被動路徑有機會在很接近的時間點查到同一個 claimID（例如頁面剛載入時 Twitch
  // 自己查了一次觸發被動路徑，background 排程又剛好觸發主動路徑）。對同一個 claimID 重複呼叫
  // 領取 mutation，Twitch 可能回傳「看起來像成功、但其實這次沒有真的再發獎勵」的回應
  // （因為獎勵在第一次呼叫時就已經真的領走了），導致誤判成「又領到一次」但帳號其實沒有多拿到
  // 點數。這裡用一個簡單的已處理 claimID 名單擋掉同一個 claimID 的重複呼叫。
  const attemptedClaimIds = new Set();

  async function performClaimCommunityPoints(headers, claimID, channelID) {
    if (attemptedClaimIds.has(claimID)) return null;
    attemptedClaimIds.add(claimID);

    const json = await gqlCall(headers, "ClaimCommunityPoints", CLAIM_POINTS_HASH, {
      input: { channelID, claimID },
    });
    const claim = json[0] && json[0].data && json[0].data.claimCommunityPoints && json[0].data.claimCommunityPoints.claim;
    const points = claim && claim.pointsEarnedTotal;
    if (points) {
      chrome.runtime.sendMessage({ type: "dropClaimed", source: "channel-points", text: t("defaultChannelPointsRewardName"), amount: points });
    }
    return points || null;
  }

  // 被動路徑：Twitch 自己的頁面在你正在看某頻道時，本來就會不定期查詢是否有點數獎勵可領
  // （ChannelPointsContext），page-integrity-bridge.js 攔截到那個回應就會轉發過來，
  // 收到就直接嘗試領取——這個比主動查詢更即時，但不保證一定會發生。
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const bridge = event.data && event.data.atsClaimBridge;
    if (bridge && bridge.channelPointsClaim) {
      (async () => {
        if (attemptedClaimIds.has(bridge.channelPointsClaim.claimID)) return;
        const token = getAuthToken();
        if (!token) return;
        const baseHeaders = buildBaseHeaders(token);
        try {
          const integrityToken = await requestIntegrityToken(baseHeaders);
          const headers = { ...baseHeaders, "Client-Integrity": integrityToken };
          await performClaimCommunityPoints(headers, bridge.channelPointsClaim.claimID, bridge.channelPointsClaim.channelID);
        } catch (e) {
          // 失敗就放著，等下一次主動查詢週期再試
        }
      })();
    }
  });

  // 主動路徑（跟參考擴充功能的 pe() 對應）：不等 Twitch 自己的頁面剛好去查，
  // 我們自己主動查一次「目前這個頻道」的頻道點數領取狀態，查到就直接領。
  // background.js 會定期（跟掉寶用同一個排程）呼叫這個。
  async function checkAndClaimChannelPointsViaApi() {
    const channelLogin = getCurrentChannelLogin();
    if (!channelLogin) return { ok: true, claimed: false, reason: t("msgNotOnChannelPage") };

    const token = getAuthToken();
    if (!token) return { ok: false, error: t("errNotLoggedIn") };

    const baseHeaders = buildBaseHeaders(token);
    let integrityToken;
    try {
      integrityToken = await requestIntegrityToken(baseHeaders);
    } catch (e) {
      return { ok: false, error: t("errIntegrityTimeout") };
    }
    const headers = { ...baseHeaders, "Client-Integrity": integrityToken };

    let json;
    try {
      json = await gqlCall(headers, "ChannelPointsContext", CHANNEL_POINTS_CONTEXT_HASH, {
        channelLogin,
        includeGoalTypes: ["CREATOR"],
      });
    } catch (e) {
      return { ok: false, error: t("errChannelPointsQueryFailed", [String(e && e.message)]) };
    }

    const channel = json[0] && json[0].data && json[0].data.community && json[0].data.community.channel;
    const claim = channel && channel.self && channel.self.communityPoints && channel.self.communityPoints.availableClaim;
    if (!claim) return { ok: true, claimed: false };

    try {
      const points = await performClaimCommunityPoints(headers, claim.id, channel.id);
      return { ok: true, claimed: !!points, points };
    } catch (e) {
      return { ok: false, error: t("errChannelPointsClaimFailed", [String(e && e.message)]) };
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === "claimDropsViaApi") {
      claimDropsViaApi()
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
      return true; // 非同步回應
    }
    if (msg && msg.type === "checkChannelPointsViaApi") {
      checkAndClaimChannelPointsViaApi()
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
      return true; // 非同步回應
    }
  });
})();
