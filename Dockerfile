# Stage 1: Build frontend
FROM node:20-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
ENV VITE_GOOGLE_CLIENT_ID=260267808091-b0en4v9otko7i8u5gnbl3f6k3ar19qk9.apps.googleusercontent.com
RUN npm run build

# Stage 2: Production backend + serve frontend
FROM node:20-slim
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ .
COPY --from=frontend-build /app/frontend/dist ../frontend/dist

ENV PORT=8080
EXPOSE 8080
CMD ["node_modules/.bin/tsx", "server.ts"]
