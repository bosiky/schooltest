# 📚 小學測驗小幫手

上傳課本或測驗卷的照片後，AI 會自動辨識題目，並判斷年級和科目。之後可以隨機產生考卷、線上作答或列印紙本，交卷後自動批改，並記錄分數和錯題。

## 功能特點
- **上傳圖檔辨識**：AI（Gemini）自動擷取題目、判斷年級和科目、補上答案與解析，存入題庫前可以先檢查、修改。
- **題庫管理**：可依科目、年級、題型篩選與搜尋，也能手動新增、編輯或刪除題目。
- **隨機出考卷**：可設定題數、科目、年級、單元、題型，並提供三種出題方式：完全隨機／錯題優先／只考錯題。
- **改考卷**：
  - 線上作答，交卷後自動批改（選擇、是非、填充題直接比對；填充與簡答題由 AI 判斷意思是否正確）。
  - 列印紙本考卷，寫完後拍照上傳，AI 會讀出手寫答案並自動批改。
  - 家長可以手動「改判對錯」，分數會自動重新計算。
- **紀錄**：保存歷史考卷、各科平均與成績趨勢、錯題本（記錄答錯次數，最近一次答對就算「已訂正」）。
- **多位學生**：每位學生各自有專屬紀錄，家庭共用免密碼。
- 所有資料都存在資料庫，**伺服器關掉重開後紀錄依然存在**。

---

## 設定檔路徑（.env）
設定檔位於專案根目錄：
- **完整絕對路徑**：
  ```text
  /Users/chentang/Documents/antigravity/schooltest/.env
  ```
- **相對路徑**：`./.env`

> [!NOTE]
> 在 macOS 系統中，以「.」開頭的檔案為隱藏檔。若在 Finder（訪達）中看不到，可按下快速鍵 `Command + Shift + .` 即可顯示隱藏檔。

---

## 如何設定 Supabase 資料庫

1. 前往 [Supabase 官網](https://supabase.com) 註冊/登入（可用 GitHub 帳號快速登入）。
2. 點擊 **New project（新增專案）**：
   - 輸入專案名稱（例如 `schooltest`）。
   - 設定 **Database Password（資料庫密碼）**（**務必記下來**，建議使用純英文與數字，避免特殊符號導致連線字串解析問題）。
   - 選擇離台灣較近的地區（例如 `Singapore` 或 `Tokyo`）。
3. 取得連線字串（Connection String）：
   - 進入專案儀表板後，點擊左下角的 **Project Settings（專案設定）**（齒輪圖示）。
   - 點擊左側選單的 **Database（資料庫）**。
   - 往下捲動找到 **Connection string（連線字串）** 區塊。
   - 切換至 **URI** 標籤頁（或選擇 **Node.js**）。
   - 複製連線字串，格式通常如下：
     ```text
     postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxxxxxxxxxxxxxxxx.supabase.co:5432/postgres
     ```
   - 將其中的 `[YOUR-PASSWORD]` 替換為你在建立專案時設定的真實密碼。
4. 打開 `.env` 檔案，將連線字串貼上到 `DATABASE_URL`：
   ```env
   DATABASE_URL=postgresql://postgres:你的真實密碼@db.xxxxxxxxxxxxxxxxxxxx.supabase.co:5432/postgres
   ```
5. 啟動伺服器：
   ```bash
   npm start
   ```
   系統會在初次連線時**自動建立所有資料表與索引**，首頁右上方會顯示「資料庫模式：雲端 Supabase」。

---

## 取得 Gemini API Key（用於圖片辨識與手寫批改）
1. 前往 [Google AI Studio](https://aistudio.google.com)。
2. 點選 **Get API key（取得 API 金鑰）** → **Create API key（建立 API 金鑰）**。
3. 將金鑰貼入 `.env` 的 `GEMINI_API_KEY=` 後面。

---

## 啟動指令
```bash
npm start
```
以瀏覽器打開：`http://localhost:3000`
