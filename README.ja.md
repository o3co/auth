# auth

> このリポジトリは、auth スタックの 3 層責務分離（[認証・トークン発行](https://github.com/o3co/auth.provider) / [認可判定](https://github.com/o3co/auth.policy-verifier) / [認可実施](https://github.com/o3co/protobuf.interceptors)）をまとめる総合リポで、スタック全体のアーキテクチャドキュメントとクロスコンポーネント E2E テストを提供します。不正／失効トークンの境界での遮断は、3 層の外にある任意のゲート [auth.proxy](https://github.com/o3co/auth.proxy) が担います。

初期段階のプロジェクト向け軽量認証プラットフォーム。

認証 + 認可のスタックがすぐに動く一式。各コンポーネントはスタンドアロンの HTTP サービスとして動作し、要件の成長に合わせて個別にエンタープライズ代替（Keycloak、OPA、Cedar、Envoy 等）へ差し替え可能。アプリケーションコードの変更は不要。

## コンポーネント

| コンポーネント | リポジトリ | 説明 |
| --- | --- | --- |
| auth.provider | [o3co/auth.provider](https://github.com/o3co/auth.provider) | OAuth 2.0 プロバイダー — ログイン、トークン発行、イントロスペクション |
| auth.proxy | [o3co/auth.proxy](https://github.com/o3co/auth.proxy) | トークン検証 + キャッシュ付きリバースプロキシ |
| auth.policy-verifier | [o3co/auth.policy-verifier](https://github.com/o3co/auth.policy-verifier) | DSL 不要の ABAC ポリシー検証器（Collector パターン） |
| protobuf.interceptors | [o3co/protobuf.interceptors](https://github.com/o3co/protobuf.interceptors) | gRPC 認可ミドルウェア (Go) |

### auth.provider

OAuth 2.0 / OIDC プロバイダー。セッションログイン（ローカルのユーザー名/パスワード、WebAuthn パスキー、Google / GitHub フェデレーション）または PKCE 付き認可コードフローから JWT を発行。マシン間・委譲アクセスは client credentials、device authorization grant (RFC 8628)、token exchange (RFC 8693) で、送信者拘束トークンは DPoP (RFC 9449) と mTLS 拘束トークン (RFC 8705) で対応。introspection、revocation、RP-initiated / back-channel logout を備える。モジュラー構成 — 必要なモジュールだけを選択。JWT 署名は EdDSA（既定）, ES256, RS256, HS256 に対応、非対称アルゴリズムでは JWKS エンドポイントを公開。

### auth.proxy（オプション）

トークン検証リバースプロキシ。イントロスペクション結果のキャッシュ機能付き。クライアントとダウンストリームサービスの間に配置する。

このコンポーネントはオプション。auth.policy-verifier と protobuf.interceptors は JWT を直接検証するため、auth.proxy なしでもシステムは動作する。導入するメリット:

- **イントロスペクションベースの検証** — 失効したトークンを即座に検出可能。JWT ローカル検証のみの場合はトークンの有効期限まで検出できない
- **キャッシュ** — イントロスペクション結果をキャッシュ（デフォルト 30 秒 TTL）し、auth.provider への負荷を軽減
- **検証の集約** — ダウンストリームサービスは認証ロジックを実装せずに検証済みリクエストを受け取れる

### auth.policy-verifier

DSL 不要の ABAC ポリシーエンジン。HTTP サービス（`POST /verify`）として動作、またはライブラリとして組み込み可能。認可ロジックは TypeScript の Collector パターンで組み立てる。JWT 検証アルゴリズム設定可能 — HS256, RS256, ES256, EdDSA に対応、JWKS URI または公開鍵直接指定（auth.provider と対称設計）。OPA や Cedar にドロップイン置き換え可能 — `protobuf.interceptors` は3つすべてをバックエンドとしてサポート。

### protobuf.interceptors

gRPC 認可ミドルウェア (Go)。`.proto` のメソッドオプションにアクセスポリシー（リソース + アクション）を宣言し、インターセプターで適用。`protobuf_policy_option`（ポリシー宣言・解決）と `policy_verification`（認可バックエンドへの適用）の2つの独立モジュールで構成。

## マイグレーションパス

各コンポーネントは独立して差し替え可能。protobuf.interceptors は例外 — gRPC サービスと認可バックエンドの橋渡しとして、マイグレーション後も残り続ける。

| コンポーネント | 置き換え先 | 変更箇所 |
| --- | --- | --- |
| auth.provider | [Keycloak](https://www.keycloak.org/), [Ory Hydra](https://www.ory.sh/hydra/), [Logto](https://logto.io/), Auth0 | auth.proxy 設定のイントロスペクションエンドポイント URL |
| auth.proxy | [Envoy](https://www.envoyproxy.io/) ext_authz, [Traefik](https://traefik.io/) ForwardAuth, [Kong](https://konghq.com/) | リバースプロキシの設定。ダウンストリームサービスへの影響なし |
| auth.policy-verifier | [OPA](https://www.openpolicyagent.org/), [Cedar](https://www.cedarpolicy.com/), [Cerbos](https://cerbos.dev/) | protobuf.interceptors のバックエンド: `NewOPAEndpoint()` or `NewCedarAgentEndpoint()` |
| protobuf.interceptors | — | **置き換えない。** バックエンド非依存の設計。auth.policy-verifier、OPA、Cedar、静的ルールをサポート。 |

各コンポーネントの競合詳細は [docs/competitors.ja.md](docs/competitors.ja.md) を参照。

## アーキテクチャ

```text
Client
  |
  |  (1) ログイン / 認可コード
  v
auth.provider ──── Redis (セッション)
  |
  |  (2) JWT アクセストークン
  v
auth.proxy ──────── auth.provider (イントロスペクション)
  |
  |  (3) 検証済みリクエスト
  v
downstream service
  |
  |  (4) POST /verify
  v
auth.policy-verifier (ABAC)
```

gRPC サービスの場合、[protobuf.interceptors](https://github.com/o3co/protobuf.interceptors) がインターセプターを提供し、ポリシー検証器を呼び出す（OPA/Cedar を代替バックエンドとしても利用可能）。

詳細なフローとコンポーネントの説明は [docs/architecture.ja.md](docs/architecture.ja.md) を、auth.provider と auth.policy-verifier の間の claim レベル JWT 契約は [docs/claims-contract.ja.md](docs/claims-contract.ja.md) を参照。

## はじめに

```bash
make setup    # 全コンポーネントのリポジトリをクローン
make build    # 依存関係のインストールとビルド
make test-e2e # サービス起動、E2E テスト実行、後片付け
```

### E2E のリビジョン

`make test-e2e` は各コンポーネントを `Makefile` 冒頭で固定したリビジョン（`PROVIDER_REV`、`PROXY_REV`、`VERIFIER_REV`）でテストする。このピンがテスト済みのベースラインであり、[`e2e`](.github/workflows/e2e.yml) ワークフローのピン通りの実行 — `develop` への push、すべての pull request、既定値のままの手動実行 — がリリースゲートである。ベースラインを動かすとは、pull request でピンを変更し、そこでゲートを通すことである。

ピンを動かすとき（コンポーネントのリリースカット）:

1. 夜間の `e2e-develop` ワークフローがまだ有効で、最新の実行が緑であることを確認する: `gh workflow list --all -R o3co/auth` で状態がわかる。GitHub は public リポジトリで 60 日間活動がないとスケジュール実行のワークフローを無効化し、このリポジトリはコミットの間隔がそれより長く空いたことがある。`gh workflow enable e2e-develop.yml -R o3co/auth` で再び有効にする。夜間実行が赤なら、それは新しいピンが持ち込もうとしている破損である。
2. pull request でピンを変更し、緑になった `e2e` の実行をコミットメッセージに記録する。

別のリビジョンをテストするには、コマンドラインで変数を上書きする。コマンドラインの変数は Makefile の `:=` より優先される:

```bash
make test-e2e PROVIDER_REV=origin/develop  # ブランチ（origin/<branch> と書く）
make test-e2e PROXY_REV=v0.7.0             # タグ
make test-e2e VERIFIER_REV=1e29749         # SHA
```

`make setup` は `git fetch origin` の後に `git checkout --detach <rev>` を実行するので、ブランチは `origin/<branch>` と書く。ブランチ名だけだとローカルブランチにしか解決されず、クローンにローカルブランチがあるのはデフォルトブランチ（クローンした時点のもの）だけである: それ以外のブランチ名は失敗し、デフォルトブランチ名は既存のクローンでは古いままである。取得されるのはコンポーネントのブランチとタグから辿れるコミットだけである。

CI では:

- **上書きを指定した手動実行。** `e2e` ワークフローの *Run workflow* フォームは `provider_rev`、`proxy_rev`、`verifier_rev` を同じ形式で受け取る。空欄はピンのまま。1 つでも上書きした実行はリリースゲートではなく、実行名とチェック名（`test-e2e (overrides, not the release gate)`）がそれを示す。
- **`develop` に対する夜間実行。** [`e2e-develop`](.github/workflows/e2e-develop.yml) は毎日、全コンポーネントを `origin/develop` にして同じスイートを実行する。何もゲートしない。赤は、あるコンポーネントの `develop` がこのスイートを通らなくなったことを意味し、リリース時にピンを上げる前に見つかる。
- **auth.provider から。** auth.provider の `umbrella-e2e` ワークフローは、`develop` 向けの pull request ごとに、このリポジトリの `develop` のスイートを、pull request のコードを `PROVIDER_REV` とし proxy と verifier はピンのままで実行する。ここの `develop` が壊れると、そのチェックが赤になる。

どの実行でも、ジョブサマリーに各コンポーネントをテストしたコミットがピンと並べて記録される。

コンポーネントが受け付けるものを狭める変更（必須の設定キー、より厳しい claim、新しいステータス）は、まずここで受け止める: `tests/` を、固定中のコンポーネントとその変更の両方で通るように更新してから、コンポーネント側の pull request を緑にする。

## ライセンス

Apache License 2.0
