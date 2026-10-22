# E2E test Dockerfile for auth.provider
# The provider ships no server of its own: an app is generated from its
# modules by its create-app command, which with `--workspace` links each module
# to the workspace's source instead of the published packages, as the
# provider's own conformance runs do. So the image installs the workspace at
# the revision under test, generates the app the suite runs from it, installs
# that app and runs it on Node's type stripping, with no build step. The
# npmrc build secret mounts the host's ~/.npmrc into the pnpm installs without
# writing it into a layer. Every package resolves from the public npm
# registry, so an empty file is enough.
FROM node:24.22-alpine AS base

ENV HOME=/home/node

# corepack runs the pnpm each manifest's `packageManager` names: the
# workspace's, and the generated app's, which names the same one.
RUN apk add --no-cache tini \
 && npm install -g corepack --force \
 && corepack enable

WORKDIR /home/node

#############################################
FROM base AS workspace

# provider.Dockerfile.dockerignore keeps a host install (node_modules) and
# .git out of this copy.
COPY --chown=node:node . provider/

USER node

RUN --mount=type=secret,id=npmrc,target=/home/node/.npmrc,uid=1000 \
    cd provider && pnpm install --frozen-lockfile

#############################################
FROM workspace AS runtime

# The provider's simple-web pattern (password login, the code flow with
# refresh, OpenID Connect, userinfo, introspection and revocation), with:
# - session-grant: the `session` grant the injection proxies exchange the
#   browser's session cookie at;
# - resource-indicators: RFC 8707 `resource`, which narrows the access
#   token's audience to the one auth.policy-verifier pins;
# - verified-email: no access token for a user whose email is not verified;
# - dpop and mtls: the binding kinds, so the provider vouches for a token
#   bound to a key or a certificate, which the suite presents to Bearer-only
#   consumers;
# - the store axis on redis, so every feature's state goes through Redis, as
#   it would across replicas, instead of process memory.
# The configuration is not written here: compose supplies the environment the
# generated config/application.conf reads, and mounts the local layer
# (tests/provider/local.conf).
RUN node provider/modules/scaffold/create-app/src/main.ts app \
      --workspace /home/node/provider \
      --pattern simple-web \
      --add @mod/session-grant \
      --add @mod/resource-indicators \
      --add @mod/verified-email \
      --add @mod/dpop \
      --add @mod/mtls \
      --axis @mod/store=@mod/redis

RUN --mount=type=secret,id=npmrc,target=/home/node/.npmrc,uid=1000 \
    cd app && pnpm install

ENV NODE_ENV=production

WORKDIR /home/node/app

ENTRYPOINT ["tini", "--"]
CMD ["node", "src/main.ts"]
