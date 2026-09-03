FROM node:22-bookworm-slim

ARG ATELIER_GIT_SHA=unknown
ARG ATELIER_GIT_BRANCH=unknown
ARG ATELIER_BUILD_TIME=unknown
ARG ATELIER_ENVIRONMENT=production

ENV NODE_ENV=production
ENV ATELIER_RELEASE_METADATA_PATH=/app/runtime-build.json
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
COPY --chown=node:node admin/package.json admin/pnpm-lock.yaml ./admin/
RUN cd admin && pnpm install --prod --frozen-lockfile

COPY --chown=node:node . .
RUN node -e 'const fs=require("fs"); fs.writeFileSync("/app/runtime-build.json", JSON.stringify({commitSha:process.env.ATELIER_GIT_SHA,branch:process.env.ATELIER_GIT_BRANCH,buildTime:process.env.ATELIER_BUILD_TIME,environment:process.env.ATELIER_ENVIRONMENT})+"\n")' \
 && mkdir -p /app/admin/data /app/admin/config-backups /app/admin/media-trash \
 && chown -R node:node /app/admin /app/runtime-build.json

USER node
WORKDIR /app/admin
EXPOSE 9000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:9000/health').then(async r=>{const body=await r.json();if(!r.ok||body.status!=='ok')process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
