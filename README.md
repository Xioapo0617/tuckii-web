# Tuckii 書籤（tuckii-web）

類似 Tuckii 的單頁式網頁書籤管理應用：手機版面優先、卡片式圓角風格，支援 PWA 加入主畫面。
技術：Vite + React + Tailwind CSS + Firebase Authentication（Google 登入）+ Firestore。

## 功能

- Google 登入，每位使用者只能讀寫自己的書籤與分類（資料放在 `users/{uid}/...` 底下，搭配 `firestore.rules`）。
- 上方「一鍵貼上並儲存」按鈕 + 網址輸入框、關鍵字即時搜尋（標題／網址／備註）。
- 自訂分類資料夾卡片：首次登入自動建立「口袋名單、靈感、學習筆記、旅行計畫」，可新增、刪除分類（刪除分類時，裡面的書籤會移到未分類，不會被刪掉）。
- 新增連結時可填標題與備註，並選擇分類。
- iPhone 捷徑支援：開啟 `https://你的網域/?url=<已編碼的網址>` 時，會自動帶入該網址並跳出分類選擇視窗。

## 本地開發

```bash
npm install
npm run dev
```

## Firebase 後台要先做的三件事

Firebase 設定已寫在 `src/firebase.js`（專案 tuckii-bookmark）。部署前請到 Firebase Console 確認：

1. **Authentication** → 登入方式 → 啟用「Google」。
2. **Firestore Database** → 建立資料庫（正式模式），再到「規則」分頁貼上本專案 `firestore.rules` 的內容並發布。
3. **Authentication → 設定 → 已授權網域**：把你的 Vercel 網域（例如 `tuckii-web.vercel.app`）加進授權網域清單，否則正式網域無法登入（localhost 預設已授權）。

## 部署到 Vercel

1. 把本專案推上 GitHub（或在 Vercel 直接匯入這個儲存庫）。
2. Vercel 專案設定：Framework 選 Vite（通常自動偵測），Build Command `npm run build`，Output Directory `dist`。
3. 部署完成後，記得回 Firebase 把 Vercel 網域加入授權網域（見上）。

也可以本地 `npm run build` 後把 `dist/` 拖到 Vercel / Netlify 上部署。

## iPhone 捷徑設定（稍後閱讀）

1. 捷徑 App 新增捷徑，加入動作「取得剪貼簿」（或用「取得所選項目」接收分享表單的網址）。
2. 加入動作「編碼 URL」（把網址做 URL 編碼）。
3. 加入動作「打開 URL」：`https://你的網域/?url=` 後面接上一個步驟編碼後的網址變數。
4. 把捷徑加入主畫面或分享表單，之後在任何 App 看到想存的連結，執行捷徑就會打開 Tuckii 並自動跳出分類選擇視窗。

## PWA 加入主畫面

用手機瀏覽器打開部署好的網址，選「加入主畫面」即可像 App 一樣全螢幕開啟（manifest 與 Service Worker 已由 vite-plugin-pwa 設定好，圖示在 `public/icon-192.png`、`public/icon-512.png`）。
