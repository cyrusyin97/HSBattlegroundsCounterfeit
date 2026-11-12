#!/usr/bin/env bash
# One-time droplet preparation. Run on the droplet as root, after deploy/push.sh has copied the
# files once:   bash /opt/battlegrounds/deploy/setup.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root." >&2
  exit 1
fi
if [ "$(uname -m)" != "x86_64" ]; then
  echo "The vendored engine wheel is built for x86_64; this machine is $(uname -m)." >&2
  exit 1
fi

apt-get update
apt-get install -y python3 python3-venv rsync curl

if ! python3 -c 'import sys; sys.exit(sys.version_info < (3, 11))'; then
  echo "Python 3.11 or newer is required; this system has $(python3 --version)." >&2
  echo "Use Ubuntu 24.04 or Debian 12 or newer." >&2
  exit 1
fi

# The service runs as an unprivileged user with no login shell and no home directory.
id battlegrounds >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin battlegrounds

cd /opt/battlegrounds
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r backend/requirements.txt

install -m 644 deploy/battlegrounds.service /etc/systemd/system/battlegrounds.service
systemctl daemon-reload
systemctl enable --now battlegrounds
sleep 2
systemctl --no-pager status battlegrounds | head -5
curl -fsS http://127.0.0.1:8000/api/scenarios >/dev/null && echo "Game server is running on 127.0.0.1:8000."
