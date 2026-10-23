#!/bin/sh
# Removes the command installed by after-install.sh.
set -e
if [ -f /usr/bin/local-workbench ] && grep -q "Local Workbench" /usr/bin/local-workbench; then
  rm -f /usr/bin/local-workbench
fi
