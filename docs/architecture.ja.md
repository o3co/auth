# Auth プラットフォーム アーキテクチャ

## コンポーネント概要

```text
Client
  |
  |  (1) ログイン / 認可コードリクエスト
  v
+-----------------+
| auth.provider   |  OAuth 2.0 プロバイダー (認証 + トークン発行)
+-----------------+
  |
  |  (2) JWT アクセストークン発行
  v
+-----------------+       +------------------------+
|  auth.proxy     |------>| auth.provider          |
| (リバースプロキシ) |       | POST /oauth/introspect |
+-----------------+       +------------------------+
  |  (3) 検証済みリクエスト転送
  v
+-----------------+       +--------------------------+
|  downstream     |       | auth.policy-verifier     |
|    service      |------>| POST /verify (ABAC)      |
+-----------------+       +--------------------------+
```

## コンポーネント

| コンポーネント | 言語 | リポジトリ | 説明 |
| --- | --- | --- | --- |
| auth.provider | Node.js/TS | [o3co/auth.provider](https://github.com/o3co/auth.provider) | OAuth 2.0 プロバイダー: ログイン、トークン発行、イントロスペクション |
| auth.proxy | Node.js/TS | [o3co/auth.proxy](https://github.com/o3co/auth.proxy) | トークン検証 + キャッシュ付きリバースプロキシ |
| auth.policy-verifier | Node.js/TS | [o3co/auth.policy-verifier](https://github.com/o3co/auth.policy-verifier) | DSL 不要の ABAC ポリシー検証器（Collector パターン） |
| grpc.authz | Go | [o3co/grpc.authz](https://github.com/o3co/grpc.authz) | gRPC ポリシー適用インターセプター |

## 認証フロー

1. クライアントが `auth.provider` で認証（セッションログイン、OAuth 認可コード、DID）
2. `auth.provider` が JWT アクセストークンを発行（+ オプションでリフレッシュトークン）
3. クライアントが `Authorization: Bearer <token>` ヘッダー付きで `auth.proxy` にリクエスト送信
4. `auth.proxy` がイントロスペクション（キャッシュ付き）でトークンを検証し、ダウンストリームに転送
5. ダウンストリームサービスが `auth.policy-verifier`（`POST /verify`）を呼び出し、きめ細かな ABAC チェックを実行
6. gRPC サービスの場合、`grpc.authz` インターセプターが `.proto` オプションからポリシーを解決し、検証器を呼び出す

## マイグレーションパス

各コンポーネントはスタンドアロンの HTTP サービスとして動作する。OPA や Cedar へのマイグレーション方法:

- **ポリシー検証器** → `auth.policy-verifier` を OPA または Cedar Agent に置き換え。`grpc.authz` は3つすべてをバックエンドとしてサポート済み
- **認証プロバイダー** → Keycloak、Auth0、または任意の OAuth 2.0 プロバイダーに置き換え。`auth.proxy` はイントロスペクションエンドポイント URL の変更だけでOK
- **認証プロキシ** → 任意のトークン検証リバースプロキシに置き換え（例: Envoy + ext_authz）

アプリケーションコードの変更は不要 — 設定のエンドポイント URL を変えるだけ。

## 設定

すべての Node.js コンポーネントは HOCON 設定（`@o3co/ts.hocon`）と Zod スキーマバリデーションを使用。
環境変数は `${?VAR_NAME}` 構文で設定値をオーバーライド可能。
