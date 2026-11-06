#!/bin/sh
# Deploys sqlwb-web on a Docker host. Run on the host:
#   sh deploy.sh <site.env> [image.tar | --rollback]
# <site.env>: copy of config.example/sqlwb.env.example with your values.
# Without image.tar the image SQLWB_IMAGE is pulled (for example from ghcr.io).
# Exit 0 = /api/health returned 200. On failure the old container (if any) is started again.
set -eu
ENV_FILE=${1:?site env file}
TAR=${2:-}
[ -f "$ENV_FILE" ] || { echo "No such file: $ENV_FILE" >&2; exit 1; }

# Read KEY=value lines (no shell evaluation, values may hold regex characters)
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ''|'#'*) continue ;; esac
  key=${line%%=*}
  case "$key" in SQLWB_IMAGE|SQLWB_NAME|SQLWB_PORT|SQLWB_VOLUME|CPUS|MEM|DNS_SEARCH) eval "$key=\${line#*=}" ;; esac
done < "$ENV_FILE"
IMAGE=${SQLWB_IMAGE:?SQLWB_IMAGE missing in $ENV_FILE}
NAME=${SQLWB_NAME:-sqlwb-web}
PORT=${SQLWB_PORT:-8484}
VOLUME=${SQLWB_VOLUME:-sqlwb-data}
CPUS=${CPUS:-2}
MEM=${MEM:-3g}
DNS_SEARCH=${DNS_SEARCH:-}

echo "== checks"
docker version --format 'Docker {{.Server.Version}}'
if ss -ltn | grep -q ":$PORT " && ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  echo "Port $PORT is used by another process. Stop." >&2; exit 1
fi

if [ "$TAR" = "--rollback" ]; then
  IMAGE="$NAME:prev"
  docker image inspect "$IMAGE" >/dev/null 2>&1 || { echo "No rollback image $IMAGE" >&2; exit 1; }
  echo "== rollback to $IMAGE"
else
  echo "== keep the running image as rollback ($NAME:prev)"
  if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
    docker tag "$(docker inspect --format '{{.Image}}' "$NAME")" "$NAME:prev"
  fi
fi

if [ "$TAR" = "--rollback" ]; then
  :
elif [ -n "$TAR" ]; then
  echo "== load image from $TAR"
  docker load -i "$TAR"
else
  echo "== pull $IMAGE"
  docker pull "$IMAGE"
fi

echo "== replace container"
if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  docker rm -f "$NAME-old" >/dev/null 2>&1 || true
  docker rename "$NAME" "$NAME-old"
  docker stop "$NAME-old" >/dev/null
fi
docker volume create "$VOLUME" >/dev/null
set -- --cpus "$CPUS" --memory "$MEM"
if [ -n "$DNS_SEARCH" ]; then set -- "$@" --dns-search "$DNS_SEARCH" --dns-option ndots:1; fi
docker run -d --name "$NAME" --restart unless-stopped "$@" \
  -p "$PORT:8484" -v "$VOLUME:/data" --env-file "$ENV_FILE" \
  "$IMAGE" >/dev/null

echo "== health"
i=0
while [ $i -lt 30 ]; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/api/health" || true)
  if [ "$code" = 200 ]; then
    echo "PASS health 200 after ~$((i / 2)) s"
    curl -s "http://localhost:$PORT/api/version"; echo
    docker rm "$NAME-old" >/dev/null 2>&1 || true
    exit 0
  fi
  i=$((i + 1)); sleep 0.5
done

echo "FAIL: no health 200 after 15 s. Logs:" >&2
docker logs --tail 40 "$NAME" >&2 || true
docker rm -f "$NAME" >/dev/null
if docker ps -a --format '{{.Names}}' | grep -qx "$NAME-old"; then
  docker rename "$NAME-old" "$NAME" && docker start "$NAME" >/dev/null && echo "Old container started again" >&2
fi
exit 1
