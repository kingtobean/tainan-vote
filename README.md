# 臺南市議員第十一選區選舉｜即時計票

單場活動用的即時計票網站。公開頁依照票數自動排序；管理員登入後可即時加票、減票或直接修正總票數。專案不使用前端第三方依賴，可以直接部署為靜態網站。

## 正式環境

- 公開計票頁：<https://tainan-vote.pages.dev/>
- 管理後台：<https://tainan-vote.pages.dev/admin.html>
- 靜態網站：Cloudflare Pages
- 資料庫：Supabase `Southeast Asia (Singapore)`

GitHub `main` 分支更新後會由 Cloudflare Pages 自動重新建置與部署。

## 目前功能

- 公開頁顯示排名、號次、照片、姓名及即時票數
- 號次使用與照片同高的大字呈現，排序與號次清楚分開
- 同票時依號次排序，排行變動時平滑換位
- 管理員登入、加票、減票、直接修正總票數
- 後台可逐位標記「當選」，最多 6 位；公開頁立即顯示當選標記
- 操作記錄保存修改前後票數、操作時間及管理員
- 本機預覽模式不需要資料庫，可先完整測試流程
- 設定 Supabase 後切換為跨裝置正式同步
- 支援桌機、手機及活動現場大螢幕

## 本機預覽

在專案根目錄執行：

```powershell
python -m http.server 4173 --directory public
```

開啟：

- 公開頁：<http://localhost:4173/>
- 管理後台：<http://localhost:4173/admin.html>

未填寫 Supabase 設定時，後台會顯示「進入預覽後台」。預覽票數保存在瀏覽器 `localStorage`，可用兩個分頁同時測試即時換位。預覽頁的初始票數僅供版面及流程測試，頁面會清楚標示「非正式票數」。

已設定正式資料庫時，仍可使用 `?demo=1` 強制進入本機預覽模式，例如 `http://localhost:4173/?demo=1`；正式公開頁請使用不帶參數的網址。

## 啟用正式資料庫

1. 建立 Supabase 專案。
2. 在 SQL Editor 依序執行 `supabase/schema.sql` 與 `supabase/seed.sql`。
3. 在 Authentication > Users 建立管理員電子郵件與密碼。
4. 修改 `supabase/bootstrap-admin.sql` 的電子郵件，然後在 SQL Editor 執行一次。
5. 將 Supabase Project URL 與 `anon public` key 填入 `public/js/config.js` 的 `supabaseUrl`、`supabaseAnonKey`。
6. 重新開啟後台並使用管理員帳密登入。

`anon public` key 本來就設計為公開於前端；資料修改權限由資料庫函式與 RLS 控制。絕對不要將 `service_role` key 放入前端。

若已經執行過尚未包含「當選」功能的舊版資料庫，只需再執行 `supabase/migrations/001-elected-status.sql`。

公開頁每 2 秒向 Supabase 同步一次，符合約 100 人短時活動的用量。若活動不能中斷，建議活動當月啟用 Supabase Pro，以取得每日備份及避免免費專案因閒置暫停。

## 部署到 Cloudflare Pages

使用 Git 整合或 Direct Upload 時：

- Framework preset：`None`
- Build command：留空
- Build output directory：`public`

`public/_headers` 已包含 CSP、安全性標頭與靜態資源快取規則。部署後可使用 `*.pages.dev` 網址，不需要另外準備伺服器；需要正式網域時再將網域綁定到 Cloudflare Pages。

若觀眾主要在中國大陸，Cloudflare 與 Supabase 的連線穩定度可能不足，應改用中國境內雲資源並處理 ICP 備案。

## 驗收項目

1. 後台加票後，公開頁在數秒內更新並重新排序。
2. 同票候選人依號次排序。
3. 快速重複點擊不會重複加票；單次調整上限與票數下限有效。
4. 後台操作會出現在「最近操作」。
5. 手機、1440px、1920px 及活動大螢幕無水平溢出。
6. 頁尾 `margin-top` 為 `0px`，且與前一個區塊直接銜接。
7. 後台第 7 位當選標記會被拒絕，公開頁最多顯示 6 個「當選」標記。
8. 號次字級至少為照片高度的 65%，且不與排序標籤混淆。

可用 Edge 執行自動冒煙測試並輸出桌面、手機與後台截圖：

```powershell
node scripts/smoke-test.mjs
```

測試會驗證 9 位候選人、圖片載入、水平溢出、左邊界、頁尾貼合、後台計票及公開頁重新排序。

## 目錄

```text
public/
  index.html          公開計票頁
  admin.html          管理後台
  styles.css          全站樣式與響應式版面
  js/config.js        Supabase 與活動設定
  js/api.js           本機及 Supabase 資料層
  js/public-page.js   公開頁同步與排行動畫
  js/admin-page.js    登入、計票及操作記錄
  assets/candidates/  已裁切及壓縮的候選人照片
supabase/
  schema.sql          資料表、RLS、計票函式
  seed.sql            9 位候選人資料
  bootstrap-admin.sql 管理員授權步驟
  migrations/         既有專案升級 SQL
source-assets/
  candidates/original 原始照片，不參與部署
```
