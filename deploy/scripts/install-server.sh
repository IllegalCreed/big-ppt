#!/usr/bin/env bash
# Phase 10: 远端服务器首次环境初始化(幂等,可重复跑)
#
# 用法(在远端 root 身份执行):
#   DOMAIN=lumideck.illegalscreed.cn bash /root/server/lumideck/deploy/scripts/install-server.sh
#
# 执行前需:
#   1. DNS A 记录 ${DOMAIN} → 本机外网 IP 已生效(`dig +short ${DOMAIN}`)
#   2. 本机已装 nginx + certbot + certbot-nginx 插件 + crontab
#   3. /root/server/lumideck/ 目录已 rsync 过来(包含 deploy/ 子目录)
#
# 不做:
#   - 不写 .env.production.local(secrets 必须人工生成,见 docs/runbooks/deploy.md)
#   - 不装 Node / pnpm / mysql(假设 quiz 服务器已有)

set -euo pipefail

DOMAIN="${DOMAIN:-lumideck.illegalscreed.cn}"
WEB_ROOT="/var/www/lumideck"
BACKEND_PORT="4000"
MONOREPO_ROOT="/root/server/lumideck"
BACKUP_DIR="/root/backups/lumideck"
ACME_EMAIL="${ACME_EMAIL:-ops@illegalscreed.cn}"

echo "==> Phase 10 install-server.sh"
echo "    DOMAIN=${DOMAIN}"
echo "    WEB_ROOT=${WEB_ROOT}"
echo "    BACKEND_PORT=${BACKEND_PORT}"
echo "    MONOREPO_ROOT=${MONOREPO_ROOT}"
echo ""

# ── 1. 建必要目录 ─────────────────────
echo "==> mkdir 目录骨架"
mkdir -p "${WEB_ROOT}" "${BACKUP_DIR}"
chown -R www-data:www-data "${WEB_ROOT}" 2>/dev/null || true
chmod 755 "${WEB_ROOT}"

# ── 2. nginx config ──────────────────
echo "==> 渲染 nginx 配置"
TEMPLATE="${MONOREPO_ROOT}/deploy/nginx/lumideck.conf.template"
if [ ! -f "${TEMPLATE}" ]; then
    echo "ERROR: ${TEMPLATE} 不存在,先跑 deploy.sh 把 deploy/ rsync 上来" >&2
    exit 1
fi

export DOMAIN WEB_ROOT BACKEND_PORT
envsubst '${DOMAIN} ${WEB_ROOT} ${BACKEND_PORT}' \
    < "${TEMPLATE}" \
    > /etc/nginx/conf.d/lumideck.conf
echo "    → /etc/nginx/conf.d/lumideck.conf"

echo "==> nginx -t 校验"
nginx -t

echo "==> systemctl reload nginx"
systemctl reload nginx

# ── 3. certbot 申请证书(若未申请) ───
if [ -d "/etc/letsencrypt/live/${DOMAIN}" ]; then
    echo "==> 证书已存在,跳过 certbot 申请"
else
    echo "==> certbot --nginx 申请证书"
    certbot --nginx \
        -d "${DOMAIN}" \
        --non-interactive \
        --agree-tos \
        -m "${ACME_EMAIL}" \
        --redirect
fi

# certbot 默认 systemd timer 续期(certbot.timer),不需要手动 crontab

# ── 4. crontab 加每日 DB 备份 ────────
BACKUP_SCRIPT="${MONOREPO_ROOT}/deploy/scripts/db-backup.sh"
CRON_LINE="0 2 * * * ${BACKUP_SCRIPT} >> ${BACKUP_DIR}/cron.log 2>&1"

if crontab -l 2>/dev/null | grep -qF "${BACKUP_SCRIPT}"; then
    echo "==> crontab 已含 db-backup,跳过"
else
    echo "==> 加 crontab:每日 02:00 跑 db-backup.sh"
    ( crontab -l 2>/dev/null || true; echo "${CRON_LINE}" ) | crontab -
fi

echo ""
echo "✓ install-server.sh 完成"
echo ""
echo "下一步:"
echo "  1. 写 ${MONOREPO_ROOT}/packages/agent/.env.production.local"
echo "     (DATABASE_URL / SESSION_SECRET / APIKEY_MASTER_KEY / PUBLIC_ORIGIN)"
echo "  2. 本地跑 ./scripts/deploy.sh all"
echo "  3. curl https://${DOMAIN}/api/healthz 看 status:ok"
