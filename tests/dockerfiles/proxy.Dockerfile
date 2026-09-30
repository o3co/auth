# E2E test Dockerfile for auth.proxy
# Based on repos/auth.proxy/Dockerfile. The npmrc build secret mounts the host's
# ~/.npmrc into the pnpm install without writing it into a layer. Every package
# resolves from the public npm registry, so an empty file is enough.
##############################################
FROM node:24-alpine AS base

RUN npm install -g corepack --force

ENV HOME=/home/node
ENV NODE_ENV=production

WORKDIR ${HOME}

COPY package.json pnpm-lock.yaml ./

RUN corepack enable && corepack prepare --activate

##############################################
FROM base AS builder

RUN --mount=type=secret,id=npmrc,target=/home/node/.npmrc \
    pnpm install --frozen-lockfile

ADD config ./config
ADD src ./src
ADD tsconfig.json ./

RUN pnpm run build

##############################################
FROM builder AS pre

RUN pnpm prune --prod

##############################################
FROM base AS runtime

COPY --from=pre /home/node/node_modules ./node_modules/
COPY --from=pre /home/node/dist ./dist/
COPY --from=pre /home/node/config ./config/
RUN ln -s /home/node/dist /home/node/src \
 && cp /home/node/config/application.conf /home/node/dist/config/application.conf

CMD ["pnpm", "run", "start"]
