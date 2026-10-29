#!/usr/bin/env bash
# Test-only authenticated relay, reused after recovery on the fresh edge network.
set -euo pipefail
set +x
[[ ${CI:-} = true ]] || { echo 'Mail capture requires an isolated CI runner.' >&2; exit 1; }
: "${SWW_CONFIG_DIR:?Disposable configuration required}"
: "${SWW_PROJECT_NAME:?Disposable project required}"
case "$SWW_PROJECT_NAME" in sww-smoke-*) ;; *) echo 'Refusing a non-smoke project.' >&2; exit 1 ;; esac
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
case "${1:-}" in
  stop) docker rm -f "$SWW_PROJECT_NAME-mailpit" >/dev/null; exit ;;
  start) ;;
  *) echo 'Choose start or stop.' >&2; exit 1 ;;
esac
if [[ ! -s "$SWW_CONFIG_DIR/tls/mailpit/cert.pem" ]]; then
  mkdir -p "$SWW_CONFIG_DIR/tls/mailpit"
  chmod 700 "$SWW_CONFIG_DIR/tls/mailpit"
  openssl req -newkey rsa:2048 -nodes -keyout "$SWW_CONFIG_DIR/tls/mailpit/key.pem" \
    -out "$SWW_CONFIG_DIR/tls/mailpit/request.csr" -subj /CN=mailpit >/dev/null 2>&1
  printf 'subjectAltName=DNS:mailpit\nextendedKeyUsage=serverAuth\n' > "$SWW_CONFIG_DIR/tls/mailpit/extensions.cnf"
  openssl x509 -req -in "$SWW_CONFIG_DIR/tls/mailpit/request.csr" \
    -CA "$SWW_CONFIG_DIR/tls/ca.crt" -CAkey "$SWW_CONFIG_DIR/tls/ca.key" -CAcreateserial \
    -out "$SWW_CONFIG_DIR/tls/mailpit/cert.pem" -days 1 \
    -extfile "$SWW_CONFIG_DIR/tls/mailpit/extensions.cnf" >/dev/null 2>&1
fi
network=$(docker inspect "$(sh scripts/vps-compose.sh ps -q app)" \
  --format '{{range $name, $settings := .NetworkSettings.Networks}}{{println $name}}{{end}}' | sed -n '/_edge$/p' | head -n 1)
[[ -n "$network" ]] || { echo 'Disposable edge network was not found.' >&2; exit 1; }
docker run -d --name "$SWW_PROJECT_NAME-mailpit" --user 0:0 \
  --network "$network" --network-alias mailpit \
  -v "$SWW_CONFIG_DIR/tls/mailpit:/tls:ro" axllent/mailpit:v1.27 \
  --smtp-auth-accept-any --smtp-require-starttls --smtp-tls-cert /tls/cert.pem --smtp-tls-key /tls/key.pem
