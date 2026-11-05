#!/bin/bash
cd "$(dirname "$0")"
echo "Perovskite Lab version $(node -p "require('./package.json').version")"
read -p "Press Enter"
