#!/usr/bin/env bash
# Builds scene/main.cpp into web/constellation-engine.{js,wasm} and copies the
# Strata web kit's page scripts (strata-kit.js, strata-loader.js) beside them.
# The outputs are committed, so serving needs only Python. Needs emsdk 6.0.11
# (Strata 0.10.0's); downloads the pinned Strata tarball into .strata/.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(dirname "$here")"
STRATA_VERSION=0.10.0
STRATA_SHA256=bb86b974c7e0309db91625ba5ee157273704c77d93f4338c8a63ee625e3d56de
tarball="$repo/.strata/strata-$STRATA_VERSION-wasm32-emscripten.tar.gz"

if ! command -v emcc >/dev/null 2>&1; then
  # emsdk_env.sh needs python >= 3.10 and clears EMSDK_PYTHON: set it before and after.
  py="$(ls -d "$HOME"/.local/share/uv/python/cpython-3.1[2-9]*/bin/python3.1? 2>/dev/null | head -1 || true)"
  export EMSDK_PYTHON="${EMSDK_PYTHON:-$py}"
  keep="$EMSDK_PYTHON"
  # shellcheck disable=SC1091
  . "${EMSDK:-/root/emsdk}/emsdk_env.sh" >/dev/null 2>&1
  export EMSDK_PYTHON="$keep"
fi

mkdir -p "$repo/.strata"
if [ ! -f "$tarball" ]; then
  gh release download "v$STRATA_VERSION" -R Preponderous-Software/strata \
    -p "strata-$STRATA_VERSION-wasm32-emscripten.tar.gz" -D "$repo/.strata"
fi
echo "$STRATA_SHA256  $tarball" | sha256sum -c --quiet
if [ ! -f "$repo/.strata/kit/build-kit.sh" ]; then
  tar -xzf "$tarball" -C "$repo/.strata"
fi

STRATA_TARBALL="$tarball" STRATA_SHA256="$STRATA_SHA256" \
  "$repo/.strata/kit/build-kit.sh" "$here/kit.conf"
