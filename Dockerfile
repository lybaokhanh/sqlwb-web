# syntax=docker/dockerfile:1
# sqlwb-web: SQL Workbench/J as a web app. Build: docker compose build
ARG WB_BUILD=133

# 1. Engine: SQL Workbench/J built from source (codeberg.org/sql-workbench/workbench, tag buildNNN).
#    Ant target "jar" is the release jar (manifest WbBuild-Number). ext/ = the "with-optional-libs" set (no log4j-core).
FROM eclipse-temurin:21-jdk-alpine AS wb
ARG WB_BUILD
RUN apk add --no-cache git apache-ant unzip zip
RUN git clone -q --depth 1 --branch "build${WB_BUILD}" https://codeberg.org/sql-workbench/workbench.git /src/wb
WORKDIR /src/wb/scripts
RUN --mount=type=cache,target=/root/.m2 \
    ant -q -Dbuild.number=${WB_BUILD} jar copy-libs \
 && mkdir -p /opt/wb/ext && cp ../dist/sqlworkbench.jar /opt/wb/ \
 && cp ../dist/libs/*.jar /opt/wb/ext/ && rm /opt/wb/ext/log4j-core.jar \
 && cd /opt/wb && mkdir -p /tmp/m/META-INF \
 && unzip -p sqlworkbench.jar META-INF/MANIFEST.MF \
    | awk '/^Class-Path:/{s=1;next} s&&/^ /{next} {s=0;print}' > /tmp/m/META-INF/MANIFEST.MF \
 && cd /tmp/m && zip -q /opt/wb/sqlworkbench.jar META-INF/MANIFEST.MF
# Class-Path ". ext/..." is removed: CDS rejects directories; the entrypoint lists ext/* itself

# 2. Backend
FROM maven:3.9-eclipse-temurin-21 AS backend
WORKDIR /src/backend
COPY --from=wb /opt/wb/sqlworkbench.jar /tmp/sqlworkbench.jar
COPY backend/pom.xml .
COPY backend/src ./src
RUN --mount=type=cache,target=/root/.m2 \
    mvn -q -B install:install-file -Dfile=/tmp/sqlworkbench.jar -DgroupId=eu.sql-workbench \
      -DartifactId=sqlworkbench -Dversion=local -Dpackaging=jar \
 && mvn -q -B package -DskipTests

# 3. Frontend
FROM node:24-alpine AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json frontend/.npmrc ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# 4. Runtime
FROM eclipse-temurin:21-jre-alpine
RUN addgroup -S app && adduser -S -G app app && mkdir -p /data && chown app:app /data
WORKDIR /opt/app
COPY --from=wb /opt/wb /opt/wb
COPY --from=backend /src/backend/target/sqlwb-web.jar /src/backend/target/lib/ ./lib/
COPY --from=frontend /src/frontend/dist ./public
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \
 && SQLWB_EXIT_AFTER_START=1 DATA_DIR=/tmp/cds JAVA_OPTS="-XX:+UseZGC -XX:+ZGenerational -XX:ArchiveClassesAtExit=/opt/app/app.jsa" /entrypoint.sh \
 && rm -rf /tmp/cds && chmod 644 /opt/app/app.jsa
USER app
ENV PORT=8484 DATA_DIR=/data PUBLIC_DIR=/opt/app/public \
    JAVA_OPTS="-XX:+UseZGC -XX:+ZGenerational -Xms256m -XX:MaxRAMPercentage=65 -XX:+ExitOnOutOfMemoryError -XX:SharedArchiveFile=/opt/app/app.jsa -Xlog:cds=off -Xlog:cds+dynamic=off"
EXPOSE 8484
VOLUME /data
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO- http://localhost:8484/api/health || exit 1
ENTRYPOINT ["/entrypoint.sh"]
