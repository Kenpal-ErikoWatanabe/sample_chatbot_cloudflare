# kenpal-chatbot

[Kenpal コーポレートサイト](https://www.kenpalinc.com)の掲載情報のみを根拠に回答するチャットボット。Cloudflare Pages（UI）+ Cloudflare Workers（API）+ Cloudflare AI Search + R2 で構成し、STUDIO などに iframe で埋め込む想定。

## 技術スタック

- Bun
- React 19 + Vite + Tailwind CSS 4（`frontend/`）
- TypeScript
- Cloudflare Workers（`workers/chat/`）
- Cloudflare R2、Cloudflare AI Search
- Playwright（`scripts/` によるサイトクロール）

## リポジトリ構成

| パス | 内容 |
|------|------|
| `frontend/` | チャット UI（Cloudflare Pages 向けビルド） |
| `workers/chat/` | `POST /api/chat`（AI Search 呼び出し） |
| `workers/crawler/` | 日次クロール用 Worker（利用する場合） |
| `scripts/` | ローカル / CI 用のクロール等 |

## コマンド

**frontend**

```bash
cd frontend
bun install
bun run dev          # 開発
bun run build        # ビルド（`dist/`）
bunx wrangler pages deploy dist   # Pages デプロイ
```

**chat Worker**

```bash
cd workers/chat
bunx wrangler dev
bunx wrangler deploy
```

**クロール（ルート `package.json`）**

```bash
bun run scripts/crawl.ts
```

## 環境変数（フロント）

| 変数 | 説明 |
|------|------|
| `VITE_API_URL` | chat Worker のオリジン（末尾スラッシュなし）。例: `https://kenpal-chatbot-worker.watanabe-1f7.workers.dev` |

ローカルでは `frontend/.env.local` に設定する。Pages ではプロジェクトの Environment variables（Production / Preview）で設定する。

## テスト環境の確認

動作確認や Canvas にそのまま貼れるよう、現プロジェクトで参照しているエンドポイントを整理した。**Pages のプレビュー URL はデプロイのたびにハッシュが変わる**ため、確実な最新 URL は Cloudflare Pages の該当デプロイ、または STUDIO 側の iframe `src` で確認すること。

| 項目 | 値・備考 |
|------|-----------|
| **目的** | STUDIO 埋め込みでのチャット動作確認（テスト） |
| **親ページ（STUDIO）** | https://cyan343320.studio.site |
| **チャット UI（Cloudflare Pages）** | プレビュー: `https://<デプロイハッシュ>.kenpal-chatbot-frontend.pages.dev` 形式。Git 連携時は `https://<ブランチ名>.kenpal-chatbot-frontend.pages.dev` も利用可。**iframe の `src` に実際に指定している URL と一致させる。** |
| **API（chat Worker）ベース URL** | https://kenpal-chatbot-worker.watanabe-1f7.workers.dev |
| **チャット API** | `POST /api/chat`（プリフライト: `OPTIONS`） |
| **フロントの API 設定** | Pages ビルド時、`VITE_API_URL` が上記 Worker のオリジン（`/api/chat` を付ける前のベース）になっていること。ローカル開発の例は `frontend/.env.local` を参照。 |
| **Wrangler 名（Worker）** | `kenpal-chatbot-worker`（`workers/chat/wrangler.jsonc` の `name`） |
| **AI Search インスタンス** | `kenpal-chatbot-search`（バインディング `AI_SEARCH`） |
| **R2 バケット** | `kenpal-chatbot` |
| **動作上の注意** | CORS は Worker 側で許可オリジンを制御している（本番ドメイン、`*.kenpal-chatbot-frontend.pages.dev`、ローカルホスト等）。iframe 利用時は Pages の `public/_headers` の `Content-Security-Policy: frame-ancestors` に親オリジン（例: `https://*.studio.site`）が含まれるビルドをデプロイすること。会話履歴はブラウザメモリのみで、iframe の再読み込み等で消える。 |

### トラブル時の確認ポイント

- ブラウザの開発者ツール **Console / Network**: `CORS`、`POST /api/chat` のステータス（503 時は AI Search 側の障害やバインディングも疑う）。
- **別の Pages プレビュー URL** に差し替えた場合、iframe の `src` と `VITE_API_URL`（そのデプロイの環境変数）が意図どおりか。

## 製品ルール（要約）

- 回答はサイト掲載情報のみを根拠とする。
- 該当情報がない場合は「その情報は持ち合わせておりません」など定義済みの文言で返す。
- API エラー時は問い合わせフォームへの誘導メッセージを表示する。