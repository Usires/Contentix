# Contentix — YouTube Content Planner
# Multi-stage not needed: small Node app, no native build steps.
FROM node:20-alpine

LABEL org.opencontainers.image.title="Contentix" \
      org.opencontainers.image.description="YouTube Content Planner with vidIQ Insights" \
      org.opencontainers.image.source="https://github.com/Usires/contentix" \
      org.opencontainers.image.licenses="MIT"

# Run as the built-in `node` user (uid 1000) — non-root by default.
WORKDIR /app

# Install dependencies first to leverage Docker layer caching.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

# Copy the rest of the app source.
COPY index.js ./
COPY VERSION ./
COPY frontend/ ./frontend/

# Pre-create the data directory and give it to the `node` user.
RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 3038

# Healthcheck mirrors docker-compose.yml so `docker run --health` works too.
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=20s \
  CMD wget -qO- http://localhost:3038/api/health || exit 1

CMD ["node", "index.js"]
