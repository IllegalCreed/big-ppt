#!/usr/bin/env bash
# Phase 10: Slidev 进程启动 wrapper(pm2 通过 ecosystem.config.cjs 调用)
#
# 职责:
#   1. ensure slides.md 存在(从 slides.example.md copy,首次启动用)
#   2. 用 slidev cli 起 dev server,绑 localhost(默认行为,不传 --remote)
#   3. 端口 3031,base /api/slidev-preview/(必须与 agent SLIDEV_PROXY_PREFIX 一致)
#
# 前提:此脚本部署到 /root/server/lumideck/deploy/scripts/start-slidev.sh
#       monorepo 根 /root/server/lumideck/ 已 pnpm install,packages/slidev/node_modules 存在

set -euo pipefail

MONOREPO_ROOT="/root/server/lumideck"
SLIDEV_DIR="${MONOREPO_ROOT}/packages/slidev"

cd "${SLIDEV_DIR}"

# 确保 slides.md 存在(运行时产物,部署 rsync 不带,gitignored)
if [ ! -f slides.md ]; then
    if [ -f slides.example.md ]; then
        cp slides.example.md slides.md
        echo "[start-slidev] copied slides.example.md → slides.md"
    else
        echo "[start-slidev] WARN: slides.example.md missing, slidev 可能起不来" >&2
    fi
fi

# Slidev 默认绑 localhost(不传 --remote);仅 agent 反代访问
exec pnpm exec slidev --port 3031 --base /api/slidev-preview/
