#!/bin/sh
# Use an explicit production project/file; never load the development .env.
set -eu
: "${SWW_CONFIG_DIR:?Set SWW_CONFIG_DIR to the absolute external configuration directory}"
case "$SWW_CONFIG_DIR" in /*) ;; *) echo 'SWW_CONFIG_DIR must be absolute.' >&2; exit 1 ;; esac
export SWW_CONFIG_DIR
# The saved release/hostname are authoritative, even in an old operator shell.
unset PUBLIC_HOST PUBLIC_ORIGIN SITE_HOST SWW_VERSION SWW_LAYOUT SWW_CADDYFILE SWW_CADDY_OPTIONS \
  SWW_BACKEND_IMAGE SWW_FRONTEND_IMAGE COMPOSE_PROFILES
# Use Compose's direct builder; Bake may reject an external secret-file path.
export COMPOSE_BAKE=false
# Builds compile with a throwaway Server Actions key; the real one is runtime-only.
SWW_BUILD_KEY=${SWW_BUILD_KEY:-$(head -c 32 /dev/urandom | base64 | tr -d '\n')}
export SWW_BUILD_KEY
repo_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
setting() { sed -n "s/^$1='\{0,1\}\([^']*\)'\{0,1\}$/\1/p" "$SWW_CONFIG_DIR/compose.env" 2>/dev/null | tail -n 1; }
tls=$(setting SWW_CADDY_TLS) storage=$(setting SWW_STORAGE)
# Profiles: the split layout runs the website container; Caddy and bundled Silo
# run unless an existing reverse proxy or an external bucket replaces them.
profiles=''
[ "$(setting SWW_LAYOUT)" != split ] || profiles='split'
[ "$tls" = proxy ] || profiles=${profiles:+$profiles,}caddy
[ "$storage" = external ] || profiles=${profiles:+$profiles,}silo
# Teardown includes inactive layout services left by a split-to-single change.
[ "${1:-}" != down ] || profiles='*'
export COMPOSE_PROFILES="$profiles"
# Prepended in reverse: the base file first, then the overrides.
if [ "$storage" = external ]; then set -- --file "$repo_dir/compose.external-storage.yml" "$@"; fi
case "$tls" in
  internal) set -- --file "$repo_dir/compose.internal-tls.yml" "$@" ;;
  proxy) set -- --file "$repo_dir/compose.external-proxy.yml" "$@" ;;
esac
set -- --file "$repo_dir/compose.production.yml" "$@"
exec docker compose --project-name "${SWW_PROJECT_NAME:-sww}" --env-file "$SWW_CONFIG_DIR/compose.env" "$@"
