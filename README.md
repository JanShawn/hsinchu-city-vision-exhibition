# Hsinchu City Vision Exhibition

1080 × 960 展場觸控互動網站，以新竹景點、美食與主題路線為主要入口，延伸到城市文化與未來願景。

## 資料來源

- 景點、餐飲介紹與基本資訊：交通部觀光署「觀光資訊資料庫 V2.1」官方開放資料，另補入新版新竹市觀光旅遊網獨有的地點；保留原有 ID 與名稱，新增資料依名稱與舊識別碼去重。
- 圖片：從新版市府 API 完整讀取景點與美食分頁，以名稱或舊識別碼對照圖片，再以原始資料圖片作為候選。產生資料時實際請求圖片並確認 `Content-Type` 為 `image/*`，不使用已失效的舊圖片端點；無有效圖片時使用本機備援圖並記錄警告。
- 景點與美食詳情：呈現資料源說明及來源連結；新版新增地點若僅提供失效舊頁網址，改連到新版觀光網站首頁。
- 旅遊推薦：以 API 回傳的真實景點組成舊城、親子藝文與海岸三條策展路線。
- 未來藍圖：四個城市方向可無上限累積選擇，結果保存在同一台展場裝置並即時形成共同願景；每次投票後顯示 2.6 秒確認畫面以避免連續點擊。結果不代表政府政策統計或民調資料。

前端讀取靜態的 `public/tourism.json`，適用 GitHub Pages，不依賴 Nuxt server route。新版市府 API 基底為 `https://hsinchuemap.tw/API/api/hccg/front/travel-guide`，使用 `attractions` 與 `foods` 端點，參數包含 `parentPageID=3`、`locale=zh-TW`、`page`、`per_page`。若 API 回傳失敗，產生器會停止，不覆寫既有資料。

更新資料後，將產生的 JSON 一併提交；部署流程不會自動重新下載資料：

```bash
npm run generate:data
```

## 開發

```bash
npm install
npm run dev
```

## 驗證

```bash
npm run typecheck
npm run generate
```

介面以 1080 × 960 為設計基準，並在其他視窗尺寸中等比例縮放。
