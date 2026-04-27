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
 * env 加载:agent 用 dotenv preload(`-r dotenv/config` + DOTENV_CONFIG_PATH);
 * slidev 不需要 env(纯前端 dev server)。
 *
 * 配套脚本:start-slidev.sh / db-backup.sh 由 deploy.sh 同步到远端。
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
        NODE_ENV: 'production',
      },
    },
    {
      name: 'lumideck-agent',
      cwd: '/root/server/lumideck/packages/agent',
      script: 'dist/index.js',
      interpreter: 'node',
      // dotenv 通过 preload + DOTENV_CONFIG_PATH 读 .env.production.local;
      // 比 wrap dotenv-cli 更稳(避免 ESM 加载顺序坑,quiz 上踩过)
      interpreter_args: '-r dotenv/config',
      node_args: '--enable-source-maps',
      max_memory_restart: '768M',
      restart_delay: 2000,
      listen_timeout: 10000,
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production',
        DOTENV_CONFIG_PATH: '/root/server/lumideck/packages/agent/.env.production.local',
      },
    },
  ],
};
