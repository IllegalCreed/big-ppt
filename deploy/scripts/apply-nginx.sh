#!/usr/bin/env bash
# 从仓库模板安全更新生产 nginx 配置：先备份，再 nginx -t，失败自动回滚。

set -euo pipefail

DOMAIN="${DOMAIN:-lumideck.illegalscreed.cn}"
WEB_ROOT="${WEB_ROOT:-/var/www/lumideck}"
BACKEND_PORT="${BACKEND_PORT:-4000}"
MONOREPO_ROOT="${MONOREPO_ROOT:-/root/server/lumideck}"
TEMPLATE="${MONOREPO_ROOT}/deploy/nginx/lumideck.conf.template"
TARGET="/etc/nginx/conf.d/lumideck.conf"

if [ ! -f "${TEMPLATE}" ]; then
    echo "[apply-nginx] ERROR:模板不存在:${TEMPLATE}" >&2
    exit 1
fi

# 首次安装还没有证书时，由 install-server.sh 的两阶段 bootstrap 负责。
if [ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
    echo "[apply-nginx] 证书尚未创建，跳过完整配置应用"
    exit 0
fi

tmp="$(mktemp /tmp/lumideck-nginx.XXXXXX)"
backup=""
trap 'rm -f "${tmp}"' EXIT

export DOMAIN WEB_ROOT BACKEND_PORT
envsubst '${DOMAIN} ${WEB_ROOT} ${BACKEND_PORT}' < "${TEMPLATE}" > "${tmp}"

if [ -f "${TARGET}" ]; then
    backup="${TARGET}.bak.$(date +%Y%m%d%H%M%S)"
    cp "${TARGET}" "${backup}"
fi
install -m 0644 "${tmp}" "${TARGET}"

if ! nginx -t; then
    echo "[apply-nginx] nginx -t 失败，回滚" >&2
    if [ -n "${backup}" ]; then
        cp "${backup}" "${TARGET}"
    else
        rm -f "${TARGET}"
    fi
    nginx -t || true
    exit 1
fi

systemctl reload nginx
echo "[apply-nginx] 配置已应用:${TARGET}"
