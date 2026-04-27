#!/usr/bin/env bash
# Phase 10: Lumideck agent 进程启动 wrapper(pm2 通过 ecosystem.config.cjs 调用)
#
# 用 dotenv-cli 加载 .env.production.local 的方式与本地 `pnpm start` 一致,
# 避免 ecosystem.config 的 interpreter_args 传 dotenv preload 时不可靠。
#
# 前提:此脚本部署到 /root/server/lumideck/deploy/scripts/start-agent.sh
#       monorepo 根 /root/server/lumideck/ 已 pnpm install
#       packages/agent/dist/index.js 已 build
#       packages/agent/.env.production.local 存在(secrets)

set -euo pipefail

MONOREPO_ROOT="/root/server/lumideck"
AGENT_DIR="${MONOREPO_ROOT}/packages/agent"

cd "${AGENT_DIR}"

if [ ! -f .env.production.local ]; then
    echo "[start-agent] FATAL: .env.production.local 不存在,先 scp 上去" >&2
    exit 1
fi

if [ ! -f dist/index.js ]; then
    echo "[start-agent] FATAL: dist/index.js 不存在,先在本地跑 pnpm -F @big-ppt/agent build + deploy.sh backend" >&2
    exit 1
fi

# dotenv-cli 把 .env.production.local 注入到 node 进程的 process.env,
# 与本地 pnpm start 一致的行为
exec pnpm exec dotenv -e .env.production.local -- node --enable-source-maps dist/index.js
