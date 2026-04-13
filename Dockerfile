# ========================================
# claude-api — Multi-stage Docker Build
# Author: el-pablos <yeteprem.end23juni@gmail.com>
# Compatible: Linux (Ubuntu/Debian/Alpine), macOS, Windows
# ========================================

# Stage 1: Install dependencies
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production=false

# Stage 2: Run tests (build validation)
FROM deps AS test
WORKDIR /app
COPY . .
RUN npm run typecheck
RUN npm test

# Stage 3: Production image
FROM node:22-alpine AS production
LABEL maintainer="el-pablos <yeteprem.end23juni@gmail.com>"
LABEL org.opencontainers.image.source="https://github.com/el-pablos/claude-api"
LABEL org.opencontainers.image.description="Claude API Key Pooling Proxy — multi key rotation, auto failover, monitoring dashboard"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app

# Install tini for proper PID 1 signal handling
RUN apk add --no-cache tini

# Create non-root user
RUN addgroup -S claude && adduser -S claude -G claude

# Copy package files and install production deps only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy source code
COPY src/ ./src/
COPY tsconfig.json ./

# Create data and logs directories with proper permissions
RUN mkdir -p /app/data /app/logs && chown -R claude:claude /app

# Switch to non-root user
USER claude

# Environment defaults
ENV PORT=4143
ENV HOST=0.0.0.0
ENV NODE_ENV=production
ENV POOL_STRATEGY=round-robin
ENV POOL_STATE_FILE=/app/data/pool.json
ENV LOG_LEVEL=info
ENV DASHBOARD_ENABLED=true
ENV MAX_RETRIES=3
ENV RATE_LIMIT_COOLDOWN=60000
ENV CLAUDE_BASE_URL=https://api.anthropic.com
ENV CLAUDE_API_TIMEOUT=300000

# Expose port
EXPOSE 4143

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4143/health || exit 1

# Use tini as entrypoint for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start server
CMD ["node", "--import", "tsx/esm", "src/index.ts"]
