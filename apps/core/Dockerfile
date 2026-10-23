FROM golang:1.24.6-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/rallyx-core ./cmd/rallyx-core

FROM alpine:3.22.1
RUN apk add --no-cache ca-certificates tzdata && addgroup -S rallyx && adduser -S -G rallyx rallyx
COPY --from=build /out/rallyx-core /rallyx-core
USER rallyx
EXPOSE 8081
ENTRYPOINT ["/rallyx-core"]
