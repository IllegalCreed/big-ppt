#!/usr/bin/env bash
# ============================================================
# Lumideck 一键部署脚本(Phase 10)
# 用法:./scripts/deploy.sh <creator|backend|ecosystem|healthz|all>
#
# 参数(必传,无参数打 help 不部署):
#   creator    — 仅 build + 部署 creator(SPA 静态文件到 /var/www/lumideck/)
#   backend    — 仅 build agent + 同步 monorepo + 远端 pnpm install + db:push:prod + pm2 reload
#   ecosystem  — 仅同步 deploy/ 配置(ecosystem.config.cjs / nginx 模板 / 脚本)
#   healthz    — 仅打 healthz 端点,不部署
#   all        — ecosystem + creator + backend + healthz(完整部署)
#
# 安全:
#   - all / backend 前会交互式 confirm,FORCE=1 跳过(CI 用)
#   - 无参数 = 打印 help 退出(避免不小心 all)
#
# 前提:
#   - SSH key 已 ssh-copy-id 到 root@SERVER_HOST
#   - 远端已跑过 deploy/scripts/install-server.sh(首次,见 docs/runbooks/deploy.md)
#   - 远端 .env.production.local 已写入(secrets;部署脚本不传)
# ============================================================

set -euo pipefail

# ── 配置 ────────────────────────────────────
SERVER_HOST="${SERVER_HOST:-47.120.26.143}"
SERVER_USER="${SERVER_USER:-root}"
DOMAIN="${DOMAIN:-lumideck.illegalscreed.cn}"
REMOTE_WEB="/var/www/lumideck"
REMOTE_MONOREPO="/root/server/lumideck"

# 路径
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"

# 颜色
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'
log_info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ── 工具 ────────────────────────────────────
check_ssh() {
    log_info "检查 SSH 到 ${SERVER_USER}@${SERVER_HOST}"
    if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "${SERVER_USER}@${SERVER_HOST}" 'echo ok' >/dev/null 2>&1; then
        log_error "SSH 不通。先跑 ssh-copy-id ${SERVER_USER}@${SERVER_HOST}"
        exit 1
    fi
}

# 高风险目标(all / backend)前显式 confirm,FORCE=1 跳过
confirm_destructive() {
    local target=$1
    if [ "${FORCE:-0}" = "1" ]; then
        log_warn "FORCE=1,跳过确认"
        return 0
    fi
    log_warn "即将对 ${SERVER_USER}@${SERVER_HOST} 执行: ${target}"
    log_warn "  会:rsync 代码到 ${REMOTE_MONOREPO}/、远端 pnpm install、drizzle-kit push、pm2 reload"
    if [ -t 0 ]; then
        read -r -p "继续?输 yes 确认: " ans
        if [ "${ans}" != "yes" ]; then
            log_error "取消"
            exit 1
        fi
    else
        log_error "非交互式 shell 必须 FORCE=1 才能跑 ${target}"
        exit 1
    fi
}

build_creator() {
    log_info "构建 creator(vite build)"
    cd "${PROJECT_ROOT}"
    pnpm -F @big-ppt/creator build
}

build_agent() {
    log_info "构建 agent(tsc)"
    cd "${PROJECT_ROOT}"
    pnpm -F @big-ppt/agent build
}

# ── 部署:ecosystem 配置(deploy/ 目录) ─────
deploy_ecosystem() {
    log_info "同步 deploy/ 配置 → ${REMOTE_MONOREPO}/deploy/"
    rsync -az --delete \
        "${PROJECT_ROOT}/deploy/" \
        "${SERVER_USER}@${SERVER_HOST}:${REMOTE_MONOREPO}/deploy/"
    # 远端确保脚本可执行(rsync 有时不保留 mode)
    ssh "${SERVER_USER}@${SERVER_HOST}" "chmod +x ${REMOTE_MONOREPO}/deploy/scripts/*.sh"
    log_info "ecosystem ✓"
}

# ── 部署:creator(SPA 静态) ────────────────
deploy_creator() {
    local dist="${PROJECT_ROOT}/packages/creator/dist"
    if [ ! -d "${dist}" ]; then
        log_error "${dist} 不存在,先 build"
        exit 1
    fi
    log_info "同步 creator/dist → ${REMOTE_WEB}/"
    rsync -az --delete "${dist}/" "${SERVER_USER}@${SERVER_HOST}:${REMOTE_WEB}/"
    log_info "creator ✓"
}

# ── 部署:backend(agent dist + slidev 源码 + monorepo lockfile) ─────
deploy_backend() {
    log_info "同步 monorepo backend → ${REMOTE_MONOREPO}/"

    # rsync monorepo 必要内容,显式排除危险/无关项
    rsync -az --delete \
        --exclude '.git/' \
        --exclude 'node_modules/' \
        --exclude '.env.*.local' \
        --exclude '.env.local' \
        --exclude 'packages/agent/data/' \
        --exclude 'packages/agent/coverage/' \
        --exclude 'packages/creator/' \
        --exclude 'packages/e2e/' \
        --exclude 'packages/slidev/slides.md' \
        --exclude 'packages/slidev/dist/' \
        --exclude 'packages/slidev/coverage/' \
        --exclude 'logs/' \
        --exclude '*.log' \
        --exclude '.DS_Store' \
        --exclude '.turbo/' \
        --exclude '.vscode/' \
        --exclude 'docs/archive/' \
        "${PROJECT_ROOT}/" \
        "${SERVER_USER}@${SERVER_HOST}:${REMOTE_MONOREPO}/"

    # 远端:装依赖 + 推 schema + reload pm2
    ssh "${SERVER_USER}@${SERVER_HOST}" "set -euo pipefail
        cd ${REMOTE_MONOREPO}

        echo '==> pnpm install --frozen-lockfile'
        pnpm install --frozen-lockfile 2>&1 | tail -8

        echo '==> drizzle-kit push:prod(幂等,无 schema 变化为 no-op)'
        pnpm -F @big-ppt/agent db:push:prod 2>&1 | tail -10 || {
            echo 'WARN: db:push:prod 失败,检查 .env.production.local 与 DB 连通性'
            exit 2
        }

        echo '==> pm2 startOrReload ecosystem'
        pm2 startOrReload ${REMOTE_MONOREPO}/deploy/ecosystem.config.cjs --update-env

        echo '==> pm2 status'
        pm2 list
    "
    log_info "backend ✓"
}

# ── healthcheck ─────────────────────────────
healthcheck() {
    log_info "Healthcheck → https://${DOMAIN}/api/healthz"
    local result http_code

    # curl -w 取 HTTP 状态码,-o 输出 body 到 /tmp
    http_code=$(curl -sS -w '%{http_code}' -o /tmp/lumideck-healthz.json \
        --max-time 10 \
        "https://${DOMAIN}/api/healthz" || echo '000')

    log_info "HTTP ${http_code}"
    if [ -f /tmp/lumideck-healthz.json ]; then
        result=$(cat /tmp/lumideck-healthz.json)
        echo "${result}" | head -c 600
        echo ""
    fi

    if echo "${result:-}" | grep -q '"status":"ok"'; then
        log_info "healthz: status=ok ✓"
    elif echo "${result:-}" | grep -q '"status":"degraded"'; then
        log_warn "healthz: status=degraded(检查 slidev 进程)"
    else
        log_error "healthz 不通,远端跑 pm2 logs lumideck-agent 排查"
        return 1
    fi
}

# ── 主路由 ──────────────────────────────────
print_help() {
    cat <<EOF
Lumideck 部署脚本(Phase 10)

用法: $0 <creator|backend|ecosystem|healthz|all>

  creator    SPA build + 部署到 ${REMOTE_WEB}
  backend    agent dist + monorepo 同步 + 远端 pnpm install + db:push:prod + pm2 reload
             ⚠️  会改远端代码 + DB schema + 重启进程,前置 confirm
  ecosystem  同步 deploy/ 配置文件(ecosystem.config.cjs / nginx 模板 / 远端脚本)
  healthz    打 https://${DOMAIN}/api/healthz 看状态(只读)
  all        以上全部按顺序跑(完整部署,前置 confirm)

环境变量:
  SERVER_HOST   默认 ${SERVER_HOST}
  SERVER_USER   默认 ${SERVER_USER}
  DOMAIN        默认 ${DOMAIN}
  FORCE=1       跳过 confirm 提示(CI / 自动化用)

首次部署前:
  1. DNS A 记录 ${DOMAIN} → 服务器 IP
  2. ssh-copy-id ${SERVER_USER}@${SERVER_HOST}
  3. 远端 mysql 建 lumideck 库 + 用户(详见 docs/runbooks/deploy.md)
  4. 跑一次 ./scripts/deploy.sh ecosystem 把 deploy/ 同步上去
  5. ssh root@${SERVER_HOST} 跑 install-server.sh + 写 .env.production.local
  6. 本地 ./scripts/deploy.sh all
EOF
}

main() {
    if [ $# -eq 0 ]; then
        print_help
        exit 1
    fi

    local target="$1"
    echo "============================================"
    echo "  Lumideck 部署 → ${target}"
    echo "  ${SERVER_USER}@${SERVER_HOST}  ${DOMAIN}"
    echo "============================================"
    echo ""

    case "${target}" in
        creator)
            check_ssh
            build_creator
            deploy_creator
            ;;
        backend)
            confirm_destructive backend
            check_ssh
            build_agent
            deploy_ecosystem
            deploy_backend
            ;;
        ecosystem)
            check_ssh
            deploy_ecosystem
            ;;
        healthz)
            healthcheck
            ;;
        all)
            confirm_destructive all
            check_ssh
            build_creator
            build_agent
            deploy_ecosystem
            deploy_backend
            deploy_creator
            healthcheck
            ;;
        -h|--help|help)
            print_help
            ;;
        *)
            log_error "未知 target: ${target}"
            echo ""
            print_help
            exit 1
            ;;
    esac

    echo ""
    log_info "完成! https://${DOMAIN}"
}

main "$@"
