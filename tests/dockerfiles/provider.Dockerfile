# E2E test Dockerfile for auth.provider
# Builds the monorepo from source and runs the templates/standalone entrypoint.
# The npmrc build secret mounts the host's ~/.npmrc into the pnpm installs
# without writing it into a layer. Every package resolves from the public npm
# registry, so an empty file is enough.
FROM node:24-alpine AS node-base

ENV HOME=/home/node

RUN apk add --no-cache tini \
 && npm install -g corepack --force \
 && corepack enable

WORKDIR /home/node

#############################################
FROM node-base AS manifests

# Every packages/*/package.json, gathered by glob into one staging tree with
# its directories kept (a wildcard COPY would flatten them). The deps and
# runtime stages copy the tree whole, so a package the provider adds joins the
# workspace without this file changing, and the install layers stay cached
# while no manifest changes.
COPY packages/ packages/
RUN mkdir -p /tmp/manifests \
 && for f in packages/*/package.json; do \
      mkdir -p "/tmp/manifests/${f%/package.json}" \
      && cp "$f" "/tmp/manifests/$f"; \
    done

#############################################
FROM node-base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# The provider's own pnpm-workspace.yaml, not one written here: it carries the
# security `overrides` the provider's lockfile was resolved with, and the
# `onlyBuiltDependencies` that lets bcrypt run its install script. Both
# installs are --frozen-lockfile, which refuses a workspace file whose
# `overrides` differ from the lockfile's; `onlyBuiltDependencies` is not in
# the lockfile, so without it the install succeeds and skips bcrypt's install
# script. Projects it matches that the image does not copy (create-app,
# tools/*) are just not workspace projects here, which a frozen install
# accepts; it refuses any other departure from the lockfile. A
# `patchedDependencies` entry (a patches/ directory) or a .pnpmfile.cjs would
# fail the frozen install until this file copies it too; the provider uses
# neither.

# Every package's manifest, as gathered in the manifests stage.
COPY --from=manifests /tmp/manifests/ ./
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
# one staging tree the runtime stage copies whole. Each package's defaults
# live in its own config/reference.conf, layered for the modules the
# composition loads, so the image needs every such directory. A COPY of a
# directory that does not exist fails the build, and the suite runs against
# provider revisions before and after each directory appears, so the loop
# takes whichever exist.
RUN mkdir -p /tmp/config-staging \
 && for dir in packages/*/config templates/standalone/config; do \
      if [ -d "$dir" ]; then \
        mkdir -p "/tmp/config-staging/$dir" \
        && cp -R "$dir/." "/tmp/config-staging/$dir/"; \
      fi; \
    done

# Every package's dist/ and the template's, gathered the same way.
RUN mkdir -p /tmp/dist-staging \
 && for dir in packages/*/dist templates/standalone/dist; do \
      if [ -d "$dir" ]; then \
        mkdir -p "/tmp/dist-staging/$dir" \
        && cp -R "$dir/." "/tmp/dist-staging/$dir/"; \
      fi; \
    done

#############################################
FROM node-base AS runtime

ENV NODE_ENV=production

COPY --from=deps /home/node/package.json /home/node/pnpm-lock.yaml ./
COPY --from=deps /home/node/pnpm-workspace.yaml ./
COPY --from=manifests /tmp/manifests/ ./
COPY --from=deps /home/node/templates/standalone/package.json templates/standalone/package.json

# Not --prod: sibling @o3co packages are peerDependencies satisfied via
# devDependencies, and ESM resolution starts from each package's real dir,
# so a prod-only install leaves those links missing (ERR_MODULE_NOT_FOUND).
RUN --mount=type=secret,id=npmrc,target=/home/node/.npmrc \
    pnpm install --prod=false --frozen-lockfile

# packages/<name>/dist/ and templates/standalone/dist/, as gathered in the
# builder stage.
COPY --from=builder /tmp/dist-staging/ ./
# packages/<name>/config/ and templates/standalone/config/, as gathered in the
# builder stage.
COPY --from=builder /tmp/config-staging/ ./

USER node

# Run from the standalone dir: application.conf references cwd-relative
# paths (config/clients.yaml), matching the template's own Dockerfile.
WORKDIR /home/node/templates/standalone

ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/app.mjs"]
