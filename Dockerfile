# 当前生产未启用 Docker（阿里云 ECS 拉不到 node 镜像），保留作为可选方案。
# ─── Stage 1: Frontend Builder ─────────────────────────────
FROM node:22-alpine AS frontend-builder

WORKDIR /app

# Install frontend deps
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json vite.config.ts index.html ./
COPY src/ ./src/
RUN npm run build

# ─── Stage 2: Production Runtime ───────────────────────────
FROM node:22-alpine AS production

WORKDIR /app

# Install production deps for backend
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

# Copy backend source
COPY server/ ./server/

# Copy frontend build output
COPY --from=frontend-builder /app/dist/ ./dist/

# Environment defaults
ENV NODE_ENV=production
ENV PORT=3001
ENV DB_TYPE=sqlite

# Create data directory for SQLite
RUN mkdir -p /app/server/data

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/health || exit 1

EXPOSE 3001

CMD ["node", "server/index.js"]