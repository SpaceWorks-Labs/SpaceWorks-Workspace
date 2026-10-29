# syntax=docker/dockerfile:1
# Keep the standard Caddy modules and runtime contract; patch the toolchain and
# dependency versions until the official release image incorporates the fixes.
FROM golang:1.26.10-alpine3.24@sha256:a2012b4a1d1f9f7e9f44e0d39b805a901e856b1dd80b4e6ee4338db547050308 AS builder
WORKDIR /build
ARG GOPROXY=https://proxy.golang.org,direct
ENV GOPROXY=$GOPROXY
ENV GOTOOLCHAIN=local CGO_ENABLED=0 GOMAXPROCS=2 GOFLAGS=-p=2
COPY go.mod go.sum ./
RUN --mount=type=cache,id=spaceworks-caddy-gomod,target=/go/pkg/mod \
    go mod download && go mod verify
COPY main.go ./
RUN --mount=type=cache,id=spaceworks-caddy-gomod,target=/go/pkg/mod \
    --mount=type=cache,id=spaceworks-caddy-build,target=/root/.cache/go-build \
    go build -mod=readonly -trimpath -ldflags='-s -w' -o /out/caddy . \
    && go version -m /out/caddy

# Preserve the official config, directories, root UID, command and curl utility.
FROM caddy:2.11.7-alpine@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f
RUN apk --no-cache upgrade
COPY --from=builder /out/caddy /usr/bin/caddy
# COPY replaces the original inode and therefore its privileged-port capability.
RUN setcap cap_net_bind_service=+ep /usr/bin/caddy && caddy version
