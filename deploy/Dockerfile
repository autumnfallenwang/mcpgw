FROM node:26-alpine

# Node stopped bundling Corepack in v25, so pnpm comes from npm.
RUN npm install -g pnpm@10.29.3

WORKDIR /app

COPY package.json pnpm-lock.yaml tsconfig.json ./
COPY src/ src/

RUN pnpm install --frozen-lockfile --prod && chown -R node:node /app

# The commit this image is built from (CI passes it); `GET /` reports it.
ARG GIT_SHA=""
ENV MCPGW_COMMIT=$GIT_SHA

USER node
EXPOSE 3002

# `node` is PID 1, not pnpm: under `pnpm start` every boot prints non-JSON lines into Loki, and
# SIGTERM goes to pnpm, so the graceful shutdown never runs. tsx loads as an import hook, not its CLI.
CMD ["node", "--import", "tsx", "src/index.ts"]
