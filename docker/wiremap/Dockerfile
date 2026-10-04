# syntax=docker/dockerfile:1.7
# wiremap in one container: Postgres, Redis, MinIO, Mailpit, the web app, the worker and an
# optional Cloudflare Tunnel, under s6-overlay. See docs/plans/SELF-HOSTED-PLAN.md.

# ── The tools, taken from their own images and pinned by digest ─────────────────────────────
FROM coollabsio/minio:RELEASE.2025-10-15T17-29-55Z@sha256:69b55a1c1c5dc285ce04db96689f5b2102317fc77a50680a1874ca6efd1c87f9 AS minio
FROM axllent/mailpit:v1.29@sha256:757f22b56c1da03570afdb3d259effe5091018008a81bbedc8158cee7e16fdbc AS mailpit
FROM cloudflare/cloudflared:2025.9.1@sha256:4604b477520dc8322af5427da68b44f0bf814938e9d2e4814f2249ee4b03ffdf AS cloudflared

# ── Build: every package, the web app, the worker, the CLI ───────────────────────────────
# On the machine's own platform for every target: the output is JavaScript and WebAssembly,
# so an arm64 image needs no emulated pnpm install.
FROM --platform=$BUILDPLATFORM node:24-bookworm@sha256:64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4 AS build
ENV CI=true HUSKY=0
RUN npm install -g pnpm@11.21.0 --no-audit --no-fund
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build:packages \
 && pnpm --filter @loadbearing/web run build \
 && pnpm --filter @loadbearing/worker run build \
 && pnpm --filter @loadbearing/cli run pack:npm

# The worker and the database scripts as single bundled files. `pnpm deploy` links workspace
# packages back to their sources, which the runtime image does not have.
RUN cp docker/wiremap/src/ensure-bucket.mjs packages/infrastructure/ensure-bucket.mjs \
 && cd packages/infrastructure \
 && "$(ls -d /src/node_modules/.pnpm/esbuild@0.2* | sort -V | tail -1)/node_modules/esbuild/bin/esbuild" \
      migrate.ts seed.ts platform-grant.ts ensure-bucket.mjs \
      --bundle --platform=node --format=esm --target=node24 --outdir=/out/infra \
      --out-extension:.js=.mjs --external:pg-native --log-level=warning \
      --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
 && cp -r migrations /out/infra/migrations \
 && cd /src/apps/worker \
 && "$(ls -d /src/node_modules/.pnpm/esbuild@0.2* | sort -V | tail -1)/node_modules/esbuild/bin/esbuild" \
      dist/main.js --bundle --platform=node --format=esm --target=node24 --outfile=/out/worker/main.mjs \
      --external:pg-native --external:msgpackr-extract --log-level=warning \
      --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"

RUN mkdir -p /out/web \
 && cp -r apps/web/.output apps/web/cluster.mjs /out/web/ \
 && cp -r apps/cli/dist/npm /out/cli \
 && cd /out/cli && npm install --omit=dev --ignore-scripts --no-audit --no-fund \
 && cp /src/infra/postgres.init.sql /out/postgres.init.sql

# ── Runtime ────────────────────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS runtime
ARG TARGETARCH
ARG S6_VERSION=3.2.3.2

# Postgres 17 and pgvector from the PostgreSQL project's own repository. The package's
# default cluster is switched off: the data lives on /data, made on first start. The JIT and
# its LLVM (about 150 MB) go too: postgres runs with jit=off, and the binary does not link it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg xz-utils git redis-server \
 && install -d /usr/share/postgresql-common/pgdg /etc/postgresql-common \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
 && echo "create_main_cluster = false" > /etc/postgresql-common/createcluster.conf \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-17 postgresql-17-pgvector \
 && apt-get purge -y gnupg && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/* /usr/share/doc/* /usr/share/man/* \
 && rm -rf /usr/lib/postgresql/17/lib/llvmjit* /usr/lib/postgresql/17/lib/bitcode \
 && rm -f /usr/lib/*-linux-gnu/libLLVM* \
 && ! ldd /usr/lib/postgresql/17/bin/postgres | grep -qi "not found"

# s6-overlay, each tarball checked against the checksum its release publishes.
RUN case "${TARGETARCH}" in \
      amd64) arch=x86_64; sum=e6befcc96a437a3831386ecfc51808c5d3e939dc5fe3c02ae9284599e8aa2408 ;; \
      arm64) arch=aarch64; sum=b17f17a82e7a515c682a91edaf2ffdabb73f891981b6c1fd712115693a2f8b4c ;; \
      *) echo "unsupported architecture ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && base="https://github.com/just-containers/s6-overlay/releases/download/v${S6_VERSION}" \
 && curl -fsSL -o /tmp/noarch.tar.xz "${base}/s6-overlay-noarch.tar.xz" \
 && curl -fsSL -o /tmp/arch.tar.xz "${base}/s6-overlay-${arch}.tar.xz" \
 && echo "5379750ed30a84bbd2e2dd74847ba6b5bd29cd0b2e3ea2ec58049b57eb2eda12  /tmp/noarch.tar.xz" | sha256sum -c - \
 && echo "${sum}  /tmp/arch.tar.xz" | sha256sum -c - \
 && tar -C / -Jxpf /tmp/noarch.tar.xz && tar -C / -Jxpf /tmp/arch.tar.xz \
 && rm /tmp/*.tar.xz

RUN useradd --system --uid 10001 --home-dir /app --shell /usr/sbin/nologin wiremap

COPY --from=minio /usr/bin/minio /usr/local/bin/minio
COPY --from=mailpit /mailpit /usr/local/bin/mailpit
COPY --from=cloudflared /usr/local/bin/cloudflared /usr/local/bin/cloudflared
COPY --from=build /out /app
COPY docker/wiremap/rootfs/ /
COPY LICENSE /app/LICENSE

LABEL org.opencontainers.image.title="wiremap" \
      org.opencontainers.image.description="See how a codebase is wired. Postgres, Redis, storage, mail and the app in one container." \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.source="https://github.com/sami999khan999/wiremap"

ENV PATH=/command:/usr/local/bin:/usr/bin:/bin \
    WIREMAP_DATA=/data \
    S6_KEEP_ENV=1 \
    S6_BEHAVIOUR_IF_STAGE2_FAILS=2 \
    S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0 \
    S6_VERBOSITY=1

VOLUME /data
EXPOSE 43000 48025
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
  CMD curl -fs http://127.0.0.1:43000/api/health > /dev/null || exit 1
ENTRYPOINT ["/init"]
