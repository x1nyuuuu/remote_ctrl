FROM node:22-alpine AS web
WORKDIR /src
COPY web/package.json ./
RUN npm install
COPY web/ ./
RUN npm run build

FROM golang:1.22-alpine AS relay
WORKDIR /src
COPY relay/go.mod ./
RUN go mod download
COPY relay/ ./
RUN go mod tidy && CGO_ENABLED=0 go build -o /out/relay .

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=relay /out/relay /app/relay
COPY --from=web /src/dist /app/static
ENV STATIC_DIR=/app/static
ENV LISTEN_ADDR=:8080
EXPOSE 8080
ENTRYPOINT ["/app/relay"]
