#!/usr/bin/env bash
# Phase 10: 每日 MySQL 备份(crontab 02:00 调用)
#
# 行为:
#   1. 从 .env.production.local 解析 DATABASE_URL → user/pass/host/port/db
#   2. mysqldump --single-transaction(InnoDB 不锁表) → gzip 压缩
#   3. 保留 30 天,超过的删除
#
# 安全:
#   - 不在命令行暴露密码(写到临时 my.cnf 用 --defaults-extra-file)
#   - 临时 my.cnf chmod 600 + trap EXIT 清理

set -euo pipefail

ENV_FILE="/root/server/lumideck/packages/agent/.env.production.local"
DEST="/root/backups/lumideck"
STAMP=$(date +%Y%m%d-%H%M%S)
FILE="${DEST}/lumideck-${STAMP}.sql.gz"

if [ ! -f "${ENV_FILE}" ]; then
    echo "[$(date)] ERROR: ${ENV_FILE} 不存在" >&2
    exit 1
fi

mkdir -p "${DEST}"

# 解析 DATABASE_URL=mysql://USER:PASS@HOST:PORT/DBNAME
DB_URL=$(grep '^DATABASE_URL=' "${ENV_FILE}" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
if [ -z "${DB_URL}" ]; then
    echo "[$(date)] ERROR: DATABASE_URL 解析失败" >&2
    exit 1
fi

# bash 正则解析(兼容无 query 与有 query 两种)
URL_RE='^mysql://([^:]+):([^@]+)@([^:/]+)(:([0-9]+))?/([^/?]+)'
if [[ "${DB_URL}" =~ ${URL_RE} ]]; then
    DB_USER="${BASH_REMATCH[1]}"
    DB_PASS="${BASH_REMATCH[2]}"
    DB_HOST="${BASH_REMATCH[3]}"
    DB_PORT="${BASH_REMATCH[5]:-3306}"
    DB_NAME="${BASH_REMATCH[6]}"
else
    echo "[$(date)] ERROR: DATABASE_URL 格式不匹配" >&2
    exit 1
fi

# 临时 my.cnf 避免命令行明文密码
TMP_CNF=$(mktemp)
trap 'rm -f "${TMP_CNF}"' EXIT
chmod 600 "${TMP_CNF}"
cat > "${TMP_CNF}" <<EOF
[client]
user=${DB_USER}
password=${DB_PASS}
host=${DB_HOST}
port=${DB_PORT}
EOF

# 备份(InnoDB 单事务一致性快照,不锁表)
mysqldump --defaults-extra-file="${TMP_CNF}" \
    --single-transaction \
    --quick \
    --hex-blob \
    --routines \
    --triggers \
    "${DB_NAME}" 2>/dev/null \
    | gzip > "${FILE}"

# 30 天 rotate
find "${DEST}" -name 'lumideck-*.sql.gz' -mtime +30 -delete 2>/dev/null || true

SIZE=$(du -h "${FILE}" | cut -f1)
echo "[$(date)] backup ok: ${FILE} (${SIZE})"
