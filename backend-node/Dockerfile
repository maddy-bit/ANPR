FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
WORKDIR /app
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# Create data directories
RUN mkdir -p /data/evidence /data/uploads && chown -R appuser:appgroup /data /app

USER appuser

ENV PORT=8080 HOST=0.0.0.0 NODE_ENV=production
EXPOSE 8080

CMD ["sh", "-c", "node src/database/migrate.js && node src/server.js"]
