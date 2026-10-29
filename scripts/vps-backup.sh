#!/usr/bin/env bash
# Back up the database, the configuration and the uploaded objects into
# $SWW_CONFIG_DIR/backups/<UTC time>/. Full backups briefly pause app/worker/beat
# writers so the database snapshot and copied objects cannot diverge. Database-
# only backups use PostgreSQL's consistent snapshot while services keep running.
#   --no-objects  database and configuration only (used before updates)
# Settings live in $SWW_CONFIG_DIR/backup.env (installer menu: Backups):
#   BACKUP_KEEP_DAYS        days a backup stays on this server (default 14); the
#                           newest three of each kind are always kept
#   BACKUP_AGE_RECIPIENT    encrypt every backup to this age public key
#   OFFSITE_*               copy each backup to an S3 bucket (needs encryption)
# A systemd timer (sww-backup.timer) runs it nightly when scheduled. Each
# run records its outcome in $SWW_CONFIG_DIR/status/backup.json, which the
# super-admin Operations page shows and alerts on.
set -euo pipefail
set +x
source_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
# shellcheck source=scripts/vps-lib.sh
. "$source_dir/scripts/vps-lib.sh"
objects=1
case "${1:-}" in
  '') ;;
  --no-objects) objects=0 ;;
  *) die 'Usage: vps-backup.sh [--no-objects]' ;;
esac
require_root
load_config_dir
[[ -f "$SWW_CONFIG_DIR/compose.env" ]] || die "No installation configuration in $SWW_CONFIG_DIR."
settings=$(backup_env)
keep_days=$(conf_get "$settings" BACKUP_KEEP_DAYS)
keep_days=${keep_days:-14}
is_days "$keep_days" || die "BACKUP_KEEP_DAYS in $settings must be a number of days."
keep_min=${SWW_BACKUP_KEEP:-3}
[[ "$keep_min" =~ ^[1-9][0-9]*$ ]] || die 'SWW_BACKUP_KEEP must be a positive number.'
recipient=$(conf_get "$settings" BACKUP_AGE_RECIPIENT)
offsite_bucket=$(conf_get "$settings" OFFSITE_BUCKET)
[[ ! -d "$SWW_DIR" ]] || take_lock
SWW_REPO_DIR=$source_dir
# An external bucket keeps the uploads; back it up with your storage provider.
if [[ $objects = 1 && "$(conf_get "$SWW_CONFIG_DIR/compose.env" SWW_STORAGE)" = external ]]; then
  say 'Uploads are in the external bucket and are not copied; back it up with your storage provider.'
  objects=0
fi
kind=database
[[ $objects = 0 ]] || kind=full
backups="$SWW_CONFIG_DIR/backups"
name=$(date -u +%Y%m%dT%H%M%SZ)
target="$backups/$name"
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
offsite=off
paused_writers=()

pause_writers() {
  [[ $objects = 1 ]] || return 0
  local running service
  running=$(compose ps --services --status running) || return
  while IFS= read -r service; do
    case "$service" in app|worker|beat) paused_writers+=("$service") ;; esac
  done <<< "$running"
  ((${#paused_writers[@]} > 0)) || return 0
  say 'Pausing application and background writers for the full backup.'
  compose stop "${paused_writers[@]}"
}

resume_writers() {
  ((${#paused_writers[@]} > 0)) || return 0
  compose up -d --no-deps --wait --wait-timeout 300 "${paused_writers[@]}" || return
  paused_writers=()
}

# status.json carries no secrets; the app reads it through a read-only mount.
json_time() { if [[ -n "$1" ]]; then printf '"%s"' "$1"; else printf null; fi; }
write_status() {
  local outcome=$1 size=${2:-0} file previous success full scheduled=false encrypted=false
  file="$(status_dir)/backup.json"
  previous=$(cat "$file" 2>/dev/null || true)
  success=$(printf '%s' "$previous" | sed -n 's/.*"lastSuccessAt":"\([^"]*\)".*/\1/p')
  full=$(printf '%s' "$previous" | sed -n 's/.*"lastFullSuccessAt":"\([^"]*\)".*/\1/p')
  if [[ $outcome = ok ]]; then
    success=$started
    [[ $kind != full ]] || full=$started
  fi
  ! timer_enabled backup || scheduled=true
  [[ -z "$recipient" ]] || encrypted=true
  ( umask 022
    mkdir -p "$(status_dir)"
    chmod 755 "$(status_dir)"
    printf '{"version":1,"lastAttemptAt":"%s","lastStatus":"%s","lastKind":"%s","lastSuccessAt":%s,"lastFullSuccessAt":%s,"sizeBytes":%s,"encrypted":%s,"offsite":"%s","scheduled":%s,"keepDays":%s}\n' \
      "$started" "$outcome" "$kind" "$(json_time "$success")" "$(json_time "$full")" "$size" "$encrypted" "$offsite" "$scheduled" "$keep_days" \
      > "$file.new"
    mv -f "$file.new" "$file" )
}
on_exit() {
  local status=$?
  set +e
  if [[ $status != 0 ]]; then
    rm -rf -- "$target.partial"
    write_status failed || true
  fi
  if ! resume_writers; then
    warn 'The backup stopped application writers, but they could not all restart. Run scripts/vps-compose.sh up -d --wait and check service health.'
    write_status failed || true
    status=1
  fi
  exit "$status"
}
trap on_exit EXIT

umask 077
mkdir -p "$target.partial"
pause_writers
compose exec postgres pg_dump -U sww -d sww -Fc > "$target.partial/database.dump"
compose exec postgres pg_restore --list < "$target.partial/database.dump" > /dev/null
tar --exclude=./backups -czf "$target.partial/config.tar.gz" -C "$SWW_CONFIG_DIR" .
if [[ $objects = 1 ]]; then
  compose run --rm --no-deps --volume "$target.partial:/backup" --entrypoint mc storage-init \
    mirror --quiet local/spaceworks-workspace /backup/objects > /dev/null
fi
# Encryption, off-site transfer and retention do not need a write pause.
resume_writers
conf_get "$SWW_CONFIG_DIR/compose.env" SWW_VERSION > "$target.partial/version"
printf '%s\n' "$kind" > "$target.partial/kind"
# Encrypted backups keep only `version` and `kind` readable; everything else
# goes into backup.tar.age, which only the off-server private key opens.
if [[ -n "$recipient" ]]; then
  command -v age >/dev/null || die 'Backups are set to be encrypted, but age is not installed. Install it (package "age") and rerun.'
  # Create the excluded output before tar reads its parent directory metadata.
  # Creating it concurrently in the pipeline can make GNU tar reject the backup.
  : > "$target.partial/backup.tar.age"
  tar -cf - -C "$target.partial" --exclude=./version --exclude=./kind --exclude=./backup.tar.age . \
    | age --encrypt --recipient "$recipient" > "$target.partial/backup.tar.age"
  find "$target.partial" -mindepth 1 -maxdepth 1 ! -name backup.tar.age ! -name version ! -name kind -exec rm -rf -- {} +
fi
mv "$target.partial" "$target"
say "Backup saved to $target ($(du -sh "$target" | cut -f1))."

# Off-site copy: only encrypted backups leave this server.
if [[ -n "$offsite_bucket" ]]; then
  [[ -n "$recipient" ]] || die 'Off-site copies need encrypted backups. Turn on encryption in the installer menu (Backups).'
  image=$(silo_image)
  offsite=failed
  say "Copying the backup to the off-site bucket $offsite_bucket."
  run_mc --volume "$target:/backup:ro" "$image" mirror --quiet /backup "$(offsite_path)/$name" > /dev/null
  run_mc "$image" stat "$(offsite_path)/$name/backup.tar.age" > /dev/null
  offsite_days=$(conf_get "$settings" OFFSITE_KEEP_DAYS)
  if is_days "${offsite_days:-}"; then
    run_mc "$image" rm --recursive --force --older-than "${offsite_days}d" "$(offsite_path)/" > /dev/null || warn 'Old off-site backups could not be pruned.'
  fi
  offsite=ok
fi

# Retention covers backups made by this script only: a backup goes once it is
# older than BACKUP_KEEP_DAYS and is not among the newest of its kind. Full
# and database-only backups are counted separately, so updates never push out
# the last copy of the uploads, and SWW_BACKUP_PROTECT (a restore's source) is
# never removed.
cutoff=$(date -u -d "-$keep_days days" +%Y%m%dT%H%M%SZ)
full=() database_only=()
while IFS= read -r dir; do
  [[ "$(basename "$dir")" != "$(basename "${SWW_BACKUP_PROTECT:-/}")" ]] || continue
  if [[ -d "$dir/objects" || "$(cat "$dir/kind" 2>/dev/null)" = full ]]; then full+=("$dir"); else database_only+=("$dir"); fi
done < <(find "$backups" -mindepth 1 -maxdepth 1 -type d -name '2*Z' | sort -r)
for dir in "${full[@]:keep_min}" "${database_only[@]:keep_min}"; do
  [[ "$(basename "$dir")" < "$cutoff" ]] || continue
  rm -rf -- "$dir"
done
write_status ok "$(du -sb "$target" | cut -f1)"
if [[ -z "$recipient" ]]; then
  say 'It contains every secret, unencrypted. Turn on encryption and off-site copies in the installer menu (Backups).'
elif [[ -z "$offsite_bucket" ]]; then
  say 'It is encrypted. Copy it off this server too, or set up off-site copies in the installer menu (Backups).'
fi
