FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

RUN corepack enable
COPY --chown=node:node admin/package.json admin/pnpm-lock.yaml ./admin/
RUN cd admin && pnpm install --prod --frozen-lockfile

COPY --chown=node:node . .
RUN mkdir -p /app/admin/data /app/admin/config-backups /app/admin/media-trash && chown -R node:node /app/admin

USER node
WORKDIR /app/admin
EXPOSE 9000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:9000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
