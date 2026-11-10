FROM node:20-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY apps/api/package.json ./
RUN npm install --no-audit --no-fund
COPY apps/api/ ./
RUN npm run build && npm prune --omit=dev

FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=4000
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./
USER node
EXPOSE 4000
# Applies pending migrations on start (idempotent). For multi-instance prod, run `prisma migrate deploy` as a one-off job instead.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
