# SPDX-License-Identifier: Apache-2.0

FROM node:20-bookworm

ENV PNPM_HOME="/pnpm"
ENV PATH="/root/.cargo/bin:${PNPM_HOME}:${PATH}"
ENV PORT=10000
ENV HOSTNAME=0.0.0.0
ENV SIDEREAL_ENABLE_DEMO_API=1
ENV SETTLE_SECONDS=4
ENV STELLAR_CLI_VERSION=27.0.0

RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    ca-certificates \
    curl \
    build-essential \
    git \
    libssl-dev \
    pkg-config \
    python3 \
  && rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs \
  | sh -s -- -y --profile minimal --default-toolchain 1.96.0 \
  && rustup target add wasm32v1-none

RUN arch="$(dpkg --print-architecture)" \
  && case "$arch" in \
    amd64|arm64) stellar_arch="$arch" ;; \
    *) echo "Unsupported architecture for stellar-cli: $arch" >&2; exit 1 ;; \
  esac \
  && curl -fsSL \
    "https://github.com/stellar/stellar-cli/releases/download/v${STELLAR_CLI_VERSION}/stellar-cli_${STELLAR_CLI_VERSION}_${stellar_arch}.deb" \
    -o /tmp/stellar-cli.deb \
  && apt-get update \
  && apt-get install --yes /tmp/stellar-cli.deb \
  && rm -f /tmp/stellar-cli.deb \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable \
  && corepack prepare pnpm@10.28.0 --activate

WORKDIR /app
COPY . .

RUN pnpm install --frozen-lockfile \
  && cargo build --release --target wasm32v1-none --locked \
    -p sidereal-sy-wrapper \
    -p sidereal-pt-token \
    -p sidereal-yt-token \
    -p sidereal-tokenizer \
    -p sidereal-amm \
  && cargo test -p sidereal-integration-tests --test auth_invariants --no-run --locked \
  && pnpm --filter @sidereal/sdk build \
  && pnpm --filter @sidereal/app run build \
  && chmod +x scripts/render-demo-runner-start.sh

EXPOSE 10000

CMD ["bash", "scripts/render-demo-runner-start.sh"]
