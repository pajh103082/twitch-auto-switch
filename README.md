# Twitch 自動轉台工具

[![Ko-fi 贊助](https://img.shields.io/badge/Ko--fi-贊助支持-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/sagiriben)
![Chrome 擴充功能](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)
![語言](https://img.shields.io/badge/介面-繁體中文%20%7C%20English-555)

幫你掛 Twitch 的 Chrome 擴充功能：**喜歡的實況主一開台就自動切過去；他沒開台時，自動找同遊戲分類裡有開掉寶的頻道來看；掉寶和頻道點數全部自動領。** 開著放背景就好，不用一直盯著畫面。

> English summary is at the [bottom of this page](#english).

---

## ☕ 支持這個專案

這個工具免費、開源，也沒有廣告。如果它幫你省下了盯台、按領取按鈕的時間，歡迎請開發者喝杯咖啡，你的支持是持續維護和更新的動力：

### 👉 [ko-fi.com/sagiriben](https://ko-fi.com/sagiriben)

擴充功能的設定面板最上方也有一顆「☕ 贊助」按鈕。

---

## 功能

- ⭐ **目標實況主上線就自動切台**：每隔一段時間（預設 60 秒）檢查一次，一開台就把分頁切過去。
- 🎮 **離線時自動找掉寶頻道**：目標實況主沒開台時，到你指定的遊戲分類裡，找一個有開掉寶（Drops）的頻道來看。正在看的頻道只要還在直播、掉寶還開著，就不會被白白切走、打斷觀看時數。
- 🎁 **自動領取掉寶與頻道點數**：獎勵可以領的時候自動領走，還會記錄領取紀錄和累計領到的忠誠點數。
- 🔄 **播放器自動修復**：畫面卡住、被暫停、出現「錯誤 #1000」或成人內容確認畫面時，會自動重試、續播或重新整理。同一個頻道一直播不起來，會暫時跳過、改看別台。
- 🌙 **背景掛台也穩定**：視窗被蓋住、最小化或螢幕鎖定時，Twitch 也不會自己暫停。工具不會搶你的視窗焦點，也不會讓 Windows 工具列一直閃。
- 🔔 **桌面通知（可關閉）**：切台、領到獎勵、發生錯誤時跳出系統通知。
- 🔠 **文字大小可調**：設定面板有 5 段文字大小可選，長輩也看得清楚。
- 🌐 **繁體中文 / English**：介面會跟著瀏覽器語言自動切換。

## ⚠️ 使用前請先了解

為了穩定領取獎勵，這個工具會呼叫 Twitch 網頁本身也在用、但**官方沒有公開文件的內部介面**，並通過 Twitch 的反機器人驗證。這類自動化行為**可能違反 [Twitch 服務條款](https://www.twitch.tv/p/en/legal/terms-of-service/)**，Twitch 有可能對帳號採取限制或停權。

**請自行評估風險後再使用，使用本工具造成的任何後果由使用者自行承擔。** 如果你很在意帳號安全，可以在設定裡關掉「領取頻道點數」和「啟用自動領取」，只保留自動轉台功能。

## 安裝方式

1. 到 [Releases 頁面](../../releases/latest) 下載最新的 `twitch-auto-switch-vX.X.X.zip`，**解壓縮**到一個你不會刪掉的資料夾。
   （或按這個頁面上方綠色的 **Code → Download ZIP**，解壓縮後使用。）
2. 打開 Chrome，網址列輸入 `chrome://extensions`。
3. 打開右上角的「**開發人員模式**」。
4. 點「**載入未封裝項目**」，選擇剛剛解壓縮出來、裡面有 `manifest.json` 的那個資料夾。
5. 點瀏覽器右上角的拼圖圖示，把「Twitch 自動轉台工具」釘選到工具列，方便之後打開。

> Edge、Brave 等 Chromium 核心的瀏覽器也可以用同樣方式安裝（需要 Chrome 111 以上或同等版本）。

## 快速上手

1. 先在瀏覽器裡**登入你的 Twitch 帳號**（自動領取需要登入）。
2. 點擴充功能圖示，打開設定面板，在「**設定**」區塊填入：
   - **目標實況主**：你想看的實況主帳號名稱，也就是頻道網址 `twitch.tv/` 後面那段，例如 `twitch.tv/abc123` 就填 `abc123`。
   - **分類 slug**：目標實況主沒開台時要去找掉寶頻道的遊戲分類。打開該遊戲的分類頁，網址 `twitch.tv/directory/category/` 後面那段就是 slug，例如 `twitch.tv/directory/category/valorant` 就填 `valorant`。
3. 按「**儲存設定**」。
4. 按最上方的「**⏸ 已停止（點擊啟動）**」，變成「▶ 執行中」就開始運作了。

剛安裝好時工具是**停止狀態**，不會自己亂動，要按下啟動才會開始。

## 設定說明

| 設定 | 預設值 | 說明 |
|---|---|---|
| 目標實況主 | `lestakorabli` | 優先要看的實況主帳號名稱，請改成你自己的。 |
| 分類 slug | `mir-korabley` | 目標實況主沒開台時要找掉寶頻道的遊戲分類，請改成你自己的。 |
| 掉寶標籤文字 | Drops Enabled、掉寶… | 實況卡片上出現這些文字就當作「有開掉寶」，用逗號分隔。如果你的 Twitch 介面語言比較特別，可以自行加上畫面顯示的文字。 |
| 檢查間隔（秒） | 60 | 多久檢查一次實況主有沒有開台。Chrome 限制最短大約 1 分鐘。 |
| 掉寶條件重新確認間隔（分鐘） | 10 | 正在看備援頻道時，多久重新確認一次掉寶還有沒有開。 |
| 切台時聚焦分頁 | 關 | 切台時要不要把分頁切到前面。背景掛台建議保持關閉。 |
| 接管現有 Twitch 分頁 | 開 | 直接使用你已經開著的 Twitch 分頁，避免多開一個。 |
| 閒置時行為 | 維持現狀 | 找不到任何可看的頻道時，要維持原樣還是回到 Twitch 首頁。 |
| 啟用自動領取 | 開 | 自動領取掉寶獎勵。 |
| 領取按鈕文字 | Claim、領取… | 備援領取方式比對的按鈕文字。 |
| 庫存檢查間隔（分鐘） | 5 | 多久檢查一次掉寶庫存裡有沒有可以領的獎勵。 |
| 領取頻道點數獎勵寶箱 | 開 | 自動領取聊天室的頻道點數（忠誠點數）寶箱。 |
| 啟用自動重新載入 | 開 | 播放器卡住或出錯時自動處理。 |
| 畫面卡住判定秒數 | 45 | 畫面超過幾秒沒有動，才當作真的卡住。 |
| 桌面通知 | 開 | 切台、領獎、錯誤時跳系統通知，勾選後立即生效。 |
| 文字大小 | 中 | 設定面板的字體大小，選了立即生效。 |

## 常見問題

**Q：會不會一直開新的 Twitch 分頁？**
不會。工具只會管理一個分頁，切台時是在同一個分頁換網址。你自己另外開的 Twitch 分頁不會被動到。

**Q：我正在看的頻道會不會一直被重新整理、切來切去？**
不會。只要目前的頻道還在直播、掉寶還開著，工具就不會去動它。只有在目標實況主開台、目前頻道下播，或掉寶被關掉時才會換台。

**Q：顯示「找不到實況主」或「找不到分類」？**
帳號名稱或分類 slug 打錯了。請照著「快速上手」的說明，從網址複製正確的文字。

**Q：顯示「找不到登入憑證」？**
你還沒登入 Twitch，或登入已經過期。請在同一個瀏覽器重新登入 Twitch。

**Q：畫面上明明有可以領的獎勵，卻沒有被自動領走？**
先在 `chrome://extensions` 按擴充功能的重新整理鈕，再按設定面板裡的「立即檢查掉寶庫存」。還是不行的話，請到 [Issues](../../issues) 回報，附上設定面板「活動紀錄」裡顯示的錯誤訊息。

**Q：電腦鎖定螢幕後還會繼續掛台嗎？**
工具會讓 Twitch 以為分頁一直在前景，盡量不讓直播自己暫停。但作業系統如果在鎖定時把瀏覽器整個凍結，就不是擴充功能能控制的了。

**Q：通知太多很吵？**
在「桌面通知」區塊取消勾選就好，立即生效。播放器自動修復這類例行動作本來就不會跳通知，只會寫進活動紀錄。

## 運作原理（給想了解的人）

- **查詢開台狀態**：使用 Twitch 網頁前端本身也在用的公開 GQL 介面。
- **找掉寶頻道**：打開遊戲分類頁，掃描實況卡片上的掉寶標籤（`content-directory.js`）。
- **領取獎勵（主要方式）**：呼叫 Twitch 內部的 GQL 介面查詢、領取掉寶與頻道點數（`content-gql-claim.js`），並在網頁環境中取得 Twitch 反機器人驗證所需的 token（`page-integrity-bridge.js`）。
- **領取獎勵（備援方式）**：主要方式失敗時，改成掃描掉寶庫存頁上的「領取」按鈕並點擊（`content-claim.js`、`content-inventory-claim.js`）。
- **保持播放**：覆寫網頁的可見性狀態，讓 Twitch 不會因為分頁在背景而暫停（`page-keep-active.js`），並監看播放器狀態、自動修復（`content-player-watchdog.js`）。

## 已知限制

- Twitch 改版（換掉內部介面、改變頁面結構或按鈕文字）時，部分功能可能會失效，需要等更新。
- 找掉寶頻道靠的是分類頁上顯示的文字。如果你的介面語言沒有被預設文字涵蓋，請到設定裡自行加上「掉寶標籤文字」。
- 這不是 Twitch 官方工具，請參考上方的「使用前請先了解」。

## 隱私

- 所有設定和紀錄**只存在你自己的瀏覽器裡**，不會上傳到開發者或任何第三方伺服器。
- 你的 Twitch 登入憑證只會在你的瀏覽器裡使用，直接送給 Twitch 官方伺服器，不會送到其他地方。
- 沒有任何分析或追蹤程式碼。

完整內容請看 [隱私權政策](PRIVACY_POLICY.md)。

## 問題回報與建議

遇到 bug 或有功能建議，歡迎到 [Issues](../../issues) 留言。回報問題時，附上設定面板「活動紀錄」裡的訊息會很有幫助。

## 授權

[MIT License](LICENSE)

---

<a id="english"></a>

## English

**Twitch Auto Switch** is a Chrome extension (Manifest V3) for idling on Twitch:

- Automatically switches to your **target streamer** as soon as they go live.
- When they're offline, it finds a **Drops-enabled channel** in the game category you choose and watches that instead, without interrupting a channel that still qualifies.
- **Auto-claims Drops and channel-point bonus chests**, and keeps a claim history with a running total of channel points.
- **Player watchdog**: auto-resumes paused video and clicks through error #1000 and mature-content gates. If the player freezes it reloads the page, and if a channel keeps failing it switches to another one.
- Keeps playing in background or minimized windows, never steals focus, optional desktop notifications, adjustable font size, Traditional Chinese / English UI.

**Install:** download the zip from [Releases](../../releases/latest) and unzip it → open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the folder that contains `manifest.json`. Then log into Twitch, set your target streamer and category slug (the part after `twitch.tv/directory/category/`), save, and press the start button.

**⚠️ Warning:** to claim rewards reliably, this extension calls Twitch's undocumented internal GQL API and passes its anti-bot integrity check. This may violate the [Twitch Terms of Service](https://www.twitch.tv/p/en/legal/terms-of-service/) and could lead to account restrictions. **Use at your own risk.**

**Privacy:** all settings and logs stay in your browser. Your Twitch credentials are only sent to Twitch's own servers. No analytics.

**☕ Support:** if this saves you time, consider buying me a coffee at **[ko-fi.com/sagiriben](https://ko-fi.com/sagiriben)**. Thank you!
