#!/usr/bin/env bash
set -euo pipefail

exec nix develop --command haskell-language-server-wrapper "$@"
