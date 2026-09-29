#!/bin/sh
# Fly Gym launcher (Mac / Linux): serves this folder on http://localhost:5600 and opens it.
cd "$(dirname "$0")" || exit 1
if ! curl -s -o /dev/null http://localhost:5600/menu.html; then
  python3 -m http.server 5600 >/dev/null 2>&1 &
  sleep 2
fi
if command -v open >/dev/null; then open http://localhost:5600/menu.html; else xdg-open http://localhost:5600/menu.html; fi
