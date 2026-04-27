#!/usr/bin/env bash
# Phase 10: 远端服务器首次环境初始化(幂等,可重复跑)
#
# 用法(在远端 root 身份执行):
#   DOMAIN=lumideck.illegalscreed.cn ACME_EMAIL=ops@illegalscreed.cn \
#     bash /root/server/lumideck/deploy/scripts/install-server.sh
#
# 执行前需:
#   1. DNS A 记录 ${DOMAIN} → 本机外网 IP 已生效(`dig +short ${DOMAIN}`)
#   2. 本机已装 nginx + certbot + crontab(quiz 服务器已有)
#   3. /root/server/lumideck/ 目录已 rsync 过来(包含 deploy/ 子目录)
#
# 两阶段 bootstrap:
#   阶段 A:80-only conf → certbot --webroot 申请证书
#   阶段 B:full conf(80→443 跳转 + 443 ssl + 反代规则)
#
# 不做:
#   - 不写 .env.production.local(secrets 必须用 init-db.mjs 在本地生成后 scp)
#   - 不装 Node / pnpm / mysql-client(假设 quiz 服务器已有)

set -euo pipefail

DOMAIN="${DOMAIN:-lumideck.illegalscreed.cn}"
WEB_ROOT="/var/www/lumideck"
BACKEND_PORT="4000"
MONOREPO_ROOT="/root/server/lumideck"
BACKUP_DIR="/root/backups/lumideck"
ACME_EMAIL="${ACME_EMAIL:-ops@illegalscreed.cn}"

NGINX_CONF="/etc/nginx/conf.d/lumideck.conf"
HTTP_ONLY_TEMPLATE="${MONOREPO_ROOT}/deploy/nginx/lumideck-http-only.conf.template"
FULL_TEMPLATE="${MONOREPO_ROOT}/deploy/nginx/lumideck.conf.template"

echo "==> Phase 10 install-server.sh"
echo "    DOMAIN=${DOMAIN}"
echo "    WEB_ROOT=${WEB_ROOT}"
echo "    BACKEND_PORT=${BACKEND_PORT}"
echo "    MONOREPO_ROOT=${MONOREPO_ROOT}"
echo ""

# ── 1. 建必要目录 ──────────────────────────
echo "==> mkdir 目录骨架"
mkdir -p "${WEB_ROOT}" "${WEB_ROOT}/.well-known/acme-challenge" "${BACKUP_DIR}"
chmod 755 "${WEB_ROOT}"

# ── 2. 阶段 A:写 80-only conf 让 ACME challenge 可达 ──
if [ ! -d "/etc/letsencrypt/live/${DOMAIN}" ]; then
    echo "==> 阶段 A:80-only conf(为 certbot 准备)"
    if [ ! -f "${HTTP_ONLY_TEMPLATE}" ]; then
        echo "ERROR: ${HTTP_ONLY_TEMPLATE} 不存在,先跑 deploy.sh ecosystem 同步 deploy/" >&2
        exit 1
    fi
    export DOMAIN WEB_ROOT
    envsubst '${DOMAIN} ${WEB_ROOT}' < "${HTTP_ONLY_TEMPLATE}" > "${NGINX_CONF}"

    echo "==> nginx -t(80-only)"
    nginx -t

    echo "==> systemctl reload nginx"
    systemctl reload nginx

    echo "==> certbot --webroot 申请证书(不改 nginx conf,生成 /etc/letsencrypt/live/${DOMAIN}/)"
    certbot certonly --webroot \
        -w "${WEB_ROOT}" \
        -d "${DOMAIN}" \
        --non-interactive \
        --agree-tos \
        -m "${ACME_EMAIL}"
else
    echo "==> 证书已存在,跳过阶段 A(certbot certonly)"
fi

# ── 3. 阶段 B:写完整 conf(80 跳 443 + 443 ssl + 反代规则)──
echo "==> 阶段 B:full conf(HTTPS + 反代规则)"
if [ ! -f "${FULL_TEMPLATE}" ]; then
    echo "ERROR: ${FULL_TEMPLATE} 不存在" >&2
    exit 1
fi
export DOMAIN WEB_ROOT BACKEND_PORT
envsubst '${DOMAIN} ${WEB_ROOT} ${BACKEND_PORT}' < "${FULL_TEMPLATE}" > "${NGINX_CONF}"

echo "==> nginx -t(full)"
nginx -t

echo "==> systemctl reload nginx"
systemctl reload nginx

# ── 4. crontab 加每日 DB 备份 ─────────────
BACKUP_SCRIPT="${MONOREPO_ROOT}/deploy/scripts/db-backup.sh"
if crontab -l 2>/dev/null | grep -qF "${BACKUP_SCRIPT}"; then
    echo "==> crontab 已含 db-backup,跳过"
else
    echo "==> 加 crontab:每日 02:00 跑 db-backup.sh"
    ( crontab -l 2>/dev/null || true; \
      echo "0 2 * * * ${BACKUP_SCRIPT} >> ${BACKUP_DIR}/cron.log 2>&1" ) | crontab -
fi

# certbot 默认 systemd timer 自动续期(certbot.timer)— 续期时 ACME challenge 走
# /var/www/lumideck/.well-known/acme-challenge/(已写在 nginx conf 的 80 / 443 location)。
# 不需要额外配 cron。

echo ""
echo "✓ install-server.sh 完成"
echo ""
echo "下一步:本地跑"
echo "  scp packages/agent/.env.production.local root@<server>:${MONOREPO_ROOT}/packages/agent/"
echo "  ./scripts/deploy.sh all"
echo ""
echo "测试:"
echo "  curl -I https://${DOMAIN}/        # 应返回 404(SPA dist 未传)或 200"
echo "  curl https://${DOMAIN}/api/healthz  # 应返回 status:ok 或 down(DB / .env 是否就位)"
