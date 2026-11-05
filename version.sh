#!/usr/bin/env bash
cd "$(dirname "$(readlink -f "$0")")" || exit 1
echo "Perovskite Lab version $(node -p "require('./package.json').version")"
