#!/usr/bin/env bash
set -e

ENV_FILE="${ENV_FILE:-/opt/forkwise/backend.env}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo: sudo bash $0"
  exit 1
fi

echo
echo "Forkwise: OpenRouter balance alerts"
echo "-----------------------------------"
echo "1. OpenRouter management key: openrouter.ai, Settings, Management keys, Create. It lets Forkwise READ the"
echo "   balance. Leave empty to skip; spending is still tracked, but the balance is not shown."
echo "2. Telegram (optional): create a bot with @BotFather for the token, then send the bot a message and"
echo "   open https://api.telegram.org/bot<token>/getUpdates to find your chat id."
echo "Alerts also go by email to every admin when email is set up."
echo
read -r -s -p "OpenRouter management key (hidden, Enter to skip): " MGMT < /dev/tty
echo
read -r -s -p "Telegram bot token (hidden, Enter to skip): " BOT < /dev/tty
echo
CHAT=""
if [ -n "$BOT" ]; then
  read -r -p "Telegram chat id: " CHAT < /dev/tty
fi

cp "$ENV_FILE" "$ENV_FILE.bak.$(date +%s)"
if [ -n "$MGMT" ]; then
  sed -i "/^OPENROUTER_MANAGEMENT_KEY=/d" "$ENV_FILE"
  echo "OPENROUTER_MANAGEMENT_KEY=$(echo "$MGMT" | tr -d '[:space:]')" >> "$ENV_FILE"
fi
if [ -n "$BOT" ] && [ -n "$CHAT" ]; then
  sed -i "/^TREASURY_TELEGRAM_TOKEN=/d;/^TREASURY_TELEGRAM_CHAT=/d" "$ENV_FILE"
  echo "TREASURY_TELEGRAM_TOKEN=$(echo "$BOT" | tr -d '[:space:]')" >> "$ENV_FILE"
  echo "TREASURY_TELEGRAM_CHAT=$(echo "$CHAT" | tr -d '[:space:]')" >> "$ENV_FILE"
fi

systemctl restart forkwise-api
echo
echo "Done. Open the admin page, Overview, OpenRouter balance, and press Check now."
