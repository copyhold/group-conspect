FROM node:20-alpine AS frontend-builder
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
ARG VITE_BASE_URL=/conspect-bot/
ARG VITE_API_URL=/conspect-bot/api
RUN VITE_BASE_URL=${VITE_BASE_URL} VITE_API_URL=${VITE_API_URL} npx vite build --base=${VITE_BASE_URL}

FROM oven/bun:1
WORKDIR /app
COPY backend/package.json ./
RUN bun install
COPY backend/src/ ./src/
COPY backend/tsconfig.json ./
COPY --from=frontend-builder /frontend/dist ./dist
EXPOSE 3001
ENV FRONTEND_DIR=/app/dist
CMD ["bun", "--env-file=/app/.env", "src/index.ts"]
