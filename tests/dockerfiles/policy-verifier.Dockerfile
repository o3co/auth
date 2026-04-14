# E2E test Dockerfile for auth.policy-verifier
# Based on repos/auth.policy-verifier/Dockerfile with secret mount for GitHub Packages
FROM node:24-alpine AS node-base

ENV HOME=/home/node

RUN apk add --no-cache tini \
 && npm install -g corepack --force \
 && corepack enable

WORKDIR /home/node

#############################################
FROM node-base AS deps

COPY package.json pnpm-lock.yaml ./
# Override workspace config to exclude create-app (not needed for runtime)
RUN printf 'packages:\n  - "packages/*"\n  - "templates/*"\n' > pnpm-workspace.yaml
COPY packages/core/package.json packages/core/package.json
COPY packages/builtins/package.json packages/builtins/package.json
COPY packages/server/package.json packages/server/package.json
COPY templates/standalone/package.json templates/standalone/package.json

RUN --mount=type=secret,id=npmrc,target=/home/node/.npmrc \
    pnpm install

#############################################
FROM deps AS builder

COPY tsconfig.base.json ./
COPY packages/core/ packages/core/
COPY packages/builtins/ packages/builtins/
COPY packages/server/ packages/server/
COPY templates/standalone/ templates/standalone/

RUN pnpm -r run build

#############################################
FROM node-base AS runtime

ENV NODE_ENV=production

COPY --from=deps /home/node/package.json /home/node/pnpm-lock.yaml ./
COPY --from=deps /home/node/pnpm-workspace.yaml ./
COPY --from=deps /home/node/packages/core/package.json packages/core/package.json
COPY --from=deps /home/node/packages/builtins/package.json packages/builtins/package.json
COPY --from=deps /home/node/packages/server/package.json packages/server/package.json
COPY --from=deps /home/node/templates/standalone/package.json templates/standalone/package.json

RUN --mount=type=secret,id=npmrc,target=/home/node/.npmrc \
    pnpm install --prod

COPY --from=builder /home/node/packages/core/dist/ packages/core/dist/
COPY --from=builder /home/node/packages/builtins/dist/ packages/builtins/dist/
COPY --from=builder /home/node/packages/server/dist/ packages/server/dist/
COPY --from=builder /home/node/templates/standalone/dist/ templates/standalone/dist/
COPY --from=builder /home/node/templates/standalone/config/ templates/standalone/config/

USER node

ENV NODE_PATH=/home/node/templates/standalone/node_modules

ENTRYPOINT ["tini", "--"]
CMD ["node", "templates/standalone/dist/main.mjs"]
