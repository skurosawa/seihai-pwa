# Seihai（思考整理PWA）

「入力 → 整理 → 行動」の3ステップで、思考をサクッと整理する iPhone向けPWA です。  
iPhone（Safari / ホーム画面追加）を主対象に、GitHub Pages で公開しています。

## 🔗 Demo（本番URL）
https://skurosawa.github.io/seihai-pwa/

---

## ✨ 機能
### 入力（Input）
- textarea に入力して **Enterで追加**
- **Shift+Enter** で改行（改行は分割され、複数の思考として追加）
- iOS Safari の入力ズーム対策（font-size: 16px）
- 自動保存（localStorage）

### 整理（Arrange）
- 並び替え（dnd-kit）
- iOS風スワイプ削除（左スワイプでDelete / 深くスワイプで即削除）
- 重複テキストでも壊れない（idで管理）

### 行動（Action）
- 整理された思考から行動案を生成（`model/thought`）

---

## 📱 iPhone（ホーム画面追加）
1. Safariで Demo を開く  
2. 共有ボタン → 「ホーム画面に追加」  
3. ホーム画面から起動（PWAとして動作）

---

## 🧰 技術スタック
- React + TypeScript
- Vite
- PWA: `vite-plugin-pwa`
- DnD: `dnd-kit`
- Deploy: GitHub Pages（GitHub Actions）

---

## 🚀 開発（ローカル）
### 1) 依存関係
```bash
npm install
2) 開発サーバ
npm run dev
3) ビルド（dist生成）
npm run build
4) プレビュー
npm run preview
🌍 デプロイ（GitHub Pages）
このリポジトリは GitHub Actions で自動デプロイします。
更新手順
git add -A
git commit -m "feat: update"
git push origin main
push すると GitHub Actions が走り、dist/ が GitHub Pages にデプロイされます。
⚠️ 更新が反映されないとき（PWA / Service Worker）
PWA はキャッシュの影響で「更新したのに古いまま」に見えることがあります。
まず試す
プライベートウィンドウで開く（最速）
もしくは通常画面でリロード
Mac（Safari / Chrome）
DevTools → Application → Service Worker → Unregister
もしくは Clear site data
iPhone（Safari / ホーム画面）
ホーム画面のSeihaiを完全に終了
Safariで Demo URL を開き直す
だめなら：設定 → Safari → 詳細 → Webサイトデータ → skurosawa.github.io を削除
📁 主要ファイル
src/App.tsx：画面全体（入力 / 整理 / 行動）
src/model/thought.ts：splitThoughts / generateAction など思考ロジック
vite.config.ts：GitHub Pages 用の base: "/seihai-pwa/" 設定、PWA設定
📝 今後のTODO（候補）
ActionView：コピー / 共有ボタン（Markdown出力）
Undo（削除取り消し）
履歴（複数メモ）
UI微調整（iOS感アップ）
ダークモード
License
TBD