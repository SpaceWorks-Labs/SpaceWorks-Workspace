#!/bin/sh
# Host bootstrap inputs may be private to the installer. Stage the files read
# after PostgreSQL drops privileges under the postgres account.
set -eu
mkdir -p /var/lib/postgresql/tls /var/lib/postgresql/bootstrap /docker-entrypoint-initdb.d
cp /run/server-tls/public.crt /var/lib/postgresql/tls/server.crt
cp /run/server-tls/private.key /var/lib/postgresql/tls/server.key
cp /bootstrap/pg_hba.conf /var/lib/postgresql/bootstrap/pg_hba.conf
cp /bootstrap/init-database.sh /docker-entrypoint-initdb.d/10-app-role.sh
chown -R postgres:postgres /var/lib/postgresql/tls /var/lib/postgresql/bootstrap
chown postgres:postgres /docker-entrypoint-initdb.d/10-app-role.sh
chmod 700 /var/lib/postgresql/tls /var/lib/postgresql/bootstrap /docker-entrypoint-initdb.d/10-app-role.sh
chmod 600 /var/lib/postgresql/tls/server.key /var/lib/postgresql/bootstrap/pg_hba.conf
exec /usr/local/bin/docker-entrypoint.sh postgres \
  -c ssl=on -c ssl_cert_file=/var/lib/postgresql/tls/server.crt \
  -c ssl_key_file=/var/lib/postgresql/tls/server.key \
  -c hba_file=/var/lib/postgresql/bootstrap/pg_hba.conf
