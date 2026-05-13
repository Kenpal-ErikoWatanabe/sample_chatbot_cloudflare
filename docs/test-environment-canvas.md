# テスト環境情報

次のページを開き、チャットが表示されること、質問を送って回答が返ることを確認してください。

## アクセス情報

**テスト用ページ（STUDIO）**  
https://cyan343320.studio.site

**STUDIO 閲覧パスワード**  
gC3rOFz5Kp12m6EQvecnfYlbh

---

## エンドポイント・設定（開発・運用）

| 項目 | 値・備考 |
|------|-----------|
| **目的** | STUDIO 埋め込みでのチャット動作確認（テスト） |
| **親ページ（STUDIO）** | https://cyan343320.studio.site |
| **チャット画面（Cloudflare Pages）** | https://kenpal-chatbot-frontend.pages.dev |
| **API（chat Worker）ベース URL** | https://kenpal-chatbot-worker.watanabe-1f7.workers.dev |
| **チャット API** | `POST /api/chat`（プリフライト: `OPTIONS`） |
| **フロントの API 設定（`VITE_API_URL`）** | **Cloudflare Pages** ではプロジェクトの環境変数、**手元の開発**では `frontend/.env.local` に記載。 |
| **Wrangler 名（Worker）** | `kenpal-chatbot-worker`（`workers/chat/wrangler.jsonc` の `name`） |
| **AI Search インスタンス** | `kenpal-chatbot-search`（バインディング `AI_SEARCH`） |
| **R2 バケット** | `kenpal-chatbot` |
| **動作上の注意** | CORS は Worker 側で許可オリジンを制御している（本番ドメイン、`*.kenpal-chatbot-frontend.pages.dev`、ローカルホスト等）。iframe 利用時は Pages の `public/_headers` の `Content-Security-Policy: frame-ancestors` に親オリジン（例: `https://*.studio.site`）が含まれるビルドをデプロイしている。現状会話履歴はブラウザメモリのみで、iframe の再読み込み等で消える。 |

### トラブル時の確認ポイント（開発）

表示されない・エラーが出るなど問題があるときは、開発担当へ連絡してください。
