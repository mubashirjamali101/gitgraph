# Linux bundles for GitGraph. Built from a copy of the tree, never a mount:
# pnpm install inside the container would otherwise replace the host's macOS
# node_modules with Linux binaries.
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential curl wget file pkg-config git ca-certificates \
      libwebkit2gtk-4.1-dev librsvg2-dev libxdo-dev \
      libayatana-appindicator3-dev patchelf \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable
ENV PATH="/root/.cargo/bin:${PATH}"

RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs \
    && npm install -g pnpm@10 && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile

# deb only: AppImage downloads its tooling at build time, and rpm needs more
# packaging deps than a .deb consumer will ever want.
RUN pnpm tauri build --bundles deb
