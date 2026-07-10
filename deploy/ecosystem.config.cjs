/**
 * Phase 10: Lumideck PM2 ecosystem。
 *
 * 远端 monorepo 根目录:/root/server/lumideck/
 * 两个进程:
 *   - lumideck-slidev:绑 localhost:3031,只让 agent 内部反代
 *   - lumideck-agent:监听 0.0.0.0:4000,nginx 反代到此(localhost:4000)
 *
 * 启动顺序:slidev 先(restart_delay=0),agent 后(restart_delay=2000),
 * 让 agent 启动时反代 + 健康检查不抖动。
 *
 * env 加载:agent 用 start-agent.sh wrapper 调 dotenv-cli(`pnpm exec dotenv -e .env.production.local -- node dist/index.js`),
 * 与本地 `pnpm start` 行为一致;之前用 `-r dotenv/config` + DOTENV_CONFIG_PATH 通过 pm2 ecosystem 传给 node CLI 实测不可靠。
 * slidev 不需要 env(纯前端 dev server)。
 *
 * 配套脚本:start-agent.sh / start-slidev.sh / db-backup.sh 由 deploy.sh 同步到远端。
 */
module.exports = {
  apps: [
    {
      name: 'lumideck-slidev',
      cwd: '/root/server/lumideck/packages/slidev',
      script: '/root/server/lumideck/deploy/scripts/start-slidev.sh',
      interpreter: 'bash',
      max_memory_restart: '512M',
      restart_delay: 0,
      kill_timeout: 5000,
      env: {
        // Slidev 跑 dev 模式(Vite dev server + HMR),必须 NODE_ENV=development。
        // 设 production 时 Vite 不注入 __DEV__ build-time constant,iframe 内
        // env.ts 抛 `ReferenceError: __DEV__ is not defined` 整个 SFC 起不来。
        // (plan 19 踩坑期发现:dev mode + NODE_ENV=production 是边缘组合,Vite 不支持)
        NODE_ENV: 'development',
      },
    },
    {
      name: 'lumideck-agent',
      cwd: '/root/server/lumideck/packages/agent',
      script: '/root/server/lumideck/deploy/scripts/start-agent.sh',
      interpreter: 'bash',
      // start-agent.sh 用 `pnpm exec dotenv -e .env.production.local -- node dist/index.js`,
      // 与本地 `pnpm start` 行为一致;之前用 `-r dotenv/config` + DOTENV_CONFIG_PATH 通过
      // pm2 ecosystem 传给 node CLI 不可靠(实测 process.env.DATABASE_URL 仍未被注入)
      max_memory_restart: '768M',
      restart_delay: 2000,
      listen_timeout: 10000,
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production',
        // deploy.sh 从本地已提交 HEAD 注入，healthz 用它确认线上已切到本次版本。
        GIT_SHA: process.env.GIT_SHA || 'unknown',
      },
    },
  ],
};
