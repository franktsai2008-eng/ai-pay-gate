# HANDOFF — AI 付款安全閘門（2026-10-18 01:45 更新）

## 給新 session：先讀這段

**期限：HackHarvard Devpost 今天（10/18）早上 8:00 ET 交件。** Frank 一次回答了 25 題（SPEC.md 第十四章）：分工是 Claude 寫後端、隊友寫前端和 Claude 連接（MCP）；全部模擬、不上鏈；比賽作品。

**後端 v0 已經寫好、測過、推上去了。** repo：https://github.com/franktsai2008-eng/ai-pay-gate （私有，main 分支，後端在 `backend/`）。
- 跑：`cd backend && npm install && npm run dev` → http://localhost:8787/api/v1/health
- 測：`npm test`（4 組，全過：三燈示範、AI 不能自己同意、按兩下只付一次、暫停、分數 82 等級 3）
- 型別：`npx tsc --noEmit`
- API 合約＝`BACKEND-PLAN-for-team.md`（英文，給隊友）。改 API 一定同步改這份。
- 產品真相＝`SPEC.md`（中文）。

**程式結構**：`src/types.ts` 型別；`src/store.ts` 記憶體狀態＋JSON 快照（DATA_DIR）＋事件；`src/seed.ts` 示範資料（Mia、3 個賣家、騙子繞圈、20 筆舊交易）；`src/engine.ts` 閘門六道檢查＋燈號、執行（同步，不能加 await，靠單執行緒保證原子性）、同意、暫停、訂單、示範賣家交貨、驗收流程、信用公式、每秒 tick；`src/judge.ts` Claude 驗收（claude-opus-5-5、effort low、messages.parse＋zodOutputFormat；這代模型不能強制 tool_choice）；`src/routes.ts` 所有 API；`src/server.ts` 啟動。

**環境變數（部署時要設）**：ADMIN_KEY、DEMO_PASSCODE（登入用）、OWNER_TOKEN、AGENT_TOKEN（覆蓋文件裡公開的預設值）、ANTHROPIC_API_KEY（Frank 的；沒設就只做格式檢查）、PORT、DATA_DIR。

**接下來（照順序）**
1. 部署：等 Frank 選（筆電＋cloudflared 臨時網址／Railway 要他 `railway login`／Render 免費會睡）。部署是硬閘門，他說了才做。部署後把網址、示範密碼給 Frank 轉隊友。
2. 備案「會上當的 AI」（15A）：`backend/scripts/naive-agent.ts`，用 claude-haiku-5-5 加一組呼叫 /agent/* 的工具；它不上當就改成寫死的腳本（先找商品、再付給騙子說明裡的地址）。
3. 隊友整合時的修正：只改後端，API 形狀以 BACKEND-PLAN-for-team.md 為準。
4. 隊友的 MCP 來不及的話，Claude 可以寫（約 20 分鐘），但要 Frank 說。
5. 上台前：`POST /api/v1/admin/reset`；確認三步燈號；錄備用影片。

**合併**：隊友的前端另外做，之後再 merge。建議前端放 `frontend/` 或另一個分支，後端留在 `backend/`，兩邊不改同一個資料夾就不會衝突。

---


## 現在在哪
還沒寫任何程式。Frank 指示：「先不要寫後端，等我確認改好再來做」。目前全部是設計和邏輯，用三個 artifact 呈現，給 Frank 確認。

## 最新、最完整的一份
SPEC.md（同資料夾）：所有要做的東西，用正常上下文寫法整理成一份，人和 AI 都讀得懂。Frank 讀完確認後，才開始寫程式。下面三個 artifact 是之前的圖，內容以 SPEC.md 為準。

## 三個 artifact（新 session 先看最上面那個）
1. 一頁看懂（全圖、30–60 秒讀完）：https://claude.ai/artifact/1bn7WmUJcA1vFyVV5qD8nZ 。本機檔在舊 session 的 scratchpad：`ai-pay-gate-onepager.html`。要改請用 Artifact read 拿回來，同一個 URL 重發。
2. 前後端對照（每個畫面、每個按鈕 → 後端功能 → 後端做什麼，第一批／第二批／不做，權限總表）：https://claude.ai/artifact/GmciLGLEDSTMbTELyicDAC
3. 邏輯總圖（為什麼這樣設計：付款流程、六道檢查、燈號、指令來源、防重複付款、交易後、信用分數細節＋4 張照比例的圖、身分、錢包、demo、MVP 範圍、安全）：https://claude.ai/artifact/Lx9d6oB23q28oEzAbDxnb2

## 檔案
- PLAN-en-v3-2026-10-17.md：英文產品企劃（給隊友）。還沒同步以下決定。
- BACKEND-en-v1-2026-10-17.md：英文後端設計。還沒同步兩輪評審的修改（都在 artifact 2、3 裡）。
- PLAN-zh-2026-10-17.md：中文 v1，已過時。

## Frank 拍板過的
- 定位：AI 幫人付錢，主打安全；市場只是用途之一。
- 交貨證據因子：加（經過我們 1、下載連結當場存證 0.7、其他 0，只管加分）。
- 實體商品：這版不做，寫成未來可以做。
- MVP：「儘可能多做，不必要的不放」。報告講完整概念。
- 流程：先把前後端邏輯對起來（從畫面講到後端），UI/UX 之後再設計；接著一起設計前端。
- 要最簡化：全用圖、很少字，30–60 秒讀完還知道每個細節。

## 還沒拍板
**現行清單在 SPEC.md 第十四章（25 題，Frank 會一次回答「1A 2B…」）。** 下面是舊的紀錄，以 SPEC 為準。

### 舊紀錄（我的建議都是 A）
- 前後端對照的兩題：1 第一批／第二批切法照現在；2 前端從主人 App 開始一個畫面一個畫面過。
- 風險三題：1 信用和風險分成兩個分數；2 封號只看自己做的事＋仲裁確認同一夥（不自動封）；3 風險只在報告講（但 Frank 後來說儘可能多做，前後端對照已把風險放第二批）。
- 綠燈那筆要不要真的上測試鏈：前後端對照把它放第一批。

## 否決過、不要再提的
- 用「防量子」當賣點（論點不成立）。
- Demo 第 5 步用假的「外人看不出付給誰」畫面（區塊鏈瀏覽器會拆穿）。
- 騙 $50 的情境（會被單筆上限擋，證明不了指令來源）→ 改騙 $3。
- 種 20 筆 Mia 跟同一個賣家的舊交易讓第 2 步變綠（1/k 會把 +0.02 壓成 0.0008）→ 改成把賣家放進 Mia 的名單。
- 驗收通過馬上放款（驗收 AI 也會被騙）→ 只記錄，申訴期滿才放款。

## Frank 這次講過的偏好
- 回覆要短、白話、少術語；用中文；喜歡圖。
- 他會說「列出來，我要看你的理解有沒有跟我一樣」：先把理解攤開給他對。
- 每份東西要能快速看完，但細節不能少。

## 下一步第一個動作
問 Frank 一頁看懂有沒有要改；確認後照「前端從主人 App 開始」一個畫面一個畫面一起過邏輯（還不是 UI）。全部確認後，再同步 PLAN v3 和 BACKEND md，最後才寫程式（TypeScript、Base Sepolia、USDC、MCP）。

## 給評審 subagent 的提醒
2026-10-17 晚有一輪評審跑了 29 分鐘。之後的評審要限縮範圍、給明確的輸出上限。
