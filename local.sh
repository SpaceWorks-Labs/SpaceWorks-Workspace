#!/usr/bin/env bash
# Local development helper for macOS (Homebrew) and Linux.
#
#   ./local.sh start     Docker services + .env + migrations + web/worker/beat
#   ./local.sh services  only start PostgreSQL, Redis, Silo and Mailpit
#   ./local.sh stop      stop the dev server and the Docker services (data kept)
#   ./local.sh status    what is running
#   ./local.sh reset     stop and DELETE the local Docker volumes (asks first)
#
# Services come from docker-compose.yml (ports match .env.example). Node.js 22+
# and Docker are the only requirements: `brew install node` and Docker Desktop
# (or `brew install --cask docker`) on macOS.
set -euo pipefail
cd "$(dirname "$0")"

green=$'\033[0;32m'
yellow=$'\033[1;33m'
red=$'\033[0;31m'
reset_colour=$'\033[0m'
say() { printf '%s%s%s\n' "$2" "$1" "$reset_colour"; }
port=${PORT:-3000}

require_tools() {
  local missing=0
  if ! command -v node >/dev/null; then
    say 'Node.js is missing. macOS: brew install node' "$red"; missing=1
  elif [[ $(node -p 'process.versions.node.split(".")[0]') -lt 22 ]]; then
    say 'Node.js 22 or newer is required. macOS: brew upgrade node' "$red"; missing=1
  fi
  if ! command -v docker >/dev/null || ! docker info >/dev/null 2>&1; then
    say 'Docker is not running. macOS: open Docker Desktop (brew install --cask docker).' "$red"; missing=1
  fi
  [[ $missing = 0 ]] || exit 1
}

key() { node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64"))'; }

ensure_env() {
  [[ -f .env ]] && return
  say 'Creating .env from .env.example with fresh local secrets...' "$yellow"
  umask 077
  sed \
    -e "s|^AUTH_SECRET=.*|AUTH_SECRET=\"$(key)\"|" \
    -e "s|^MFA_ENCRYPTION_KEY=.*|MFA_ENCRYPTION_KEY=\"$(key)\"|" \
    -e "s|^INTEGRATION_ENCRYPTION_KEY=.*|INTEGRATION_ENCRYPTION_KEY=\"$(key)\"|" \
    -e "s|^VAULT_MASTER_KEY=.*|VAULT_MASTER_KEY=\"$(key)\"|" \
    -e "s|^NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=.*|NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=\"$(key)\"|" \
    -e "s|^CRON_SECRET=.*|CRON_SECRET=\"$(key)\"|" \
    -e "s|^HEALTHCHECK_SECRET=.*|HEALTHCHECK_SECRET=\"$(key)\"|" \
    -e 's|^S3_ACCESS_KEY_ID=.*|S3_ACCESS_KEY_ID="swwdev"|' \
    -e 's|^S3_SECRET_ACCESS_KEY=.*|S3_SECRET_ACCESS_KEY="sww_dev_storage_pw"|' \
    .env.example > .env
  say 'Wrote .env (never commit it).' "$green"
}

start_services() {
  require_tools
  say 'Starting PostgreSQL, Redis, Silo and Mailpit (docker compose)...' "$yellow"
  docker compose up -d --wait
  ensure_env
  # Refuse an existing .env that targets a live/remote installation before writes.
  node --env-file-if-exists=.env scripts/check-local-services.mjs
  [[ -d node_modules ]] || { say 'Installing dependencies...' "$yellow"; npm install; }
  npm run storage:init
  # Applies committed migrations only; create new ones with `npm run db:migrate -- --name <area>`.
  npm run db:deploy
  say "Services ready. Mailpit: http://127.0.0.1:8025" "$green"
}

dev_pids() {
  [[ -f .data/dev.pid ]] || return 0
  local pid
  pid=$(cat .data/dev.pid)
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null && printf '%s' "$pid"
  return 0
}

stop_all() {
  local pids attempts
  pids=$(dev_pids)
  if [[ -n "$pids" ]]; then
    say "Stopping the local web/worker/beat stack ($pids)..." "$yellow"
    # shellcheck disable=SC2086 # one pid per word
    kill $pids 2>/dev/null || true
    # Let worker/beat finish their SQL/SMTP updates before stopping their services.
    for ((attempts=0; attempts<20; attempts++)); do
      [[ -z "$(dev_pids)" ]] && break
      sleep 1
    done
    if [[ -n "$(dev_pids)" ]]; then
      say 'The local stack is still stopping. Docker services were kept running; retry stop shortly.' "$yellow"
      return 1
    fi
  fi
  docker compose stop
  say 'Stopped. Data is kept in the Docker volumes.' "$green"
}

status() {
  docker compose ps
  if [[ -n "$(dev_pids)" ]]; then say "Dev server: running" "$green"; else say 'Dev server: stopped' "$red"; fi
}

case "${1:-start}" in
  start)
    start_services
    say "Starting web, worker and beat on http://localhost:$port (first run: open /setup)..." "$green"
    npx prisma generate
    npm run build:jobs
    mkdir -p .data
    PORT="$port" node --env-file-if-exists=.env scripts/dev-stack.mjs &
    child=$!
    printf '%s' "$child" > .data/dev.pid
    trap 'kill "$child" 2>/dev/null || true; wait "$child" 2>/dev/null || true; rm -f .data/dev.pid' EXIT
    trap 'exit 130' INT TERM
    wait "$child"
    ;;
  services) start_services ;;
  stop) stop_all ;;
  status) status ;;
  reset)
    read -r -p 'Delete the local database, Redis and storage volumes? [y/N]: ' answer
    [[ "$answer" = y || "$answer" = Y ]] || exit 0
    stop_all
    docker compose down --volumes
    ;;
  *)
    echo 'Usage: ./local.sh {start|services|stop|status|reset}' >&2
    exit 1
    ;;
esac
