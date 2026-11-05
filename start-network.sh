#!/bin/bash
# Perovskite Lab for the lab network: phones and other computers on the same network can open it.
cd "$(dirname "$0")"
exec ./start.sh lan
