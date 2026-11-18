// 在頻道直播頁上監看播放器狀態，出錯或卡住時自動處理。
// 兩種偵測方式：
//   1. Twitch 自己跳出的「重新載入/重試」錯誤按鈕 —— 直接點掉，不用整個分頁重整。
//   2. <video> 實際解碼/渲染的影格數長時間沒有增加（畫面卡住但沒跳出錯誤 UI）—— 整個分頁重新整理。
//
// 重要：分頁在背景 / 電腦鎖定螢幕時（真實 document.hidden 為 true）「絕對不重新整理」。
//   原因：螢幕鎖定或分頁切到背景時，瀏覽器會停止渲染影格，getVideoPlaybackQuality() 回報的
//   影格數自然就不再增加——但這不代表播放真的壞掉，音訊與 Twitch 的觀看時數／掉寶心跳其實
//   還在跑（尤其搭配 page-keep-active.js 讓 Twitch 以為分頁在前景、不會暫停）。過去這裡會把
//   「影格停止」誤判成卡住而反覆重整，正是電腦鎖定時網頁被狂刷的元凶。現在改成：背景/鎖定時
//   只做「被暫停就強制續播」的保活，不做任何重整；等使用者回到這個分頁（變回可見）後，若畫面
//   是真的壞了，前景的影格偵測會接手處理。
//
// 只有在「分頁可見（使用者真的在看）」時才用影格數判斷卡住並重整。卡住判斷刻意不是只看
//   currentTime——直播常見「畫面凍結但聲音/緩衝時間戳還在跑」，那時 currentTime 照樣增加，
//   會偵測不到真正的凍結；改看實際渲染影格數才可靠，瀏覽器不支援該 API 時才退回用 currentTime。
//
// 為避免真的斷網／伺服器出問題時無限重整，前景重整同樣有次數上限與指數退避冷卻
//   （用完 10 分鐘 4 次額度後，冷卻 10 → 20 → 40 分鐘…上限 2 小時），偵測到恢復正常播放即歸零。
(function () {
  function t(key, subs) {
    return globalThis.TasI18n ? TasI18n.t(key, subs) : chrome.i18n.getMessage(key, subs) || key;
  }

  const CHECK_INTERVAL_MS = 5000;
  const MAX_RELOADS_PER_WINDOW = 4;
  const RELOAD_WINDOW_MS = 10 * 60 * 1000;
  const MAX_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 冷卻時間上限：2 小時
  // 播放器出現「確定的錯誤」（例如 #1000 影片下載已取消）後，先給「重試」按鈕和 Twitch 自己的
  // 自動重試一點時間；超過這個時間還沒恢復就整頁重新整理。
  const ERROR_RELOAD_AFTER_MS = 20 * 1000;
  // 同一顆門檻/錯誤按鈕點了之後若還在，隔這麼久可以再點一次（不能只點一次就放棄）。
  const GATE_RECLICK_MS = 15 * 1000;
  // Twitch 播放器錯誤訊息的格式：「(錯誤代碼 #1000)」「(Error #1000)」「(Ошибка #1000)」等。
  const ERROR_CODE_PATTERN = /(錯誤代碼|错误代码|error|ошибка|エラー|fehler|erreur)[^#\n]{0,12}#\s*(\d{3,4})/i;

  let enabled = true;
  let stallSeconds = 45;
  let reloadButtonTexts = [
    "Reload Player",
    "Try Again",
    "重新載入",
    "重試",
    "刷新",
    "重新整理",
    "Обновить",
    "Повторить попытку",
  ];

  function loadSettings() {
    chrome.storage.local.get("settings", (data) => {
      const settings = data && data.settings;
      if (settings && typeof settings.autoReloadOnError === "boolean") enabled = settings.autoReloadOnError;
      if (settings && typeof settings.playerStallSeconds === "number" && settings.playerStallSeconds > 0) {
        stallSeconds = settings.playerStallSeconds;
      }
      if (settings && Array.isArray(settings.reloadButtonTexts) && settings.reloadButtonTexts.length > 0) {
        reloadButtonTexts = settings.reloadButtonTexts;
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

  const clickedButtons = new WeakSet();

  function findReloadButtons() {
    return Array.from(document.querySelectorAll('button, [role="button"]')).filter((el) => {
      if (clickedButtons.has(el)) return false;
      // 門檻/錯誤覆蓋層的按鈕交給 tryClickGateButtons() 處理，這裡跳過，避免同一顆「重試」
      // 在同一瞬間被點兩次、還白白吃掉一次重整額度。
      if (GATE_BUTTON_SELECTORS.some((sel) => el.matches(sel))) return false;
      if (!isVisible(el)) return false;
      const text = (el.innerText || el.textContent || "").trim();
      if (!text) return false;
      return reloadButtonTexts.some((t) => text === t || text.includes(t));
    });
  }

  function notify(reason) {
    try {
      chrome.runtime.sendMessage({ type: "playerAutoReload", reason });
    } catch (e) {
      // 分頁正在卸載等情況，忽略即可
    }
  }

  // 用 sessionStorage 記錄這個分頁在時間窗內已經自動重試幾次，避免無限重整迴圈。
  // 如果同一個時間窗內的重試次數用完了，代表重整沒有真的解決問題，逐步拉長冷卻時間再試
  // （而不是每次都固定等 RELOAD_WINDOW_MS 就再刷一輪），直到偵測到真的恢復正常播放為止。
  function canRetryNow() {
    const now = Date.now();
    const cooldownUntil = parseInt(sessionStorage.getItem("twitchWatchdogCooldownUntil") || "0", 10);
    if (now < cooldownUntil) return false;

    let firstAt = parseInt(sessionStorage.getItem("twitchWatchdogFirstReloadAt") || "0", 10);
    let count = parseInt(sessionStorage.getItem("twitchWatchdogReloadCount") || "0", 10);
    if (!firstAt || now - firstAt > RELOAD_WINDOW_MS) {
      firstAt = now;
      count = 0;
    }
    count += 1;
    sessionStorage.setItem("twitchWatchdogFirstReloadAt", String(firstAt));
    sessionStorage.setItem("twitchWatchdogReloadCount", String(count));

    if (count <= MAX_RELOADS_PER_WINDOW) return true;

    let backoffLevel = parseInt(sessionStorage.getItem("twitchWatchdogBackoffLevel") || "0", 10) + 1;
    const cooldownMs = Math.min(RELOAD_WINDOW_MS * Math.pow(2, backoffLevel), MAX_COOLDOWN_MS);
    sessionStorage.setItem("twitchWatchdogBackoffLevel", String(backoffLevel));
    sessionStorage.setItem("twitchWatchdogCooldownUntil", String(now + cooldownMs));
    return false;
  }

  // 確認畫面真的有在正常播放時呼叫，把退避冷卻時間歸零，下次真的卡住才不會被之前的
  // 長冷卻時間拖累、遲遲不敢重試。
  function resetBackoff() {
    sessionStorage.removeItem("twitchWatchdogBackoffLevel");
    sessionStorage.removeItem("twitchWatchdogCooldownUntil");
  }

  function currentChannelLogin() {
    const seg = (location.pathname.split("/")[1] || "").toLowerCase();
    return /^[a-z0-9_]{2,25}$/.test(seg) ? seg : "";
  }

  // sessionStorage 在同一個分頁換頁之後還會保留。換到「不同頻道」時要把重試次數與冷卻歸零，
  // 否則因為上一個頻道一直壞掉而被換過來的新頻道，會繼承「額度已用完」的狀態，一出錯就直接放棄。
  (function resetBudgetOnChannelChange() {
    const ch = currentChannelLogin();
    if (sessionStorage.getItem("twitchWatchdogChannel") !== ch) {
      [
        "twitchWatchdogFirstReloadAt",
        "twitchWatchdogReloadCount",
        "twitchWatchdogBackoffLevel",
        "twitchWatchdogCooldownUntil",
      ].forEach((k) => sessionStorage.removeItem(k));
      sessionStorage.setItem("twitchWatchdogChannel", ch);
    }
  })();

  let gaveUpSent = false;

  // 重試額度用完、這個頻道還是播不起來：請背景把這個頻道暫時跳過，改切到別的實況主。
  // 每次載入頁面只送一次，避免冷卻期間一直重複送。
  function giveUpOnChannel() {
    if (gaveUpSent) return;
    const ch = currentChannelLogin();
    if (!ch) return;
    gaveUpSent = true;
    try {
      chrome.runtime.sendMessage({ type: "playerGaveUp", channel: ch });
    } catch (e) {
      // 分頁正在卸載等情況，忽略即可
    }
  }

  // Twitch 的「成人／年齡確認」門檻和播放器錯誤（例如 #1000「影片下載已取消，請再試一次」）
  // 都是渲染在覆蓋層 .content-overlay-gate / 內容分級門檻裡的按鈕。用「結構選擇器」直接點掉
  // 這些按鈕，比對照按鈕文字更可靠——不管介面是什麼語言、按鈕寫「開始觀看」還是「重試」都能點。
  const GATE_BUTTON_SELECTORS = [
    '[data-a-target="content-classification-gate-overlay-start-watching-button"]', // 內容分級門檻的「開始觀看」
    '[data-a-target="player-overlay-mature-accept"]', // 舊版成人內容「開始觀看」
    ".content-classification-gate__content button",
    ".content-overlay-gate__content button", // 播放器錯誤覆蓋層（含 #1000 重試）與內容門檻共用
  ];

  // 記錄每顆門檻/錯誤按鈕上次被點的時間。不能像一般按鈕那樣「點一次就永遠不再點」——
  // #1000 這類錯誤點了「重試」之後，若錯誤又發生、按鈕元素還是同一顆，就得能再點。
  const gateClickedAt = new WeakMap();

  function findGateButtons() {
    const found = [];
    const now = Date.now();
    GATE_BUTTON_SELECTORS.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        const last = gateClickedAt.get(el) || 0;
        if (now - last >= GATE_RECLICK_MS && isVisible(el) && !found.includes(el)) found.push(el);
      });
    });
    return found;
  }

  // 點掉年齡／內容門檻與播放器錯誤覆蓋層的按鈕。這不是整頁重新整理，只是點頁面上的按鈕，
  // 所以不受「視窗有沒有焦點」限制、也不會讓工具列閃爍，背景掛台時照樣能自動通過門檻／重試。
  function tryClickGateButtons() {
    if (!enabled) return;
    findGateButtons().forEach((btn) => {
      const firstTime = !gateClickedAt.has(btn);
      gateClickedAt.set(btn, Date.now());
      try {
        btn.click();
        // 同一顆按鈕只在第一次點時寫活動紀錄，避免錯誤卡住時每 15 秒洗一次紀錄
        if (firstTime) notify(t("watchdogGateClicked"));
      } catch (e) {
        // 忽略，下個週期若門檻還在會再處理
      }
    });
  }

  // 偵測播放器是否處於「確定的錯誤」狀態：<video> 回報 MediaError，或播放器區域出現
  // 「錯誤代碼 #1000」這類錯誤訊息。回傳錯誤代碼字串（例如 "#1000"），沒有錯誤則回傳 null。
  function detectPlayerError(video) {
    const containers = document.querySelectorAll(
      '.video-player, [data-a-target="video-player"], .persistent-player, [data-a-target="player-overlay-content-gate"]'
    );
    for (const c of containers) {
      const m = (c.innerText || "").match(ERROR_CODE_PATTERN);
      if (m) return "#" + m[2];
    }
    if (video && video.error) return "MediaError " + video.error.code;
    return null;
  }

  let errorSince = null;

  // 處理確定的播放器錯誤。這種錯誤不是「影格沒在渲染」那種可能是誤判的狀況，而是播放器明確
  // 壞掉了，所以不論分頁在不在前景、視窗有沒有焦點都要處理——不然背景掛台時遇到 #1000 就會
  // 一直卡著。先讓 tryClickGateButtons() 點「重試」、也給 Twitch 自己重試的時間，超過
  // ERROR_RELOAD_AFTER_MS 還沒好才整頁重新整理（仍受每 10 分鐘最多 4 次＋退避冷卻的上限保護）。
  // 回傳 true 代表目前是錯誤狀態、已處理，呼叫端不要再做其他判斷。
  function handlePlayerError(video) {
    const code = detectPlayerError(video);
    if (!code) {
      errorSince = null;
      return false;
    }
    const now = Date.now();
    if (errorSince === null) {
      errorSince = now;
      return true;
    }
    if (now - errorSince >= ERROR_RELOAD_AFTER_MS) {
      errorSince = now; // 避免同一次錯誤反覆觸發
      if (canRetryNow()) {
        notify(t("watchdogErrorReload", [code]));
        location.reload();
      } else {
        if (!gaveUpSent) notify(t("watchdogStalledMaxRetries")); // 只記一次，避免冷卻期間洗版
        giveUpOnChannel();
      }
    }
    return true;
  }

  function tryClickReloadButtons() {
    if (!enabled) return;
    findReloadButtons().forEach((btn) => {
      clickedButtons.add(btn);
      const text = (btn.innerText || btn.textContent || "").trim();
      if (!canRetryNow()) {
        if (!gaveUpSent) notify(t("watchdogErrorButtonMaxRetries", [text]));
        giveUpOnChannel();
        return;
      }
      try {
        btn.click();
        notify(t("watchdogErrorButtonClicked", [text]));
      } catch (e) {
        // 分頁正在卸載等情況，忽略即可
      }
    });
  }

  let lastFrameCount = null;
  let lastCurrentTime = null;
  let lastProgressAt = Date.now();
  let pausedNotified = false;

  // 優先用實際渲染的影格數判斷有沒有在動；瀏覽器不支援時退回用 currentTime。
  function getFrameCount(video) {
    try {
      if (typeof video.getVideoPlaybackQuality === "function") {
        const quality = video.getVideoPlaybackQuality();
        if (quality && typeof quality.totalVideoFrames === "number") {
          return quality.totalVideoFrames;
        }
      }
    } catch (e) {
      // 忽略，改用備援判斷方式
    }
    if (typeof video.webkitDecodedFrameCount === "number") {
      return video.webkitDecodedFrameCount;
    }
    return null;
  }

  function checkVideoStall() {
    if (!enabled) return;
    const video = document.querySelector("video");

    // 最優先處理「確定的錯誤」（#1000 等）。必須放在下面「暫停就續播」「還在載入就等」
    // 「視窗沒焦點就不重整」這些提早 return 之前——錯誤發生時影片常常是暫停、readyState 也會
    // 掉到 0/1，以前就是被這些分支先 return 掉，導致 #1000 永遠沒被當成錯誤處理。
    if (handlePlayerError(video)) {
      lastFrameCount = null;
      lastCurrentTime = null;
      lastProgressAt = Date.now();
      return;
    }

    if (!video) {
      lastFrameCount = null;
      lastCurrentTime = null;
      lastProgressAt = Date.now();
      pausedNotified = false;
      return;
    }

    // 畫面被暫停（不管是誰暫停的：使用者不小心點到、瀏覽器省電機制、廣告插斷等）
    // 一律強制恢復播放，因為這個工具的目的就是持續觀看累積時數/掉寶，暫停對這個目的沒有意義。
    if (video.paused && !video.ended) {
      try {
        video.play().catch(() => {});
      } catch (e) {
        // 忽略，下個週期還會再試一次
      }
      if (!pausedNotified) {
        pausedNotified = true;
        notify(t("watchdogForcedPlay"));
      }
      lastFrameCount = null;
      lastCurrentTime = null;
      lastProgressAt = Date.now();
      return;
    }
    pausedNotified = false;

    if (video.ended || video.readyState < 2) {
      lastFrameCount = null;
      lastCurrentTime = null;
      lastProgressAt = Date.now();
      return;
    }

    // 只要「使用者現在沒有在盯著這個視窗看」就不做重整，只保活。判斷條件有兩個：
    //   1. document.hidden：分頁被切到背景、視窗被最小化、或電腦鎖定螢幕。
    //   2. !document.hasFocus()：視窗雖然沒最小化、分頁也還是作用中（document.hidden 仍為
    //      false），但整個瀏覽器視窗被其他視窗蓋住／失去焦點。這種情況下瀏覽器會為了省資源
    //      停止渲染影格，影格數自然不再增加——這不是畫面壞掉，不能拿來當卡住依據。
    // 過去只擋 document.hidden，漏掉「視窗被蓋住但分頁仍可見」這種，於是誤判卡住而 reload；
    // 而在背景視窗重新整理會讓 Windows 工具列的瀏覽器按鈕閃橘色「請求注意」、把自動隱藏的
    // 工具列喚醒，非常干擾。現在只要視窗沒有焦點就一律不重整，只在被暫停時強制續播保活；
    // 等使用者把視窗切回前景（重新取得焦點）後，若畫面真的壞了，下面的影格偵測才會接手重整。
    // 這裡讀的是「真實」的可見性/焦點狀態——page-keep-active.js 只偽裝頁面 MAIN world 看到的
    // 可見性，讓 Twitch 不要暫停；擴充功能的 content script 跑在隔離環境，讀到的仍是真實值。
    if (document.hidden || !document.hasFocus()) {
      lastFrameCount = null;
      lastCurrentTime = null;
      lastProgressAt = Date.now();
      return;
    }

    const frameCount = getFrameCount(video);
    const hasProgressed =
      frameCount !== null
        ? lastFrameCount === null || frameCount > lastFrameCount
        : lastCurrentTime === null || video.currentTime > lastCurrentTime + 0.5;

    if (hasProgressed) {
      lastFrameCount = frameCount;
      lastCurrentTime = video.currentTime;
      lastProgressAt = Date.now();
      resetBackoff(); // 確認真的有在正常播放，把之前累積的退避冷卻時間歸零
      return;
    }

    const stalledMs = Date.now() - lastProgressAt;
    if (stalledMs >= stallSeconds * 1000) {
      lastProgressAt = Date.now(); // 避免同一次卡住反覆觸發
      if (canRetryNow()) {
        notify(t("watchdogStalledReload", [String(stallSeconds)]));
        location.reload();
      } else {
        if (!gaveUpSent) notify(t("watchdogStalledMaxRetries")); // 只記一次，避免冷卻期間洗版
        giveUpOnChannel();
      }
    }
  }

  setInterval(() => {
    tryClickGateButtons();
    tryClickReloadButtons();
    checkVideoStall();
  }, CHECK_INTERVAL_MS);
})();
