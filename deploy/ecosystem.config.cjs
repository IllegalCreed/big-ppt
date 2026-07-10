/**
 * Lumideck PM2 ecosystem。
 *
 * 远端 monorepo 根目录:/root/server/lumideck/
 * 单进程:lumideck-agent 监听 0.0.0.0:4000,nginx 反代到 localhost:4000。
 *
 * env 加载:agent 用 start-agent.sh wrapper 调 dotenv-cli(`pnpm exec dotenv -e .env.production.local -- node dist/index.js`),
 * 与本地 `pnpm start` 行为一致;之前用 `-r dotenv/config` + DOTENV_CONFIG_PATH 通过 pm2 ecosystem 传给 node CLI 实测不可靠。
 * 配套脚本:start-agent.sh / db-backup.sh 由 deploy.sh 同步到远端。
 */
module.exports = {
  apps: [
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
