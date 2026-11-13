#!/usr/bin/env bash
# Build locally and upload to the droplet, then restart the server there.
#   deploy/push.sh root@203.0.113.7          upload, install dependencies and restart
#   deploy/push.sh root@203.0.113.7 --first  upload only, before running deploy/setup.sh once
# Games in progress survive the restart through their saves.
set -euo pipefail

host="${1:?usage: deploy/push.sh user@droplet [--first]}"
cd "$(dirname "$0")/.."

# The build includes frontend/public, so the local official art goes to this private droplet.
npm run build --workspace frontend

# A checkout without the art (such as CI, since the art is not in git) must not delete the
# art already on the droplet: excluded paths are neither sent nor deleted by --delete.
keep_art=()
if [ ! -d frontend/dist/assets/official ]; then
  keep_art=(--exclude /dist/assets/official/)
  echo "This build has no official art; the art already on the droplet is kept."
fi

ssh "$host" 'mkdir -p /opt/battlegrounds/frontend /opt/battlegrounds/vendor'
# Only changed files are sent; the first upload of the art takes a while.
rsync -az --delete --exclude __pycache__ --exclude tests backend deploy "$host:/opt/battlegrounds/"
rsync -az --delete vendor/wheels "$host:/opt/battlegrounds/vendor/"
rsync -az --delete "${keep_art[@]+"${keep_art[@]}"}" frontend/dist "$host:/opt/battlegrounds/frontend/"

if [ "${2:-}" = "--first" ]; then
  echo "Uploaded. Now run on the droplet: bash /opt/battlegrounds/deploy/setup.sh"
  exit 0
fi

ssh "$host" 'set -e
  cd /opt/battlegrounds
  .venv/bin/pip install -q -r backend/requirements.txt
  install -m 644 deploy/battlegrounds.service /etc/systemd/system/battlegrounds.service
  systemctl daemon-reload
  systemctl restart battlegrounds
  sleep 2
  curl -fsS http://127.0.0.1:8000/api/scenarios >/dev/null && echo "Deployed and running."'
