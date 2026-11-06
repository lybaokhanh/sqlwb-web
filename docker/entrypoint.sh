#!/bin/sh
# Starts the app. An updated engine in /data/wb/current wins over the one in the image.
set -e
WB=/opt/wb
if [ -f /data/wb/current/sqlworkbench.jar ]; then
  WB=/data/wb/current
fi
CP="/opt/app/lib/*:$WB/sqlworkbench.jar:$WB/ext/*"
exec java $JAVA_OPTS -Dsqlwb.wbdir="$WB" -cp "$CP" local.sqlwb.App
