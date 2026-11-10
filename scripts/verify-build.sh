#!/bin/sh
# Rebuilds the committed bundles from their lockfiles and fails if either one differs.
# The catalog pins a commit; this shows that cli/dist/sovereign.mjs and desktop/plugin.js
# at that commit are exactly what the sources and lockfiles produce.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
(cd "$root/cli" && npm ci --no-audit --no-fund && node build.mjs)
if [ -f "$root/pane/build.mjs" ]; then
  (cd "$root/pane" && npm ci --no-audit --no-fund && node build.mjs)
fi
git -C "$root" diff --exit-code -- cli/dist/sovereign.mjs desktop/plugin.js
echo "Bundles match their sources."
