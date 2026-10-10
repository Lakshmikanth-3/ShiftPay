FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /srv/shiftpay
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
COPY scripts/start-container.sh ./scripts/start-container.sh
COPY scripts/start-hosted.mjs ./scripts/start-hosted.mjs
RUN chmod +x scripts/start-container.sh && chown node:node /srv/shiftpay
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=20s --start-period=60s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/health',{signal:AbortSignal.timeout(15000)}).then(async r=>{if(!r.ok||!(await r.json()).ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["./scripts/start-container.sh"]
