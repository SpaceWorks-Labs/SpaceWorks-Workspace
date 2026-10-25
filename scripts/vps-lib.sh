# Shared helpers for the VPS setup, update, backup, restore and status scripts.
# Sourced, never executed. Prompts read the terminal directly because
# `curl | bash` feeds the installer itself on stdin.
# shellcheck shell=bash

SWW_DIR=${SWW_DIR:-/opt/spaceworks-workspace}
SWW_DEFAULT_CONFIG_DIR=/etc/spaceworks-workspace
# shellcheck disable=SC2034 # used by the scripts that source this file
SWW_DEFAULT_REPOSITORY=SpaceWorks-Labs/SpaceWorks-Workspace

say() { printf '[Space Works Workspace] %s\n' "$*"; }
warn() { printf '[Space Works Workspace] WARNING: %s\n' "$*" >&2; }
die() { printf '[Space Works Workspace] ERROR: %s\n' "$*" >&2; exit 1; }

require_root() { [[ $(id -u) = 0 ]] || die 'Run this as root (sudo bash ...).'; }
require_tty() { { : </dev/tty; } 2>/dev/null || die 'An interactive terminal is required.'; }

is_hostname() { [[ ${#1} -le 253 && "$1" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$ ]]; }
is_email() { [[ "$1" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] && is_env_value "$1"; }
# Stricter, for values that end up in the Caddyfile.
is_plain_email() { [[ "$1" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; }
is_port() { [[ "$1" =~ ^[0-9]{1,5}$ ]] && (( 10#$1 >= 1 && 10#$1 <= 65535 )); }
is_nonempty() { [[ -n "${1//[[:space:]]/}" ]]; }
# Answers are stored as single-quoted env-file values, which cannot hold ' or \.
is_env_value() { is_nonempty "$1" && [[ "$1" != *[\'\\]* ]]; }
is_mode() { [[ "$1" = 1 || "$1" = 2 ]]; }
is_safe_path() { [[ "$1" = /* && "$1" != / && "$1" != *[[:space:]:\'\"]* ]]; }
is_repository() { [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?/[A-Za-z0-9_.-]{1,100}$ && "$1" != */. && "$1" != */.. ]]; }

# ask VAR "Question" DEFAULT VALIDATOR "Hint shown when the answer is invalid"
# Asks again until the validator accepts the answer (Enter takes the default).
ask() {
  local var=$1 question=$2 default=${3-} check=${4:-is_nonempty} hint=${5:-'Please enter a valid value.'} reply
  while true; do
    if [[ -n "$default" ]]; then printf '%s [%s]: ' "$question" "$default" >/dev/tty
    else printf '%s: ' "$question" >/dev/tty; fi
    IFS= read -r reply </dev/tty || die 'No terminal input; run this in an interactive terminal.'
    reply=${reply%$'\r'}
    reply=${reply:-$default}
    if "$check" "$reply"; then printf -v "$var" '%s' "$reply"; return 0; fi
    printf '  %s\n' "$hint" >/dev/tty
  done
}

# ask_secret VAR "Question": hidden input, asked again until it can be stored.
ask_secret() {
  local var=$1 question=$2 reply
  while true; do
    printf '%s: ' "$question" >/dev/tty
    IFS= read -r -s reply </dev/tty || die 'No terminal input; run this in an interactive terminal.'
    printf '\n' >/dev/tty
    reply=${reply%$'\r'}
    if is_env_value "$reply"; then printf -v "$var" '%s' "$reply"; return 0; fi
    printf "  A value is required, without ' or \\\\ characters.\n" >/dev/tty
  done
}

# confirm "Question" Y|N: succeeds on yes. The default is taken on Enter.
confirm() {
  local question=$1 default=${2:-N} reply
  while true; do
    if [[ "$default" = Y ]]; then printf '%s [Y/n]: ' "$question" >/dev/tty
    else printf '%s [y/N]: ' "$question" >/dev/tty; fi
    IFS= read -r reply </dev/tty || die 'No terminal input; run this in an interactive terminal.'
    reply=${reply%$'\r'}
    case "${reply:-$default}" in
      [Yy]|[Yy][Ee][Ss]) return 0 ;;
      [Nn]|[Nn][Oo]) return 1 ;;
    esac
    printf '  Answer y or n.\n' >/dev/tty
  done
}

# Values written by these scripts only; parsed, never sourced.
conf_get() {
  local file=$1 name=$2 value
  [[ -f "$file" ]] || return 0
  value=$(sed -n "s/^$name=//p" "$file" | tail -n 1 | tr -d '\r')
  value=${value#\'}; value=${value%\'}
  printf '%s' "$value"
}

conf_set() {
  local file=$1 name=$2 value=$3
  touch "$file"
  { grep -v "^$name=" "$file" || true; printf "%s='%s'\n" "$name" "$value"; } > "$file.new"
  chmod 600 "$file.new"
  mv -f "$file.new" "$file"
}

conf_unset() {
  local file=$1 name=$2
  [[ -f "$file" ]] || return 0
  { grep -v "^$name=" "$file" || true; } > "$file.new"
  chmod 600 "$file.new"
  mv -f "$file.new" "$file"
}

install_conf() { printf '%s/install.conf' "$SWW_DIR"; }

# The configuration directory recorded by the installer, else the default.
load_config_dir() {
  local recorded
  recorded=$(conf_get "$(install_conf)" SWW_CONFIG_DIR)
  SWW_CONFIG_DIR=${SWW_CONFIG_DIR:-${recorded:-$SWW_DEFAULT_CONFIG_DIR}}
  is_safe_path "$SWW_CONFIG_DIR" || die 'SWW_CONFIG_DIR must be an absolute path without spaces, quotes or colons.'
  export SWW_CONFIG_DIR
}

release_revision() {
  local dir=$1 revision
  revision=$(cat "$dir/.release" 2>/dev/null || git -C "$dir" rev-parse HEAD 2>/dev/null || true)
  [[ "$revision" =~ ^[a-f0-9]{40}$ ]] || die "Cannot tell which commit $dir contains (no .release file or Git history)."
  printf '%s' "$revision"
}

release_version() { printf 'vps-%s' "${1:0:12}"; }

# A published release (install.sh writes its image version to .release-version)
# pulls images from GitHub Packages; any other source is built on this server.
is_published_version() { [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+-[a-z0-9-]+\.[0-9]+\.[0-9a-f]{12}$ ]]; }
source_version() {
  local dir=$1 revision=$2 published
  published=$(cat "$dir/.release-version" 2>/dev/null || true)
  if [[ -z "$published" ]]; then release_version "$revision"; return 0; fi
  if ! is_published_version "$published" || [[ "${published: -12}" != "${revision:0:12}" ]]; then
    die "$dir/.release-version does not match its commit."
  fi
  printf '%s' "$published"
}

# Point compose.env at the images for VERSION: GitHub Packages for a published
# release, local names (compose.production.yml defaults) for a source build.
set_image_settings() {
  local file=$1 version=$2 repository=$3 prefix='' name
  if is_published_version "$version"; then
    prefix="ghcr.io/$(printf '%s' "${repository%%/*}" | tr '[:upper:]' '[:lower:]')/spaceworks-workspace"
  fi
  conf_set "$file" SWW_BACKEND_IMAGE "${prefix:+$prefix-backend}"
  conf_set "$file" SWW_FRONTEND_IMAGE "${prefix:+$prefix-frontend}"
  # Drop obsolete separate migration/operator image settings.
  for name in SWW_APP_IMAGE SWW_MIGRATOR_IMAGE SWW_OPS_IMAGE; do conf_unset "$file" "$name"; done
}

# Pull a published release's images, or build them from this source. The
# backend image also runs migrations and the operator tools; the frontend
# image is needed only by the split layout.
fetch_images() {
  local version=$1 layout=${2:-single} services=(app)
  [[ "$layout" != split ]] || services+=(frontend)
  if is_published_version "$version"; then
    ghcr_login
    say 'Downloading the release images from GitHub Packages.'
    compose pull --quiet "${services[@]}"
  else
    say 'Building images from source. This takes several minutes on a small server.'
    compose build "${services[@]}"
  fi
}

# One installer, updater, backup or restore at a time per installation. Child
# scripts run by a lock holder inherit the lock.
take_lock() {
  [[ ${SWW_LOCK_HELD:-0} != 1 ]] || return 0
  mkdir -p "$SWW_DIR"
  exec 9>"$SWW_DIR/.lock"
  if command -v flock >/dev/null; then
    flock -n 9 || die 'Another Space Works Workspace install, update, backup or restore is running.'
  fi
  export SWW_LOCK_HELD=1
}

# Copy a staged source release into $SWW_DIR/releases/<commit> and print its path.
# A release that is already in place is reused, taking the staged image version.
promote_release() {
  local source=$1 revision=$2 target="$SWW_DIR/releases/$2"
  case "$source/" in "$SWW_DIR/releases/"*) printf '%s' "$source"; return 0 ;; esac
  # Called in a command substitution, where errexit does not apply: check each step.
  if [[ ! -d "$target" ]]; then
    if ! { mkdir -p "$SWW_DIR/releases" && rm -rf "$target.partial" && cp -R "$source" "$target.partial" \
      && chown -R 0:0 "$target.partial" && chmod -R go-w "$target.partial" && mv "$target.partial" "$target"; }; then
      rm -rf "$target.partial"
      return 1
    fi
  elif [[ -f "$source/.release-version" ]]; then
    cp "$source/.release-version" "$target/.release-version" || return 1
  else
    rm -f "$target/.release-version" || return 1
  fi
  printf '%s' "$target"
}

activate_release() {
  ln -sfn "$1" "$SWW_DIR/current.new"
  mv -Tf "$SWW_DIR/current.new" "$SWW_DIR/current"
}

# A TCP port with a listener on this host (IPv4 or IPv6).
port_in_use() {
  local hex file
  printf -v hex '%04X' "$1"
  for file in /proc/net/tcp /proc/net/tcp6; do
    [[ -r "$file" ]] || continue
    awk -v wanted="$hex" 'NR > 1 { split($2, address, ":"); if (toupper(address[2]) == wanted && $4 == "0A") found = 1 } END { exit !found }' "$file" && return 0
  done
  return 1
}

free_disk_mb() {
  local path=$1
  while [[ ! -e "$path" ]]; do path=$(dirname "$path"); done
  df -Pm "$path" | awk 'NR == 2 { print $4 }'
}

memory_mb() { awk '/^MemTotal:/ { print int($2 / 1024) }' /proc/meminfo; }
swap_mb() { awk '/^SwapTotal:/ { print int($2 / 1024) }' /proc/meminfo; }

# Building the Next.js image needs roughly 4 GB of memory; small VPS plans get swap.
# Some hosts (OpenVZ/LXC containers, some btrfs roots) refuse swap files: warn and go on.
create_swap() {
  local file=/swapfile size_mb=$1
  say "Creating a ${size_mb} MB swap file at $file."
  if [[ $(stat -f -c %T / 2>/dev/null) = btrfs ]] && command -v btrfs >/dev/null; then
    btrfs filesystem mkswapfile --size "${size_mb}m" "$file" >/dev/null 2>&1 || true
  else
    if { fallocate -l "${size_mb}M" "$file" 2>/dev/null || dd if=/dev/zero of="$file" bs=1M count="$size_mb" status=none; } \
      && chmod 600 "$file"; then
      mkswap "$file" >/dev/null 2>&1 || true
    fi
  fi
  if [[ -f "$file" ]] && swapon "$file" 2>/dev/null; then
    grep -q "^$file " /etc/fstab || printf '%s none swap sw 0 0\n' "$file" >> /etc/fstab
  else
    rm -f "$file"
    warn 'This server does not allow a swap file; the image build may run out of memory.'
  fi
}

# Install distribution packages with the family's package manager.
install_packages() {
  # shellcheck disable=SC1091
  ( . /etc/os-release
    case " ${ID:-} ${ID_LIKE:-} " in
      *" debian "*|*" ubuntu "*) export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq "$@" ;;
      *" fedora "*|*" rhel "*|*" centos "*|*" rocky "*|*" almalinux "*) dnf install -y "$@" 2>/dev/null || yum install -y "$@" ;;
      *" arch "*|*" manjaro "*) pacman -Syu --noconfirm --needed "$@" ;;
      *" suse "*|*" opensuse "*|*" sles "*) zypper --non-interactive install "$@" ;;
      *) exit 1 ;;
    esac ) || die "Could not install $*; install it with your package manager, then rerun."
}

has_systemd() { command -v systemctl >/dev/null && [[ -d /run/systemd/system ]]; }

# Backup settings (schedule, retention, encryption recipient, off-site bucket):
# owner-only, beside the other configuration, parsed with conf_get.
backup_env() { printf '%s/backup.env' "$SWW_CONFIG_DIR"; }
# Non-secret status the app reads (mounted read-only at /status).
status_dir() { printf '%s/status' "$SWW_CONFIG_DIR"; }

# install_timer NAME "Description" ONCALENDAR SCRIPT [ARGS...]: a systemd timer
# that runs a script of the current release as root. The unit names the
# current symlink, so updates never need to rewrite it.
install_timer() {
  local name=$1 description=$2 calendar=$3 script=$4 arg command
  shift 4
  command="/bin/bash $SWW_DIR/current/scripts/$script"
  for arg in "$@"; do command+=" $arg"; done
  cat > "/etc/systemd/system/sww-$name.service" <<EOF
[Unit]
Description=Space Works Workspace: $description
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
Environment=SWW_DIR=$SWW_DIR
ExecStart=$command
EOF
  cat > "/etc/systemd/system/sww-$name.timer" <<EOF
[Unit]
Description=Space Works Workspace: $description

[Timer]
OnCalendar=$calendar
RandomizedDelaySec=30m
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now "sww-$name.timer" >/dev/null 2>&1
}

remove_timer() {
  has_systemd || return 0
  systemctl disable --now "sww-$1.timer" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/sww-$1.timer" "/etc/systemd/system/sww-$1.service"
  systemctl daemon-reload
}

timer_enabled() { has_systemd && systemctl is-enabled --quiet "sww-$1.timer" 2>/dev/null; }

# Nightly backups (02:30 UTC plus up to 30 minutes) and a weekly check that
# renews the internal service certificates two months before they expire.
install_backup_timer() { install_timer backup 'nightly backup' '*-*-* 02:30:00 UTC' vps-backup.sh; }
install_certificate_timer() { install_timer certificates 'internal certificate renewal' 'Mon *-*-* 04:00:00 UTC' vps-renew-certs.sh --if-due; }

# The backend image of the installed release, which carries the operator tools.
backend_image() {
  local image
  image=$(conf_get "$SWW_CONFIG_DIR/compose.env" SWW_BACKEND_IMAGE)
  printf '%s:%s' "${image:-sww-backend}" "$(conf_get "$SWW_CONFIG_DIR/compose.env" SWW_VERSION)"
}

# The Silo image from the compose file: its `mc` client copies backups to and
# from S3 buckets without installing anything on the host.
silo_image() { sed -n 's/^[[:space:]]*image:[[:space:]]*\(pgsty\/silo:[^[:space:]]*\)[[:space:]]*$/\1/p' "$SWW_REPO_DIR/compose.production.yml" | head -n 1; }

is_https_endpoint() { [[ "$1" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?/?$ ]]; }
is_bucket() { [[ "$1" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]]; }
is_region() { [[ "$1" =~ ^[a-z0-9-]{1,32}$ ]]; }
is_days() { [[ "$1" =~ ^[1-9][0-9]{0,3}$ ]]; }
is_prefix() { [[ "$1" =~ ^[A-Za-z0-9._-]{1,64}$ ]]; }

urlencode() {
  local value=$1 out='' char i
  for ((i = 0; i < ${#value}; i++)); do
    char=${value:i:1}
    case $char in
      [A-Za-z0-9._~-]) out+=$char ;;
      *) printf -v char '%%%02X' "'$char"; out+=$char ;;
    esac
  done
  printf '%s' "$out"
}

# run_mc [DOCKER OPTIONS...] IMAGE MC-ARGS...: the mc client with the off-site
# bucket as alias `offsite`. The credentials travel in the environment, never
# on a command line.
run_mc() {
  local file endpoint
  file=$(backup_env)
  endpoint=$(conf_get "$file" OFFSITE_ENDPOINT)
  endpoint=${endpoint#https://}
  MC_HOST_offsite="https://$(urlencode "$(conf_get "$file" OFFSITE_ACCESS_KEY_ID)"):$(urlencode "$(conf_get "$file" OFFSITE_SECRET_ACCESS_KEY)")@${endpoint%/}" \
    docker run --rm --env MC_HOST_offsite --entrypoint mc "$@"
}
offsite_path() {
  local file
  file=$(backup_env)
  printf 'offsite/%s/%s' "$(conf_get "$file" OFFSITE_BUCKET)" "$(conf_get "$file" OFFSITE_PREFIX)"
}

# ask_offsite: the off-site bucket questions (answers in offsite_* variables).
ask_offsite() {
  cat >/dev/tty <<'EOF'

Off-site copies go to an S3-compatible bucket at another provider (Cloudflare R2,
Backblaze B2, Amazon S3...). Create a private bucket and a key limited to it.
EOF
  ask offsite_endpoint 'Off-site S3 endpoint' '' is_https_endpoint 'Enter the HTTPS endpoint, such as https://<account>.r2.cloudflarestorage.com.'
  offsite_endpoint=${offsite_endpoint%/}
  ask offsite_bucket 'Off-site bucket' '' is_bucket 'Enter a bucket name: lowercase letters, digits, dots and hyphens.'
  ask offsite_prefix 'Folder in the bucket' spaceworks-workspace is_prefix 'Use letters, digits, dots, hyphens and underscores.'
  ask offsite_key 'Access key ID' '' is_env_value "Enter the access key, without ' or \\ characters."
  ask_secret offsite_secret 'Secret access key (hidden)'
  ask offsite_days 'Days to keep off-site copies' 90 is_days 'Enter a number of days.'
}

# shellcheck disable=SC2154 # ask_offsite assigns these by name
save_offsite() {
  local file=${1:-$(backup_env)}
  conf_set "$file" OFFSITE_ENDPOINT "$offsite_endpoint"
  conf_set "$file" OFFSITE_BUCKET "$offsite_bucket"
  conf_set "$file" OFFSITE_PREFIX "$offsite_prefix"
  conf_set "$file" OFFSITE_ACCESS_KEY_ID "$offsite_key"
  conf_set "$file" OFFSITE_SECRET_ACCESS_KEY "$offsite_secret"
  conf_set "$file" OFFSITE_KEEP_DAYS "$offsite_days"
}

clear_offsite() {
  local name
  for name in OFFSITE_ENDPOINT OFFSITE_BUCKET OFFSITE_PREFIX OFFSITE_ACCESS_KEY_ID OFFSITE_SECRET_ACCESS_KEY OFFSITE_KEEP_DAYS; do
    conf_unset "$(backup_env)" "$name"
  done
}

# The age tool encrypts backups to a public key; only its private key, kept
# off this server, can decrypt them.
ensure_age() {
  command -v age >/dev/null && command -v age-keygen >/dev/null && return 0
  say 'Installing age (backup encryption) from the distribution packages.'
  ( install_packages age ) >/dev/null 2>&1 || true
  command -v age >/dev/null && command -v age-keygen >/dev/null
}

# new_backup_key: create an age key pair, save the public recipient and show
# the private key once. It is never written to this server.
new_backup_key() {
  local identity recipient answer
  identity=$(age-keygen 2>/dev/null)
  recipient=$(printf '%s\n' "$identity" | age-keygen -y)
  [[ "$recipient" =~ ^age1[a-z0-9]{58}$ ]] || die 'age-keygen did not produce a key.'
  conf_set "$(backup_env)" BACKUP_AGE_RECIPIENT "$recipient"
  cat >/dev/tty <<EOF

Backup encryption key. Store it now in your password manager or another
safe place OFF this server. It is shown only this once and is not saved here.
Without it, encrypted backups cannot be restored.

$(printf '%s\n' "$identity" | grep '^AGE-SECRET-KEY-')

EOF
  while true; do
    printf 'Type SAVED once the key is stored safely: ' >/dev/tty
    IFS= read -r answer </dev/tty || die 'No terminal input.'
    [[ "${answer%$'\r'}" != SAVED ]] || break
  done
  printf '\033[2J\033[H' >/dev/tty
}

# These scripts never attach a terminal to a container: the installer runs them
# with stdin from /dev/null, and Compose refuses a TTY without one.
compose() {
  case "${1:-}" in
    run|exec) local command=$1; shift; sh "$SWW_REPO_DIR/scripts/vps-compose.sh" "$command" -T "$@" ;;
    *) sh "$SWW_REPO_DIR/scripts/vps-compose.sh" "$@" ;;
  esac
}

# Optional read-only credential for private source and container packages.
github() {
  if [[ -n "${SWW_GITHUB_TOKEN:-}" ]]; then
    [[ "$SWW_GITHUB_TOKEN" =~ ^[A-Za-z0-9_]+$ ]] || die 'Invalid SWW_GITHUB_TOKEN.'
    printf 'header = "Authorization: Bearer %s"\n' "$SWW_GITHUB_TOKEN" | curl --config - --fail --silent --show-error --location --proto '=https' "$@"
  else curl --fail --silent --show-error --location --proto '=https' "$@"; fi
}
ghcr_login() {
  [[ -n "${SWW_GITHUB_TOKEN:-}" ]] || return 0
  local login=${SWW_GITHUB_USER:-}
  if [[ -z "$login" ]]; then
    login=$(github https://api.github.com/user | sed -n 's/^[[:space:]]*"login"[[:space:]]*:[[:space:]]*"\([A-Za-z0-9-]*\)".*/\1/p' | head -n 1)
  fi
  [[ "$login" =~ ^[A-Za-z0-9][A-Za-z0-9-]*$ ]] || die 'Set SWW_GITHUB_USER to the account that owns the registry token.'
  printf '%s' "$SWW_GITHUB_TOKEN" | docker login ghcr.io --username "$login" --password-stdin >/dev/null
}
