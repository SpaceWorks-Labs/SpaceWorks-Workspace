#!/usr/bin/env bash
# Restore the database, and the uploaded objects when the backup has them, from
# a backup made by vps-backup.sh. This replaces live data: the app, Caddy and
# worker and beat stop until the restore finishes, and a fresh database backup is
# taken first. The configuration archive in the backup is not applied here; on a
# new server restore it before setup (see docs/DEPLOYMENT_VPS.md).
#   vps-restore.sh BACKUP [--identity FILE] [--yes]
# BACKUP is a directory in $SWW_CONFIG_DIR/backups, or offsite:<name> to fetch
# one from the off-site bucket first. An encrypted backup (backup.tar.age) needs
# its age private key: --identity FILE, or paste it when asked.
# shellcheck disable=SC2154 # ask assigns answers by name
set -euo pipefail
set +x
source_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
# shellcheck source=scripts/vps-lib.sh
. "$source_dir/scripts/vps-lib.sh"
usage() { die 'Usage: vps-restore.sh BACKUP_DIRECTORY|offsite:NAME [--identity FILE] [--yes]'; }
backup=${1:-}
[[ -n "$backup" ]] || usage
shift
assume_yes=0 identity=''
while (($# > 0)); do
  case "$1" in
    --yes) assume_yes=1 ;;
    --identity) (($# > 1)) || usage; identity=$2; shift ;;
    *) usage ;;
  esac
  shift
done
require_root
load_config_dir
[[ -f "$SWW_CONFIG_DIR/compose.env" ]] || die "No installation configuration in $SWW_CONFIG_DIR."
[[ ! -d "$SWW_DIR" ]] || take_lock
SWW_REPO_DIR=$source_dir
umask 077
# A pasted key and a decrypted copy live under backups/, which the safety backup
# taken before the restore never archives, and are removed on exit.
mkdir -p "$SWW_CONFIG_DIR/backups"
work='' key_file=''
stopped=0 database_committed=0
cleanup() {
  local status=$?
  set +e
  [[ -z "$work" ]] || rm -rf -- "$work"
  [[ -z "$key_file" ]] || rm -f -- "$key_file"
  if [[ $status != 0 && $stopped = 1 ]]; then
    if [[ $database_committed = 1 ]]; then
      # Objects, migrations or readiness can fail after SQL committed. A partly
      # restarted deployment must not serve that incomplete recovered state.
      compose stop "${serving[@]}" >/dev/null 2>&1 || warn 'Could not stop every serving process; stop them before accepting traffic.'
      warn 'The database restore committed, but recovery did not finish. Serving processes remain stopped. Fix the failure and rerun the complete restore before starting the site.'
    else
      warn 'The database restore did not commit; starting the previous services again.'
      compose up -d >/dev/null 2>&1 || warn 'Start them with scripts/vps-compose.sh up -d.'
    fi
  fi
  exit "$status"
}
trap cleanup EXIT

if [[ "$backup" = offsite:* ]]; then
  name=${backup#offsite:}
  [[ "$name" =~ ^2[0-9]{7}T[0-9]{6}Z$ ]] || die 'Name an off-site backup by its time, such as offsite:20261020T023512Z.'
  [[ -n "$(conf_get "$(backup_env)" OFFSITE_BUCKET)" ]] || die 'No off-site bucket is configured.'
  backup="$SWW_CONFIG_DIR/backups/$name"
  if [[ ! -d "$backup" ]]; then
    say "Downloading $name from the off-site bucket."
    mkdir -p "$backup.partial"
    run_mc --volume "$backup.partial:/backup" "$(silo_image)" mirror --quiet "$(offsite_path)/$name" /backup > /dev/null
    mv "$backup.partial" "$backup"
  fi
fi
backup=$(CDPATH='' cd -- "$backup" 2>/dev/null && pwd) || die 'The backup directory does not exist.'
source_backup=$backup
if [[ -f "$backup/backup.tar.age" ]]; then
  command -v age >/dev/null || ensure_age || die 'Restoring an encrypted backup needs age. Install the "age" package and rerun.'
  if [[ -z "$identity" ]]; then
    [[ $assume_yes = 0 ]] || die 'This backup is encrypted; pass its key file with --identity FILE.'
    require_tty
    is_age_key() { [[ "$1" =~ ^AGE-SECRET-KEY-1[A-Z0-9]{58}$ ]]; }
    while true; do
      ask_secret age_key 'Paste the backup encryption key (AGE-SECRET-KEY-..., hidden)'
      is_age_key "$age_key" && break
      printf '  That is not an age secret key.\n' >/dev/tty
    done
    key_file=$(mktemp "$SWW_CONFIG_DIR/backups/.restore-key.XXXXXX")
    printf '%s\n' "$age_key" > "$key_file"
    unset age_key
    identity=$key_file
  fi
  [[ -r "$identity" ]] || die "Cannot read the key file $identity."
  work=$(mktemp -d "$SWW_CONFIG_DIR/backups/.restore.XXXXXX")
  say 'Decrypting the backup.'
  age --decrypt --identity "$identity" < "$backup/backup.tar.age" | tar -xf - -C "$work" \
    || die 'The backup could not be decrypted with that key.'
  cp "$backup/version" "$work/version" 2>/dev/null || true
  backup=$work
fi
[[ -s "$backup/database.dump" ]] || die "$source_backup has no database.dump; choose a backup made by vps-backup.sh."
has_objects=0
[[ ! -d "$backup/objects" ]] || has_objects=1
# Files are put back only into the bundled Silo; an external bucket is the provider's.
[[ "$(conf_get "$SWW_CONFIG_DIR/compose.env" SWW_STORAGE)" != external ]] || has_objects=0
# The services that serve requests, as this installation runs them.
serving=(app worker beat)
[[ "$(conf_get "$SWW_CONFIG_DIR/compose.env" SWW_CADDY_TLS)" = proxy ]] || serving+=(proxy)
[[ "$(conf_get "$SWW_CONFIG_DIR/compose.env" SWW_LAYOUT)" != split ]] || serving+=(frontend)
if [[ $assume_yes = 0 ]]; then
  require_tty
  {
    printf '\nRestore %s\n' "$source_backup"
    printf '  Backed up from: %s\n' "$(cat "$backup/version" 2>/dev/null || echo 'unknown release')"
    printf '  Database:       replaced with the backup (accounts, workspaces, tasks and messages)\n'
    if [[ $has_objects = 1 ]]; then printf '  Uploads:        files from the backup are put back; newer files stay\n'
    else printf '  Uploads:        not in this backup; left as they are\n'; fi
    printf 'The site is offline during the restore. A backup of the current database is taken first.\n\n'
  } >/dev/tty
  ask answer 'Type RESTORE to continue' '' is_nonempty
  [[ "$answer" = RESTORE ]] || { say 'Cancelled. Nothing was changed.'; exit 2; }
fi
SWW_BACKUP_PROTECT=$source_backup bash "$SWW_REPO_DIR/scripts/vps-backup.sh" --no-objects
# Materialize the complete restore before stopping services or executing any SQL.
# A producer failure in a pg_restore | psql pipeline could otherwise commit a
# valid but truncated prefix when psql reaches EOF. Work stays private and is
# excluded from safety backups by living beneath backups/.
[[ -n "$work" ]] || work=$(mktemp -d "$SWW_CONFIG_DIR/backups/.restore.XXXXXX")
restore_sql="$work/restore.sql"
{
  cat <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public AUTHORIZATION sww;
SQL
  # A custom archive can define public itself. Exclude only that definition:
  # its separate COMMENT and ACL entries still restore, and sww owns the schema.
  # The private container scratch directory needs no extra host bind mount.
  # shellcheck disable=SC2016 # Expanded by the container's shell.
  compose exec postgres sh -c '
    set -eu
    umask 077
    stage=$(mktemp -d)
    trap '\''rm -rf -- "$stage"'\'' EXIT
    cat > "$stage/archive.dump"
    pg_restore --list "$stage/archive.dump" > "$stage/contents"
    awk "\$4 == \"SCHEMA\" && \$5 == \"-\" && \$6 == \"public\" { print \";\" \$0; next } { print }" \
      "$stage/contents" > "$stage/restore.list"
    pg_restore --file=- --exit-on-error --use-list="$stage/restore.list" "$stage/archive.dump"
  ' < "$backup/database.dump"
  cat <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC, sww_app;
GRANT CONNECT ON DATABASE sww TO sww_app;
GRANT USAGE ON SCHEMA public TO sww_app;
ALTER DEFAULT PRIVILEGES FOR ROLE sww IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sww_app;
ALTER DEFAULT PRIVILEGES FOR ROLE sww IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO sww_app;
SQL
} > "$restore_sql"
# A failed restore must not leave the site down; the database restore is one
# transaction, so a failure there keeps the current data.
stopped=1
compose stop "${serving[@]}"
compose exec postgres psql -X -U sww -d sww --single-transaction --set ON_ERROR_STOP=1 --file=- \
  < "$restore_sql"
database_committed=1
if [[ $has_objects = 1 ]]; then
  compose run --rm --no-deps --volume "$backup:/backup:ro" --entrypoint mc storage-init \
    mirror --overwrite --quiet /backup/objects local/spaceworks-workspace > /dev/null
fi
# Migrations bring an older backup up to this release before the app starts.
compose up -d --wait --wait-timeout 300
compose run --rm --no-deps ops node docker/vps/check.mjs
stopped=0
say 'Restore finished. Sign in and check workspaces, tasks and uploads.'
