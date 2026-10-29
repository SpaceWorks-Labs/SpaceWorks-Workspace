#!/usr/bin/env bash
# CI-only real two-image smoke. No browser or production credentials.
set -euo pipefail
set +x
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
[[ ${CI:-} = true ]] || { echo 'Run this image/installer smoke only on an isolated CI runner.' >&2; exit 1; }
# shellcheck source=scripts/smoke-public-permissions.sh
. scripts/smoke-public-permissions.sh
work=$(mktemp -d)
SWW_CONFIG_DIR="$work/config"
SWW_PROJECT_NAME="sww-smoke-$(date +%s)"
export SWW_CONFIG_DIR SWW_PROJECT_NAME
cleanup() {
  status=$?
  as_root bash scripts/test-vps-mailpit.sh stop >/dev/null 2>&1 || true
  if [[ $status != 0 && -f "$SWW_CONFIG_DIR/compose.env" ]]; then
    # Only this disposable deployment; never dump interpolated configuration.
    as_root sh scripts/vps-compose.sh ps || true
    as_root sh scripts/vps-compose.sh logs --tail 40 app frontend worker beat || true
  fi
  [[ ! -f "$SWW_CONFIG_DIR/compose.env" ]] || as_root sh scripts/vps-compose.sh down --volumes --remove-orphans >/dev/null 2>&1 || true
  as_root rm -rf -- "$work"
  remove_public_permission_probe || true
}
trap cleanup EXIT
# The real installer runs as root; config files are root-owned with mode 600.
as_root() {
  if [[ $(id -u) = 0 ]]; then "$@"; else
    # sudo-rs may ignore -E. Forward only nonsecret fixture coordinates.
    sudo env CI=true "SWW_CONFIG_DIR=$SWW_CONFIG_DIR" "SWW_PROJECT_NAME=$SWW_PROJECT_NAME" "$@"
  fi
}
mkdir -m 700 "$SWW_CONFIG_DIR"
export SWW_BUILD_KEY
SWW_BUILD_KEY=$(openssl rand -base64 32)
prepare_public_permission_probe
docker build --target runner --secret id=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY,env=SWW_BUILD_KEY \
  --build-arg NEXT_PUBLIC_BASE_URL=https://spaceworks-workspace-origin.invalid -t sww-backend:smoke .
check_public_permission_probe
docker build --target frontend --secret id=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY,env=SWW_BUILD_KEY \
  --build-arg NEXT_PUBLIC_BASE_URL=https://spaceworks-workspace-origin.invalid \
  --build-arg NEXT_PUBLIC_BACKEND_ORIGIN=https://spaceworks-workspace-backend.invalid -t sww-frontend:smoke .
# Exercise the exact configuration writer the confirmed installer runs.
docker run --rm --user 0:0 -v "$SWW_CONFIG_DIR:/config" sww-backend:smoke \
  node docker/vps/setup.mjs api.workspace.example.test owner@example.test smoke workspace.example.test split
export EMAIL_FROM='Space Works Workspace <noreply@example.test>' SMTP_HOST=mailpit SMTP_PORT=1025 SMTP_SECURE=false SMTP_USER=smoke SMTP_PASSWORD=disposable-ci-smtp
# Credentials travel in environment, never arguments.
docker run --rm --user 0:0 -v "$SWW_CONFIG_DIR:/config" \
  -e EMAIL_FROM -e SMTP_HOST -e SMTP_PORT -e SMTP_SECURE -e SMTP_USER -e SMTP_PASSWORD \
  sww-backend:smoke node docker/vps/configure-smtp.mjs
printf "SWW_CADDY_TLS='internal'\n" | as_root tee -a "$SWW_CONFIG_DIR/compose.env" >/dev/null
as_root mkdir -m 755 "$SWW_CONFIG_DIR/status"
as_root sh scripts/vps-compose.sh config --quiet
as_root sh scripts/vps-compose.sh build proxy
as_root sh scripts/vps-compose.sh up -d --wait --wait-timeout 300
as_root sh scripts/vps-compose.sh run --rm --no-deps -T ops node docker/vps/check.mjs
as_root sh scripts/vps-compose.sh run --rm --no-deps -T ops node docker/vps/smoke.mjs
# Exercise the same image with the single-hostname layout too, preserving data.
# shellcheck disable=SC2016 # expanded by the inner shell
as_root bash -c '. scripts/vps-lib.sh
conf_set "$1/compose.env" SWW_LAYOUT single
conf_set "$1/compose.env" SWW_CADDYFILE Caddyfile
conf_set "$1/compose.env" PUBLIC_HOST workspace.example.test
conf_set "$1/app.env" DEPLOYMENT_MODE ""' _ "$SWW_CONFIG_DIR"
as_root sh scripts/vps-compose.sh up -d --wait --wait-timeout 300 --remove-orphans
as_root sh scripts/vps-compose.sh run --rm --no-deps -T ops node docker/vps/smoke.mjs
printf 'Two-image installer smoke passed in split and single layouts.\n'
# Capture real worker email with authenticated STARTTLS under the generated CA.
as_root bash scripts/test-vps-mailpit.sh start
as_root sh scripts/vps-compose.sh run --rm --no-deps -T -e SWW_RECOVERY_SMOKE=1 ops node docker/vps/jobs-smoke.mjs
as_root bash scripts/test-vps-mailpit.sh stop
as_root bash scripts/test-vps-recovery.sh
