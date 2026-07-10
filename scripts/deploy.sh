#!/usr/bin/env bash
# ============================================================
# Lumideck 一键部署脚本(Phase 10)
# 用法:./scripts/deploy.sh <creator|backend|ecosystem|healthz|all>
#
# 参数(必传,无参数打 help 不部署):
#   creator    — 仅 build + 部署 creator(SPA 静态文件到 /var/www/lumideck/)
#   backend    — build agent + 同步 monorepo + 远端 pnpm install + db:push:prod + pm2 reload + healthz
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
HEALTHCHECK_URL="${HEALTHCHECK_URL:-https://${DOMAIN}/api/healthz}"
HEALTHCHECK_ATTEMPTS="${HEALTHCHECK_ATTEMPTS:-10}"
HEALTHCHECK_RETRY_SECONDS="${HEALTHCHECK_RETRY_SECONDS:-3}"
HEALTHCHECK_TIMEOUT_SECONDS="${HEALTHCHECK_TIMEOUT_SECONDS:-10}"

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

resolve_git_sha() {
    local sha="${GIT_SHA:-}"
    if [ -z "${sha}" ] && command -v git >/dev/null 2>&1; then
        sha="$(git -C "${PROJECT_ROOT}" rev-parse --verify HEAD 2>/dev/null || true)"
    fi

    # 只允许 git hex，避免把任意环境变量插进远端 shell。
    if [[ "${sha}" =~ ^[0-9a-fA-F]{7,40}$ ]]; then
        echo "${sha}"
    else
        echo "unknown"
    fi
}

DEPLOY_GIT_SHA="$(resolve_git_sha)"

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
    log_info "构建 shared + slidev catalog + agent(tsc)"
    cd "${PROJECT_ROOT}"
    # shared 必须先 build:agent dist 里 import '@big-ppt/shared',
    # shared 的 src/index.ts 用 NodeNext 风格 `from './chat.js'`,
    # 生产 node 找不到 .js → 必须由 tsc 把 src/*.ts → src/*.js 落盘
    pnpm -F @big-ppt/shared build
    # 同样 slidev components-catalog 也用 NodeNext `from './x.meta.js'` 风格,
    # 必须先 emit *.meta.js + _catalog/index.js,否则 prod agent 启动时
    # ERR_MODULE_NOT_FOUND(Phase 11.6 后引入,deploy.md 已知坑 #5 同套路)
    pnpm -F @big-ppt/slidev build:catalog
    pnpm -F @big-ppt/agent build
}

# 远端 mkdir 父目录(rsync 不会自动建)
ensure_remote_dirs() {
    ssh "${SERVER_USER}@${SERVER_HOST}" "mkdir -p ${REMOTE_MONOREPO} ${REMOTE_MONOREPO}/deploy ${REMOTE_WEB}"
}

# ── 部署:ecosystem 配置(deploy/ 目录) ─────
deploy_ecosystem() {
    ensure_remote_dirs
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
    ensure_remote_dirs
    log_info "同步 creator/dist → ${REMOTE_WEB}/"
    rsync -az --delete "${dist}/" "${SERVER_USER}@${SERVER_HOST}:${REMOTE_WEB}/"
    log_info "creator ✓"
}

# ── 部署:backend(agent dist + slidev 源码 + monorepo lockfile) ─────
deploy_backend() {
    ensure_remote_dirs
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

        echo '==> 确保 Phase 13 用户素材目录存在(LUMIDECK_ASSETS_DIR)'
        # 默认 /var/lumideck/user-assets;若 .env.production.local 显式 override 路径,
        # 部署运维需自行处理。此处保证默认路径可写,避免首次启动 enqueueExtraction
        # 或 putAssetBytes 失败。
        mkdir -p /var/lumideck/user-assets
        chmod 755 /var/lumideck /var/lumideck/user-assets || true

        echo '==> drizzle-kit push:prod(幂等,无 schema 变化为 no-op)'
        pnpm -F @big-ppt/agent db:push:prod 2>&1 | tail -10 || {
            echo 'WARN: db:push:prod 失败,检查 .env.production.local 与 DB 连通性'
            exit 2
        }

        echo '==> pm2 startOrReload ecosystem(GIT_SHA=${DEPLOY_GIT_SHA})'
        GIT_SHA='${DEPLOY_GIT_SHA}' pm2 startOrReload ${REMOTE_MONOREPO}/deploy/ecosystem.config.cjs --update-env

        echo '==> pm2 status'
        pm2 list
    "
    log_info "backend ✓"
}

# ── healthcheck ─────────────────────────────
healthcheck() {
    local expected_git_sha="${1:-${EXPECTED_GIT_SHA:-}}"
    local result="" http_code="000" failure_reason="" attempt body_file

    if ! [[ "${HEALTHCHECK_ATTEMPTS}" =~ ^[1-9][0-9]*$ ]]; then
        log_error "HEALTHCHECK_ATTEMPTS 必须是正整数"
        return 1
    fi
    if ! [[ "${HEALTHCHECK_RETRY_SECONDS}" =~ ^[0-9]+$ ]]; then
        log_error "HEALTHCHECK_RETRY_SECONDS 必须是非负整数"
        return 1
    fi
    if ! [[ "${HEALTHCHECK_TIMEOUT_SECONDS}" =~ ^[1-9][0-9]*$ ]]; then
        log_error "HEALTHCHECK_TIMEOUT_SECONDS 必须是正整数"
        return 1
    fi

    body_file="$(mktemp /tmp/lumideck-healthz.XXXXXX)"
    log_info "Healthcheck → ${HEALTHCHECK_URL}"

    for ((attempt = 1; attempt <= HEALTHCHECK_ATTEMPTS; attempt++)); do
        : > "${body_file}"
        if ! http_code=$(curl -sS -w '%{http_code}' -o "${body_file}" \
            --max-time "${HEALTHCHECK_TIMEOUT_SECONDS}" \
            "${HEALTHCHECK_URL}"); then
            http_code="000"
        fi
        result="$(cat "${body_file}" 2>/dev/null || true)"
        failure_reason="status 未就绪"

        if [ "${http_code}" = "200" ] && [[ "${result}" == *'"status":"ok"'* ]]; then
            if [ -n "${expected_git_sha}" ] && \
                [[ "${result}" != *"\"gitSha\":\"${expected_git_sha}\""* ]]; then
                failure_reason="gitSha 尚未切到 ${expected_git_sha}"
            else
                log_info "HTTP ${http_code}(attempt ${attempt}/${HEALTHCHECK_ATTEMPTS})"
                printf '%s\n' "${result:0:600}"
                log_info "healthz: status=ok${expected_git_sha:+, gitSha=${expected_git_sha}} ✓"
                rm -f "${body_file}"
                return 0
            fi
        elif [[ "${result}" == *'"status":"degraded"'* ]]; then
            failure_reason="status=degraded(Slidev 尚未就绪)"
        fi

        log_warn "HTTP ${http_code}(attempt ${attempt}/${HEALTHCHECK_ATTEMPTS}): ${failure_reason}"
        if [ "${attempt}" -lt "${HEALTHCHECK_ATTEMPTS}" ] && \
            [ "${HEALTHCHECK_RETRY_SECONDS}" -gt 0 ]; then
            sleep "${HEALTHCHECK_RETRY_SECONDS}"
        fi
    done

    if [ -n "${result}" ]; then
        printf '%s\n' "${result:0:600}"
    fi
    rm -f "${body_file}"
    log_error "healthz 在 ${HEALTHCHECK_ATTEMPTS} 次尝试后仍未就绪,远端跑 pm2 logs lumideck-agent 排查"
    return 1
}

# ── 主路由 ──────────────────────────────────
print_help() {
    cat <<EOF
Lumideck 部署脚本(Phase 10)

用法: $0 <creator|backend|ecosystem|healthz|all>

  creator    SPA build + 部署到 ${REMOTE_WEB}
  backend    agent dist + monorepo 同步 + 远端 pnpm install + db:push:prod + pm2 reload + healthz
             ⚠️  会改远端代码 + DB schema + 重启进程,前置 confirm
  ecosystem  同步 deploy/ 配置文件(ecosystem.config.cjs / nginx 模板 / 远端脚本)
  healthz    打 ${HEALTHCHECK_URL} 看状态(只读)
  all        以上全部按顺序跑(完整部署,前置 confirm)

环境变量:
  SERVER_HOST   默认 ${SERVER_HOST}
  SERVER_USER   默认 ${SERVER_USER}
  DOMAIN        默认 ${DOMAIN}
  FORCE=1       跳过 confirm 提示(CI / 自动化用)
  HEALTHCHECK_URL            healthz 地址(默认 ${HEALTHCHECK_URL})
  HEALTHCHECK_ATTEMPTS       healthz 最大尝试次数(默认 ${HEALTHCHECK_ATTEMPTS})
  HEALTHCHECK_RETRY_SECONDS  healthz 重试间隔秒数(默认 ${HEALTHCHECK_RETRY_SECONDS})
  HEALTHCHECK_TIMEOUT_SECONDS 单次 healthz 超时秒数(默认 ${HEALTHCHECK_TIMEOUT_SECONDS})
  EXPECTED_GIT_SHA           healthz 子目标可选的期望版本

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
            healthcheck "${DEPLOY_GIT_SHA}"
            ;;
        ecosystem)
            check_ssh
            deploy_ecosystem
            ;;
        healthz)
            healthcheck "${EXPECTED_GIT_SHA:-}"
            ;;
        all)
            confirm_destructive all
            check_ssh
            build_creator
            build_agent
            deploy_ecosystem
            deploy_backend
            deploy_creator
            healthcheck "${DEPLOY_GIT_SHA}"
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
