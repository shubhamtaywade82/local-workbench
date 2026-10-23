#!/bin/sh
# Runs as root after the .deb is unpacked. Installs the `local-workbench` command
# and makes Electron's sandbox helper setuid root. Ubuntu 24.04 and recent WSL
# images restrict unprivileged user namespaces, which the helper otherwise needs.
set -e

APP_DIR="/opt/Local Workbench"
if [ -f "$APP_DIR/chrome-sandbox" ]; then
  chown root:root "$APP_DIR/chrome-sandbox"
  chmod 4755 "$APP_DIR/chrome-sandbox"
fi

cat > /usr/bin/local-workbench <<'WRAPPER'
#!/bin/sh
exec env ELECTRON_RUN_AS_NODE=1 "/opt/Local Workbench/local-workbench" "/opt/Local Workbench/resources/app/bin/local-workbench.mjs" "$@"
WRAPPER
chmod 755 /usr/bin/local-workbench
