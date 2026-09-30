# E2E test Dockerfile for auth.provider
# Builds the monorepo from source and runs the templates/standalone entrypoint,
# with secret mount for GitHub Packages (same pattern as policy-verifier.Dockerfile).
FROM node:24-alpine AS node-base

ENV HOME=/home/node

RUN apk add --no-cache tini \
 && npm install -g corepack --force \
 && corepack enable

WORKDIR /home/node

#############################################
FROM node-base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# The provider's own pnpm-workspace.yaml, not one written here: it carries the
# `overrides` and `onlyBuiltDependencies` the provider's lockfile was resolved
# with, and without them pnpm re-resolves the lockfile, dropping the security
# overrides and skipping bcrypt's install script. Projects it matches that the
# image does not copy (create-app, tools/*) are just not workspace projects
# here; both installs are --frozen-lockfile, which accepts that and refuses any
# other departure from the lockfile. A `patchedDependencies` entry (a patches/
# directory) or a .pnpmfile.cjs would fail the frozen install until this file
# copies it too; the provider uses neither.

# Hand-maintained: one line per packages/* in auth.provider, here and in the
# runtime stage below. A package missing from this list is absent from the
# workspace pnpm installs, so its build finds no node_modules, and a missing
# template dependency fails the install outright.
COPY packages/core/package.json packages/core/package.json
COPY packages/device-grant/package.json packages/device-grant/package.json
COPY packages/dpop/package.json packages/dpop/package.json
COPY packages/federation-apple/package.json packages/federation-apple/package.json
COPY packages/federation-github/package.json packages/federation-github/package.json
COPY packages/federation-google/package.json packages/federation-google/package.json
COPY packages/federation-grants/package.json packages/federation-grants/package.json
COPY packages/federation-oidc/package.json packages/federation-oidc/package.json
COPY packages/foundation/package.json packages/foundation/package.json
COPY packages/mtls/package.json packages/mtls/package.json
COPY packages/oauth/package.json packages/oauth/package.json
COPY packages/oauth-token-exchange/package.json packages/oauth-token-exchange/package.json
COPY packages/redis/package.json packages/redis/package.json
COPY packages/session/package.json packages/session/package.json
COPY packages/webauthn/package.json packages/webauthn/package.json
COPY templates/standalone/package.json templates/standalone/package.json

RUN --mount=type=secret,id=npmrc,target=/home/node/.npmrc \
    pnpm install --frozen-lockfile

#############################################
FROM deps AS builder

COPY tsconfig.base.json ./
COPY packages/ packages/
COPY templates/standalone/ templates/standalone/

RUN pnpm -r run build

# Every package's config/ directory and the template's, gathered by glob into
# one staging tree the runtime stage copies whole; unlike the package lists
# above, not hand-maintained. The provider is moving each package's defaults
# to its own config/reference.conf, layered for the modules the composition
# loads, so the image needs every such directory. A COPY of a directory that
# does not exist fails the build, and the suite runs against provider
# revisions before and after each directory appears, so the loop takes
# whichever exist.
RUN mkdir -p /tmp/config-staging \
 && for dir in packages/*/config templates/standalone/config; do \
      if [ -d "$dir" ]; then \
        mkdir -p "/tmp/config-staging/$dir" \
        && cp -R "$dir/." "/tmp/config-staging/$dir/"; \
      fi; \
    done

#############################################
FROM node-base AS runtime

ENV NODE_ENV=production

COPY --from=deps /home/node/package.json /home/node/pnpm-lock.yaml ./
COPY --from=deps /home/node/pnpm-workspace.yaml ./
COPY --from=deps /home/node/packages/core/package.json packages/core/package.json
COPY --from=deps /home/node/packages/device-grant/package.json packages/device-grant/package.json
COPY --from=deps /home/node/packages/dpop/package.json packages/dpop/package.json
COPY --from=deps /home/node/packages/federation-apple/package.json packages/federation-apple/package.json
COPY --from=deps /home/node/packages/federation-github/package.json packages/federation-github/package.json
COPY --from=deps /home/node/packages/federation-google/package.json packages/federation-google/package.json
COPY --from=deps /home/node/packages/federation-grants/package.json packages/federation-grants/package.json
COPY --from=deps /home/node/packages/federation-oidc/package.json packages/federation-oidc/package.json
COPY --from=deps /home/node/packages/foundation/package.json packages/foundation/package.json
COPY --from=deps /home/node/packages/mtls/package.json packages/mtls/package.json
COPY --from=deps /home/node/packages/oauth/package.json packages/oauth/package.json
COPY --from=deps /home/node/packages/oauth-token-exchange/package.json packages/oauth-token-exchange/package.json
COPY --from=deps /home/node/packages/redis/package.json packages/redis/package.json
COPY --from=deps /home/node/packages/session/package.json packages/session/package.json
COPY --from=deps /home/node/packages/webauthn/package.json packages/webauthn/package.json
COPY --from=deps /home/node/templates/standalone/package.json templates/standalone/package.json

# Not --prod: sibling @o3co packages are peerDependencies satisfied via
# devDependencies, and ESM resolution starts from each package's real dir,
# so a prod-only install leaves those links missing (ERR_MODULE_NOT_FOUND).
RUN --mount=type=secret,id=npmrc,target=/home/node/.npmrc \
    pnpm install --prod=false --frozen-lockfile

COPY --from=builder /home/node/packages/core/dist/ packages/core/dist/
COPY --from=builder /home/node/packages/device-grant/dist/ packages/device-grant/dist/
COPY --from=builder /home/node/packages/dpop/dist/ packages/dpop/dist/
COPY --from=builder /home/node/packages/federation-apple/dist/ packages/federation-apple/dist/
COPY --from=builder /home/node/packages/federation-github/dist/ packages/federation-github/dist/
COPY --from=builder /home/node/packages/federation-google/dist/ packages/federation-google/dist/
COPY --from=builder /home/node/packages/federation-grants/dist/ packages/federation-grants/dist/
COPY --from=builder /home/node/packages/federation-oidc/dist/ packages/federation-oidc/dist/
COPY --from=builder /home/node/packages/foundation/dist/ packages/foundation/dist/
COPY --from=builder /home/node/packages/mtls/dist/ packages/mtls/dist/
COPY --from=builder /home/node/packages/oauth/dist/ packages/oauth/dist/
COPY --from=builder /home/node/packages/oauth-token-exchange/dist/ packages/oauth-token-exchange/dist/
COPY --from=builder /home/node/packages/redis/dist/ packages/redis/dist/
COPY --from=builder /home/node/packages/session/dist/ packages/session/dist/
COPY --from=builder /home/node/packages/webauthn/dist/ packages/webauthn/dist/
COPY --from=builder /home/node/templates/standalone/dist/ templates/standalone/dist/
# packages/<name>/config/ and templates/standalone/config/, as gathered in the
# builder stage.
COPY --from=builder /tmp/config-staging/ ./

USER node

# Run from the standalone dir: application.conf references cwd-relative
# paths (config/clients.yaml), matching the template's own Dockerfile.
WORKDIR /home/node/templates/standalone

ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/app.mjs"]
