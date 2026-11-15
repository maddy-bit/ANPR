# Multi-stage build: install + build with Next.js's standalone output,
# run on a minimal node image (no npm/dev deps in the final image).
FROM node:22-slim AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Backend URL for the browser bundle - override at build time if it
# differs (docker-compose.yml sets this for the bundled stack).
ARG NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8080
ARG BACKEND_INTERNAL_URL=http://backend:8080
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV BACKEND_INTERNAL_URL=$BACKEND_INTERNAL_URL
# standalone output is required for the runtime stage below (COPY .next/standalone);
# host `next build`/`next dev` runs keep the default output by not setting this.
ENV NEXT_OUTPUT_STANDALONE=true
RUN npm run build

FROM node:22-slim
WORKDIR /app
RUN useradd --system --create-home appuser
COPY --from=build /build/public ./public
COPY --from=build /build/.next/standalone ./
COPY --from=build /build/.next/static ./.next/static
USER appuser

ENV PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["node", "server.js"]
