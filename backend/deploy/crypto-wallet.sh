#!/usr/bin/env bash
set -e

ENV_FILE="${ENV_FILE:-/opt/forkwise/backend.env}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo: sudo bash $0"
  exit 1
fi

echo
echo "Forkwise: receive crypto payments straight to your wallet"
echo "---------------------------------------------------------"
echo "Paste PUBLIC receiving addresses only. Never paste a recovery phrase or private key anywhere."
echo "In Trust Wallet: open the coin, tap Receive, copy the address. Leave a line empty to skip that network."
echo
read -r -p "EVM address (0x..., the same for BNB Chain, Base, Polygon, Arbitrum, Ethereum): " EVM < /dev/tty
read -r -p "Tron address (T..., for USDT TRC-20): " TRON < /dev/tty
read -r -p "Bitcoin address (bc1... or 1... or 3...): " BTC < /dev/tty

EVM="$(echo "$EVM" | tr -d '[:space:]')"
TRON="$(echo "$TRON" | tr -d '[:space:]')"
BTC="$(echo "$BTC" | tr -d '[:space:]')"
if [ -n "$EVM" ] && ! echo "$EVM" | grep -Eq '^0x[0-9a-fA-F]{40}$'; then echo "That EVM address is not valid."; exit 1; fi
if [ -n "$TRON" ] && ! echo "$TRON" | grep -Eq '^T[1-9A-HJ-NP-Za-km-z]{33}$'; then echo "That Tron address is not valid."; exit 1; fi
if [ -n "$BTC" ] && ! echo "$BTC" | grep -Eq '^(bc1[0-9a-z]{20,80}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$'; then echo "That Bitcoin address is not valid."; exit 1; fi
if [ -z "$EVM$TRON$BTC" ]; then echo "At least one address is needed."; exit 1; fi

cp "$ENV_FILE" "$ENV_FILE.bak.$(date +%s)"
for NAME in CRYPTO_EVM_ADDRESS CRYPTO_TRON_ADDRESS CRYPTO_BTC_ADDRESS; do
  sed -i "/^$NAME=/d" "$ENV_FILE"
done
[ -n "$EVM" ] && echo "CRYPTO_EVM_ADDRESS=$EVM" >> "$ENV_FILE"
[ -n "$TRON" ] && echo "CRYPTO_TRON_ADDRESS=$TRON" >> "$ENV_FILE"
[ -n "$BTC" ] && echo "CRYPTO_BTC_ADDRESS=$BTC" >> "$ENV_FILE"

systemctl restart forkwise-api
sleep 3
echo
echo "Done. Checkout now offers the coins for the addresses you set. NOWPayments is no longer used for new payments."
echo "Send yourself a small test payment from the billing page before announcing it."
