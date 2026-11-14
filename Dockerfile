# Stage 1: Build the React frontend
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build the single Go binary with embedded frontend assets
FROM golang:alpine AS backend-builder
WORKDIR /app
ENV GOTOOLCHAIN=auto
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY frontend/embed.go ./frontend/embed.go
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /labboard ./cmd/labboard

# Stage 3: Minimal runtime image
FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata \
    && adduser -D -u 10001 labboard \
    && mkdir -p /data \
    && chown -R labboard:labboard /data

COPY --from=backend-builder /labboard /usr/local/bin/labboard

USER labboard
WORKDIR /data
VOLUME ["/data"]

ENV HOST=0.0.0.0
ENV PORT=8080
ENV DATA_DIR=/data
ENV DB_NAME=labboard.db

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/labboard"]
