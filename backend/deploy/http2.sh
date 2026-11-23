#!/usr/bin/env bash
# Turns on HTTP/2 for the API in nginx. Safe to run any number of times; forkwise-update runs it.
#
# Why: over HTTP/1.1 a browser opens at most 6 connections to one site, across all its tabs.
# Every chat that is answering keeps one open for live updates, so with a few tabs open new
# messages and live updates wait in a queue until a refresh frees a connection. HTTP/2 carries
# all of them over one connection.
set -uo pipefail

if [ "$(id -u)" != "0" ]; then
    echo "Run with sudo."
    exit 1
fi

CONF=/etc/nginx/conf.d/forkwise-api.conf
if [ ! -f "$CONF" ]; then
    echo "No nginx config for the API at $CONF; nothing to do."
    exit 0
fi
if ! grep -q "listen 443" "$CONF"; then
    echo "The API config has no HTTPS listener yet (certbot not run); HTTP/2 needs HTTPS."
    exit 0
fi
if grep -Eq "listen 443[^;]*http2|^\s*http2 on;" "$CONF"; then
    echo "HTTP/2 is already on."
    exit 0
fi

cp "$CONF" "$CONF.before-http2"
VERSION="$(nginx -v 2>&1 | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+' | head -1)"
MAJOR="$(echo "$VERSION" | cut -d. -f1)"
MINOR="$(echo "$VERSION" | cut -d. -f2)"
PATCH="$(echo "$VERSION" | cut -d. -f3)"
if [ "$MAJOR" -gt 1 ] || { [ "$MAJOR" -eq 1 ] && { [ "$MINOR" -gt 25 ] || { [ "$MINOR" -eq 25 ] && [ "$PATCH" -ge 1 ]; }; }; }; then
    # nginx 1.25.1 and later: a separate directive inside the server block that listens on 443.
    sed -i '0,/listen 443/ s/\(\s*listen 443[^;]*;\)/\1\n    http2 on;/' "$CONF"
else
    sed -i -E 's/listen (\[::\]:)?443 ssl;/listen \1443 ssl http2;/' "$CONF"
fi

if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx
    echo "HTTP/2 is on for the API (nginx $VERSION)."
else
    cp "$CONF.before-http2" "$CONF"
    echo "nginx did not accept HTTP/2 here; the old config is back. Details: sudo nginx -t"
    exit 1
fi
