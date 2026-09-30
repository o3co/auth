# Provider ↔ Verifier Claims Contract（クレーム契約）

[auth.provider](https://github.com/o3co/auth.provider) と [auth.policy-verifier](https://github.com/o3co/auth.policy-verifier) の間の JWT 契約には 2 つの半面がある。**署名の半面** — アルゴリズムと鍵配布の対称性（HS256/RS256/ES256/EdDSA、共有 secret または JWKS URI）— はデプロイ設定であり、各 repo の README に記載されている。本文書は **claim の半面** を記録する: どの claim が境界を越えるか、誰が書き、誰が読み、それぞれの側で何を意味するか。

各 repo の語彙はその repo の内側でのみ絶対である: provider は OAuth/OIDC 語彙（RFC 準拠）で claim を書き、verifier は自身のエッジでそれを自らの ABAC attribute 語彙へ翻訳する。下の表はその対応関係である。両 repo と本 repo の E2E スイートに散在する既存のマッピングコメントを集約した **索引** であり、第二の真実の源ではない。表と引用先コードが食い違う場合はコードとテストが勝ち、この表がドリフトしている。

## 境界オブジェクト

RFC 9068 JWT access token。provider は `generateToken`（auth.provider の `packages/core/src/grants/token.mts`）で claim を組み立て、auth.provider の `packages/oauth/src/grants/` 配下の各 grant で刻印する。verifier は `tokenAuthenticator`（auth.policy-verifier の `packages/server/src/jwt/`）で token を認証し、built-in collector（同 repo の `packages/builtins`）が検証済み claim を ABAC attribute（auth.policy-verifier の `packages/core/src/keys.mts` の `ATTR_*` キー）へ翻訳する。

以下の表の path 規約: *Provider が書く* 列の path は [o3co/auth.provider](https://github.com/o3co/auth.provider)、*Verifier が読む* 列は [o3co/auth.policy-verifier](https://github.com/o3co/auth.policy-verifier)、`tests/…` は本 repo からの相対 path。

## 境界を越える claim

| Claim | Provider が書く | Verifier が読む | 境界での意味 |
| --- | --- | --- | --- |
| `scope` | 空白区切り文字列（RFC 6749 §3.3）。何も付与されない場合は完全に省略 — `""` にも配列にもしない（`oauth/src/grants/authorization.mts` の CP-12）。上限: client 登録の `allowedScopes`。 | `PayloadScopeCollector` が空白で分割 → `ATTR_SCOPES`。続いて `ResourceActionScopeRuleCollector` が `/verify` リクエストから導出した `{action}:{resourceType}` scope を要求する。 | capability の上限 — セッションが **要求できるもの** であって付与されたものではない（collector の doc comment と [auth.provider#56](https://github.com/o3co/auth.provider/issues/56) 参照）。scope 値の *内部文法* は verifier が所有し、provider は文字列を不透明に比較するだけ。 |
| `sub` | セッションストア由来の user id — session id ではない（`oauth/src/grants/authorization.mts`）。 | `PayloadSubjectIdCollector` → `ATTR_USER_ID`。`/verify` は wire の `subject` として反響する。 | identity はスタックを通して不変に伝わる。 |
| `azp` | *認証済み* client id であり、body 生の `client_id` ではない（`oauth/src/grants/authorization.mts` の D-6）。 | `PayloadSubjectIdCollector` → `ATTR_CLIENT_ID`。 | token がどの client 経由で発行されたか。 |
| `aud` | RFC 8707 `resource` パラメータを audience として反響。refresh でパラメータが繰り返されなければ落ちる（§2.2）。 | jose 検証でピン — `oauth.jwt.audience` / `OAUTH_JWT_AUDIENCE`。 | token の宛先 resource server。E2E 値 `https://api.e2e.test` が `tests/provider/clients.yaml`（`allowedAudiences`）**と** verifier の env の両方に現れるのはこのため。 |
| `iss` | デプロイ設定の issuer。必須、リクエスト由来にしない。 | jose 検証でピン — `oauth.jwt.issuer` / `OAUTH_JWT_ISSUER`。 | デプロイの identity。 |
| `typ`（header） | access token は `at+jwt`（RFC 9068）、refresh token は `rt+jwt`、ID token（wire 名 `id_token`）は auth.provider v0.10.0 以降は標準の `JWT`（それ以前は非標準の `id+jwt` で、`typ` を厳格に検証する外部 RP に弾かれていた）。auth.provider#402（2026-08-30）で移行期間は終了し、現在は `JWT` のみを受理する。 | `oauth.jwt.tokenType`、default `at+jwt`。比較時に `application/` prefix は無視。 | 3 種の token を区別する **唯一の** 判別子 — このピンが、同じ鍵で署名された refresh / id token が `/verify` を通ることを防いでいる。防いでいる実体は **`at+jwt` と互いに素であること** であり、`JWT` は `id+jwt` と同様にこれを満たす。claim レベルの代替チェックは存在しない。 |
| `exp` / `iat` | 常に刻印（`core/src/grants/token.mts`）。 | 両方必須（`tokenAuthenticator` の必須 claim チェック + 常設の `maxTokenAgeSeconds` 上限）。`exp` のない token は永続 credential として拒否。 | 寿命。verifier は issuer の規律を信頼せず、issuer の `exp` をさらに上限で抑える。 |

## 境界を越えない claim

結合が「想定で発生する」ことを防ぐために記録する:

| Claim | 状態 |
| --- | --- |
| `jti` | 全 token に刻印（`core/src/grants/token.mts`）、provider 側の replay 検出に使用。verifier は一切読まない。 |
| `groups` | scope ゲート付き claim filter（`core/src/grants/claimFilter.mts`、`groups` scope）経由で userinfo / id_token にのみ到達 — access token には **入らない**。verifier の group 系 attribute は `/verify` リクエストの `context` から `RequestContextAttributeCollector` 経由で来る: 別チャネル・別信頼境界（呼び出し元供給の body であり、検証済み token ではない）。 |

## 委任トークン

委任 grant（[auth.provider#861](https://github.com/o3co/auth.provider/issues/861)）は、client が subject のために、ある range の中で動く token を発行する。provider はまだこれらの claim を書かないが、verifier はすでに読むため、この節は provider の委任パッケージが実装する契約である。上の表と違い、両側のコードに対する索引ではない: provider 側が存在するまでは、その側を記述する場所はこの節である。

| Claim | Provider が書く | Verifier が読む | 境界での意味 |
| --- | --- | --- | --- |
| `act` | `act.sub` = 動いている client（RFC 8693 §4.1）。`sub` は subject のまま。 | 名前では読まない: actor を名指すポリシーのために、デプロイが `PayloadClaimAttributeCollector`（`{ from = "act.sub", to = "actorId" }`）で `act.sub` を昇格する。 | 誰のために、誰が動いているか。 |
| `authorization_details` | 委任パッケージの 1 つの type の RFC 9396 エントリ。各 `{ "type": <その type>, "path": "<パス>" }` で、token が動ける range。 | `DelegationRangeCollector` → `ATTR_DELEGATION_RANGE`（builtins 自身のキー）。`DelegationRangeRuleCollector` は、token が range を持つとき、リクエストのパス `<resource>.<action>` について `WithinDelegationRange` を生成する。range を持つとは、その type のエントリがあるか、claim が別の形（エントリのオブジェクトのリストでない）で存在することで、後者は何も含まない range である。両者には同じ `type` を設定する。 | 委任 token は range **と** ポリシーの両方が許すものだけを許される。その type のエントリを持たない token はポリシーだけで判定される。 |

**パスの文法。** パスは `(type(:id)?.)*action`:

- `type` と `action` は `[a-z][a-z0-9_]*`;
- `id` は `[A-Za-z0-9_~-]` で、それ以外の文字は **大文字** の 16 進でパーセントエンコードする。id は書かれたとおりに比較されるので、`%41` と `A` は別の id である: issuer とリソースは同じようにエンコードすること;
- 最後の要素は action で、id を持たない。エントリでは、range が止まる type でもよい（`project:p1.report`）。エントリは `type:id` で終われないので、`project:p1` の下のすべてにわたる range は、その下にあるものを名指す。

**包含。** エントリがパスのセグメント単位の接頭辞であるとき、エントリはパスを含む: エントリの各要素はパスの要素と同じ type を持ち、id を名指さないエントリの要素は、同じ type の任意の id を含む。何も正規化しない — 両側を書かれたとおりに比較する — ので、文法外の側は何も含まず、何にも含まれない。provider は、pull が grant の range を狭めるときと、子 grant の range が親の range の中にあるべきときに同じルールを適用し、verifier は各リクエストに適用する。エントリの最後の要素は、action を名指すときも type として比較されるので、`a:1.run` は `a:1.run.more` を含む: action の名前と type の名前は分けること。verifier のリクエストのパスは、リクエストのリソース、次に action である。リソースはデプロイが設定したリソースパーサーにかかわらず呼び出し元が送った文字列で、その親の連鎖は呼び出し元の主張である: 連鎖に依拠するポリシーを持つデプロイは、自身のストアでそれを確かめる。action は文法上の 1 つの action でなければならない。複数の要素からなる action（`report.delete`）は結合したパスの区切りを変え、親へのリクエストを子へのリクエストとして読んでしまうからである。

両側が従うベクタ（`auth.policy-verifier` の `packages/builtins/src/__tests__/delegation/range.test.mts` がピンする）:

| エントリ | パス | 含む |
| --- | --- | --- |
| `a:1.b` | `a:1.b:2.c:3.run` | はい |
| `a:1.b` | `a:1.b.run` | はい |
| `a.run` | `a:1.run` | はい |
| `a:1.run` | `a:1.run.more` | はい — 接頭辞はその下にあるものを含む |
| `a:1.b:2.run` | `a:1.b:3.run` | いいえ |
| `a:1.run` | `a.run` | いいえ — id を名指すエントリは、id を名指さないパスを含まない |
| `a:1.b.c.run` | `a:1.b.run` | いいえ — パスより長いエントリ |
| `a:1.run` | `a:1.read` | いいえ |
| `doc:x%2Fy.read` | `doc:x/y.read` | いいえ — `/` は文法外。エンコードは id の一部 |
| `a:%41.run` | `a:A.run` | いいえ — id は書かれたとおりに比較される |

**未決、provider のパッケージが決めるもの:** `authorization_details` の type の値。verifier はそれを設定（`type`）として受け取り、既定値を持たないので、自分からは制約を加えない。

## 実行可能な行

いくつかの行は本 repo のテストでピンされている — 行を弱める前に読むこと:

- `typ` 判別: `tests/token-flow/index.test.js` が 3 つの header 全てをピン。`tests/abac/index.test.js`（"only access tokens are decision inputs"）は id_token と refresh token を `/verify` に提示して拒否を要求する。「なにかの 4xx」に弱めないこと。
- `scope` は文字列であり配列ではない: `tests/token-flow/index.test.js` — "a `scopes` array would silently authorize nothing"（[o3co/auth#3](https://github.com/o3co/auth/issues/3) が指摘したドリフト）。
- RFC 8707 `resource` パラメータ経由の `aud`: `tests/token-flow/index.test.js` + `tests/provider/clients.yaml`（`allowedAudiences`）。
- `sub` の不変伝搬: `tests/abac/index.test.js`（provider の `sub` → `/verify` の `subject`）。

## 変更プロトコル

すべての行は 2-repo 制約である: 片側だけ変えると `/verify` が壊れる — 最悪の場合、静かに何も認可しなくなる。行を変更する PR は (1) 所有側 repo、(2) 本 repo の E2E ピン、(3) この表、を更新する。署名の半面の同等ルール（alg/鍵の対称性）は `tests/` 配下の compose/Makefile 単一定義化で強制されている。
