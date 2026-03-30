# 競合分析

最終更新: 2026-03-31

各モジュールのポジショニング評価用のリファレンス。Star 数は概算のため定期的に要確認。

## auth.provider

OAuth 2.0 プロバイダー領域。

### 大規模 3 プロジェクト

| プロジェクト | 言語 | ライセンス | Stars | 概要 |
| --- | --- | --- | --- | --- |
| [Keycloak](https://github.com/keycloak/keycloak) | Java (Quarkus) | Apache 2.0 | ~24k | フル機能のエンタープライズ IAM。OAuth 2.0, OIDC, SAML, LDAP/AD フェデレーション。CNCF Incubating。管理 UI 付き。Java SPI で拡張。重量: JVM + PostgreSQL + Infinispan クラスタリング。 |
| [Ory Hydra](https://github.com/ory/hydra) | Go | Apache 2.0 | ~16k | ヘッドレス OAuth 2.0/OIDC サーバー。UI なし、ユーザー管理なし — ログイン/同意アプリは自前で用意。OpenID Foundation 認証済み。Ory エコシステム (Kratos, Oathkeeper, Keto) の一部。単一バイナリ + PostgreSQL。 |
| [Logto](https://github.com/logto-io/logto) | TypeScript | MPL 2.0 | ~19k | 開発者向け OIDC プロバイダー。サインイン UI、多言語 SDK 付き。マルチテナンシー、M2M 認証、webhook。OSS 版に SAML/LDAP なし。Node.js + PostgreSQL。 |

### 中・小規模 3 プロジェクト

| プロジェクト | 言語 | ライセンス | Stars | 概要 |
| --- | --- | --- | --- | --- |
| [Casdoor](https://github.com/casdoor/casdoor) | Go | Apache 2.0 | ~11k | UI ファーストの ID プラットフォーム。OAuth 2.0, OIDC, SAML, CAS, LDAP。200+ ソーシャルログイン。Casbin との認可統合。CJK コミュニティが活発。 |
| [Authelia](https://github.com/authelia/authelia) | Go | Apache 2.0 | ~22k | 認証ポータル/SSO ゲートウェイ（forward-auth パターン）。2FA 内蔵 (TOTP, WebAuthn)。OIDC プロバイダー機能は成長中だが主目的ではない。セルフホスト/ホームラボ SSO 向け。 |
| [Supabase Auth (GoTrue)](https://github.com/supabase/auth) | Go | MIT | ~4k | Supabase スタック用の認証マイクロサービス。JWT ベース、ソーシャル OAuth、マジックリンク、電話/OTP。PostgreSQL RLS 統合が独自。汎用 OIDC プロバイダーではなく Supabase と密結合。 |

### auth.provider のポジション

競争の激しい領域。Keycloak（プロトコル網羅性）や Logto（DX）に対する強い差別化がない。DID 認証グラントとカスタム GrantRegistry 拡張は小さな差別化要素。スタンドアロン製品としてではなく、auth プラットフォームの軽量な統合コンポーネントとしての価値。

---

## auth.proxy

トークン検証 / 認証リバースプロキシ領域。

### 大規模 3 プロジェクト

| プロジェクト | 言語 | ライセンス | Stars | 概要 |
| --- | --- | --- | --- | --- |
| [Envoy](https://github.com/envoyproxy/envoy) (ext_authz) | C++ | Apache 2.0 | ~27k | データプレーンプロキシ。ext_authz フィルターで外部 gRPC/HTTP 認可サービスに委任。認証ロジックもキャッシュも内蔵なし — 完全な柔軟性。CNCF Graduated。サービスメッシュの事実上の標準。 |
| [Kong](https://github.com/Kong/kong) | Lua/Go | Apache 2.0 | ~39k | API ゲートウェイ。JWT プラグインでローカル検証 (HS256/RS256)。OIDC プラグインは Enterprise 限定。OSS のキャッシュは限定的。認証以外のプラグインエコシステムが豊富。 |
| [Traefik](https://github.com/traefik/traefik) | Go | MIT | ~52k | エッジルーター。ForwardAuth ミドルウェアで外部サービスに委任 (HTTP)。キャッシュ内蔵なし。Docker/K8s でサービスを自動検出。OAuth2 Proxy や Authelia と組み合わせて使用されることが多い。 |

### 中・小規模 3 プロジェクト

| プロジェクト | 言語 | ライセンス | Stars | 概要 |
| --- | --- | --- | --- | --- |
| [OAuth2 Proxy](https://github.com/oauth2-proxy/oauth2-proxy) | Go | MIT | ~10k | 単機能 OIDC ログインプロキシ。IdP にリダイレクト、コールバック処理、セッション Cookie 設定。セッションベース (cookie/Redis)。認証のみ — 認可ロジックなし。 |
| [Ory Oathkeeper](https://github.com/ory/oathkeeper) | Go | Apache 2.0 | ~3.3k | authenticator → authorizer → mutator パイプラインの ID/アクセスプロキシ。JWT、イントロスペクション、セッション検証対応。JSON ベースのアクセスルール。開発ペース鈍化（Ory の焦点が Ory Network SaaS に移行中）。 |
| [Pomerium](https://github.com/pomerium/pomerium) | Go | Apache 2.0 | ~4k | ゼロトラスト / BeyondCorp プロキシ。OIDC 認証 + コンテキスト認識ポリシー。gRPC, TCP, WebSocket 対応。デバイスポスチャチェック。内部で Envoy を使用。VPN の置き換えとして設計。 |

### auth.proxy のポジション

auth.proxy は狭いニッチ: イントロスペクションベースのトークン検証 + キャッシュ、auth.provider と密に統合。Big 3 は汎用インフラツールであり、直接の競合ではない。OAuth2 Proxy がコンセプト的に最も近いが、セッションベース（ブラウザフロー）であり、auth.proxy はトークンベース（API フロー）。スタンドアロン製品としてではなく、auth.provider / auth.policy-verifier との統合における価値。

---

## auth.policy-verifier

認可 / ポリシーエンジン領域。

### 大規模 3 プロジェクト

| プロジェクト | 言語 | ライセンス | Stars | 概要 |
| --- | --- | --- | --- | --- |
| [OPA](https://github.com/open-policy-agent/opa) | Go | Apache 2.0 | ~11.5k | 汎用ポリシーエンジン。Rego DSL (Datalog ベース)。サイドカー/ライブラリ/サーバー。CNCF Graduated。K8s admission、Terraform、API 認可等に使用。Rego の学習コストが高い。 |
| [Casbin](https://github.com/casbin/casbin) | Go (多言語) | Apache 2.0 | ~20k | PERM メタモデル。モデルファイル + CSV/DB ポリシーで ACL/RBAC/ABAC を設定。DSL なし — 設定駆動型。ライブラリのみ (casbin-server は別プロジェクト)。最多の多言語サポート。 |
| [Cedar](https://github.com/cedar-policy/cedar) | Rust | Apache 2.0 | ~1.4k | AWS 支援。専用の Cedar ポリシー言語。RBAC+ABAC。ライブラリのみ（スタンドアロンサーバーなし）。Lean 4 による形式検証。高速 (Rust, GC なし)。エコシステムは未成熟、AWS 外での採用は少ない。 |

### 中・小規模 3 プロジェクト

| プロジェクト | 言語 | ライセンス | Stars | 概要 |
| --- | --- | --- | --- | --- |
| [Cerbos](https://github.com/cerbos/cerbos) | Go | Apache 2.0 | ~4.3k | YAML + CEL ポリシー。RBAC+ABAC、リソース中心。スタンドアロンサーバー (PDP)。ポリシーテスト内蔵。GitOps 向き。ReBAC なし。オープンコア (Cerbos Hub は商用)。 |
| [Permify](https://github.com/Permify/permify) | Go | AGPL 3.0 | ~5.8k | Google Zanzibar クローン。ReBAC が主軸、RBAC/ABAC はレイヤー。リレーションシップタプルストレージ。gRPC + REST API。FusionAuth が買収。AGPL ライセンスはエンタープライズで制約。 |
| [OpenFGA](https://github.com/openfga/openfga) | Go | Apache 2.0 | ~4.9k | Google Zanzibar 実装。ReBAC が主軸。JSON ベースのモデル DSL。CNCF Incubating。Okta/Auth0 支援。ABAC 向けの Contextual Tuples は後発で成熟度が低い。 |

### auth.policy-verifier のポジション

「DSL 不要」が OPA (Rego)、Cedar (Cedar 言語)、Cerbos (YAML+CEL) に対する主要な差別化。認可ロジックはポリシー言語ではなく TypeScript の Collector で記述。コンセプト的には Casbin の設定駆動型アプローチに近いが、PERM モデルファイルの代わりに型付き TypeScript を使用。トレードオフ: OPA/Cedar と比べて形式的な推論・監査能力が弱い。Permify と OpenFGA は ReBAC 領域 — アクセス制御モデルが異なり、直接の競合ではない。

---

## grpc.authz

gRPC 認可ミドルウェア領域。

### 大規模 3 プロジェクト（インフラレベル）

| プロジェクト | 言語 | ライセンス | Stars | 概要 |
| --- | --- | --- | --- | --- |
| [Envoy ext_authz](https://github.com/envoyproxy/envoy) (gRPC モード) | C++ | Apache 2.0 | ~27k | プロキシレベルのフィルター。外部 gRPC 認可サービスに委任。ポリシー内蔵なし。認可サーバーが `/package.Service/Method` パスを解析してメソッド単位の判定。CNCF Graduated。 |
| [Istio AuthorizationPolicy](https://github.com/istio/istio) | Go/C++ | Apache 2.0 | ~38k | Kubernetes CRD (YAML)。宣言的 ALLOW/DENY/CUSTOM ルール。パスマッチングで gRPC メソッド単位の認可。Envoy RBAC フィルターに変換。mTLS ID (SPIFFE)。CNCF Graduated。 |
| OPA + gRPC ([opa-envoy-plugin](https://github.com/open-policy-agent/opa-envoy-plugin)) | Go | Apache 2.0 | ~350 | OPA を ext_authz gRPC サーバーとして使用。Rego ポリシーが CheckRequest を評価。protobuf ペイロードのデコード可能（unary のみ）。完全な柔軟性だが Rego が必要。 |

### 中・小規模 3 プロジェクト（ライブラリレベル）

| プロジェクト | 言語 | ライセンス | Stars | 概要 |
| --- | --- | --- | --- | --- |
| [go-grpc-middleware](https://github.com/grpc-ecosystem/go-grpc-middleware) (auth) | Go | Apache 2.0 | ~6.7k | `AuthFunc` フックポイントをインターセプターとして提供。ポリシーなし — 認証ロジックはコードで実装。メソッド単位は `grpc.Method` の手動検査で対応。広く使われている Go gRPC ミドルウェアスイート。 |
| [Connect authn-go](https://github.com/connectrpc/authn-go) | Go | Apache 2.0 | ~89 | Connect RPC 用の HTTP ミドルウェア。AuthFunc パターン。メソッド単位は `Spec.Procedure` で対応。インターセプターで proto カスタムオプションの読み取り可能（DIY パターン）。HTTP ファーストの設計。 |
| [Casbin](https://github.com/casbin/casbin) (gRPC) | Go (多言語) | Apache 2.0 | ~20k | casbin-server を gRPC 認可サービスとして、または envoy-authz を ext_authz バックエンドとして使用。専用 gRPC インターセプターなし。PERM モデルを `Enforce(sub, obj, act)` にマッピング。 |

### grpc.authz のポジション

`.proto` メソッドオプションに認可ポリシーを直接宣言するプロジェクトは他に存在しない。これが grpc.authz の独自アプローチ。Big 3 はインフラレベル（Envoy/Istio/OPA サイドカーが必要）。go-grpc-middleware はフックポイントのみ — ポリシーロジックは自前。Casbin はモデル駆動ポリシーだが gRPC インターセプターなし。grpc.authz は `.proto` での宣言的メソッド単位ポリシー + プラグ可能な検証バックエンドをライブラリレベルで提供するギャップを埋めている。
