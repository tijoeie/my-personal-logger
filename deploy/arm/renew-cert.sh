#!/bin/bash
set -euo pipefail
cd "$HOME/Claude projects/personal-logger/ssl"
before=$(sha256sum tls.crt 2>/dev/null || true)
sudo tailscale cert --cert-file tls.crt --key-file tls.key arm-server.tailcadf24.ts.net
sudo chown ubuntu:ubuntu tls.crt tls.key
chmod 644 tls.crt; chmod 600 tls.key
after=$(sha256sum tls.crt 2>/dev/null || true)
if [ "$before" != "$after" ]; then docker restart personal-logger-proxy >/dev/null 2>&1 || true; echo "cert renewed"; else echo "cert unchanged"; fi
