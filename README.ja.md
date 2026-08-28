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

DID (分散型識別子) 認証対応の OAuth 2.0 プロバイダー。従来のログインフローでも DID ベースの暗号証明でも JWT を発行可能。プラグイン可能な `DidDocumentResolver` インターフェースで任意の DID method (`did:web`, `did:key`, カスタム) に対応。モジュラー構成 — 必要なモジュールだけを選択（DID のみのデプロイではセッション/フェデレーションをスキップ可能）。JWT 署名は HS256, RS256, ES256, EdDSA に対応、非対称アルゴリズムでは JWKS エンドポイントを自動公開。

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

## ライセンス

Apache License 2.0
