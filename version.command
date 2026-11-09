#!/bin/bash
cd "$(dirname "$0")"
echo "PANOPTICA version $(node -p "require('./package.json').version")"
read -p "Press Enter"
