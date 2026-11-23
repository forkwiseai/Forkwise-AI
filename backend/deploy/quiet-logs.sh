#!/usr/bin/env bash
# Keeps server logs small. Safe to run any number of times; forkwise-update runs it on every update.
set -uo pipefail

if [ "$(id -u)" != "0" ]; then
    echo "Run with sudo."
    exit 1
fi

changed_api=0

# 1. The system journal: at most 300 MB, two weeks.
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/forkwise.conf <<'EOS'
[Journal]
SystemMaxUse=300M
SystemMaxFileSize=50M
MaxRetentionSec=14day
RateLimitIntervalSec=30s
RateLimitBurst=2000
EOS
systemctl restart systemd-journald 2>/dev/null || true
journalctl --vacuum-size=300M --vacuum-time=14d >/dev/null 2>&1 || true

# 2. The API: no line per HTTP request (live updates and pings made thousands of them).
UNIT=/etc/systemd/system/forkwise-api.service
if [ -f "$UNIT" ] && ! grep -q -- "--no-access-log" "$UNIT"; then
    sed -i '/^ExecStart=.*uvicorn/ s/$/ --no-access-log/' "$UNIT"
    systemctl daemon-reload
    changed_api=1
fi

# 3. nginx: no access log for the API (errors are still logged).
CONF=/etc/nginx/conf.d/forkwise-api.conf
if [ -f "$CONF" ] && ! grep -q "access_log off" "$CONF"; then
    sed -i "s/^\(\s*client_max_body_size[^;]*;\)$/\1\n    access_log off;/" "$CONF"
    if nginx -t >/dev/null 2>&1; then
        systemctl reload nginx || true
    fi
fi

# 4. Docker: cap the logs of containers (new sandboxes are also capped by the API itself).
if command -v docker >/dev/null 2>&1; then
    for file in /var/lib/docker/containers/*/*-json.log; do
        [ -f "$file" ] || continue
        size=$(stat -c %s "$file" 2>/dev/null || echo 0)
        if [ "$size" -gt 52428800 ]; then
            truncate -s 0 "$file"
        fi
    done
    if [ ! -f /etc/docker/daemon.json ]; then
        mkdir -p /etc/docker
        printf '{\n  "log-driver": "json-file",\n  "log-opts": { "max-size": "10m", "max-file": "3" }\n}\n' > /etc/docker/daemon.json
        echo "Docker log limits saved; they apply after the next Docker restart."
    fi
fi

# 5. Old rotated system logs.
find /var/log -type f \( -name "*.gz" -o -name "*.[0-9]" \) -mtime +14 -delete 2>/dev/null || true

if [ "$changed_api" = "1" ] && [ "${1:-}" != "--no-restart" ]; then
    systemctl restart forkwise-api
fi
echo "Logs are capped. Journal size now: $(journalctl --disk-usage 2>/dev/null | grep -o '[0-9.]*[KMGT]' | head -1)"
