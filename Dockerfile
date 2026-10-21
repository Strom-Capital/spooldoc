# syntax=docker/dockerfile:1
# Spooldoc web app: Next.js with the jt400 driver (a JVM through the native `java`
# addon). Works on amd64 and arm64. Needs a Postgres database (DATABASE_URL) and a
# Carbone server to render documents; see compose.yaml.

FROM node:22-bookworm AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends openjdk-17-jdk-headless python3 make g++ \
 && rm -rf /var/lib/apt/lists/* \
 && ln -s "/usr/lib/jvm/java-17-openjdk-$(dpkg --print-architecture)" /opt/java
ENV JAVA_HOME=/opt/java \
    NEXT_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && corepack install
COPY packages/core/package.json packages/core/
COPY packages/docs/package.json packages/docs/
COPY packages/ibmi/package.json packages/ibmi/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm -r build
# A self-contained copy of the web app with its production dependencies, the
# workspace packages included (their dist), the `java` addon built against this JDK.
RUN pnpm --filter @spooldoc/web deploy --prod /app \
 && rm -rf /app/.next \
 && cp -r apps/web/.next /app/.next \
 && rm -rf /app/.next/cache

FROM node:22-bookworm-slim
RUN mkdir -p /usr/share/man/man1 \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      openjdk-17-jre-headless ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && ln -s "/usr/lib/jvm/java-17-openjdk-$(dpkg --print-architecture)" /opt/java
# The `java` addon links libjvm.so with an rpath into the JDK of the build stage; the
# JRE here has the same layout, and LD_LIBRARY_PATH covers any other location.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    JAVA_HOME=/opt/java \
    LD_LIBRARY_PATH=/opt/java/lib/server \
    UV_THREADPOOL_SIZE=16 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
# The server applies the database migrations when it starts (see instrumentation.ts).
CMD ["node_modules/.bin/next", "start"]
