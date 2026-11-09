#!/usr/bin/env bash
cd "$(dirname "$(readlink -f "$0")")" || exit 1
echo "PANOPTICA version $(node -p "require('./package.json').version")"
