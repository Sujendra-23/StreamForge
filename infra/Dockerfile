FROM node:24-alpine AS web
WORKDIR /src
COPY package*.json ./
RUN npm ci
COPY web ./web
RUN npm run build

FROM golang:1.27-alpine AS server
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY sfu ./sfu
COPY signaling ./signaling
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /streamforge ./cmd/streamforge

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=server /streamforge /app/streamforge
COPY --from=web /src/web/dist /app/web/dist
ENV ADDR=0.0.0.0:8080 RTC_UDP_MIN=50000 RTC_UDP_MAX=50050
EXPOSE 8080/tcp 50000-50050/udp
ENTRYPOINT ["/app/streamforge"]
