# ── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Stage 2: Production ──────────────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

ENV NODE_ENV=production

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Create upload dirs
RUN mkdir -p uploads/avatars uploads/videos

# Non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001 -G nodejs
RUN chown -R nestjs:nodejs /app
USER nestjs

EXPOSE 3000
CMD ["node", "dist/main"]
