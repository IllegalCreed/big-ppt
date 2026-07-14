# Lumideck 生产部署 Runbook

> 生产域名：`https://lumideck.illegalscreed.cn`
> 默认主机：`root@47.120.26.143`
> 详细实现：`scripts/deploy.sh`、`deploy/`

## 运行架构

```text
Browser
  ├─ /, /decks/*, /share/* ── nginx ── /var/www/lumideck (creator SPA)
  └─ /api/*, /healthz      ── nginx ── 127.0.0.1:4000
                                           └─ pm2: lumideck-agent
                                                └─ MySQL / RDS
```

Phase 16 起生产只有一个应用进程 `lumideck-agent`。`packages/slidev` 是模板与组件设计
系统包，不再启动 dev server；nginx 也不再代理 `/@vite`、`/@fs`、
`/@server-ref` 或 `/api/slidev-preview`。

## 本地前置

1. Node 22、pnpm 10.29.2、SSH key 已配置。
2. `packages/agent/.env.production.local` 只存在于本机与服务器，不进 git。
3. 工作树已提交，且计划部署的 commit 已推送。
4. 本地全量 type-check、lint、test、build 和 E2E 已通过。

只读检查：

```bash
pnpm deploy:healthz
ssh -o BatchMode=yes root@47.120.26.143 'echo ok'
```

## 首次安装

先同步部署文件：

```bash
pnpm deploy:ecosystem
```

然后在远端执行一次：

```bash
DOMAIN=lumideck.illegalscreed.cn \
ACME_EMAIL=ops@illegalscreed.cn \
bash /root/server/lumideck/deploy/scripts/install-server.sh
```

`install-server.sh` 用两阶段 nginx bootstrap：先写 80-only 配置申请证书，再应用完整
HTTPS 模板。不要在证书不存在时直接安装含 `ssl_certificate` 的完整配置。

把真实生产环境文件放到：

```text
/root/server/lumideck/packages/agent/.env.production.local
```

至少包含：

```dotenv
NODE_ENV=production
DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/lumideck
SESSION_SECRET=<32-byte-random-hex>
APIKEY_MASTER_KEY=<32-byte-random-hex>
AGENT_PORT=4000
PUBLIC_ORIGIN=https://lumideck.illegalscreed.cn
LUMIDECK_ASSETS_DIR=/var/lumideck/user-assets
```

## 日常完整部署

```bash
FORCE=1 pnpm deploy:all
```

执行顺序：

1. 构建 creator、shared、slidev catalog 与 agent。
2. 同步 `deploy/`，运行 `apply-nginx.sh`；该脚本先备份现有配置，`nginx -t` 失败会回滚。
3. 同步后端 monorepo，排除 `.env.*.local`、日志、素材与测试产物。
4. 远端 `pnpm install --frozen-lockfile`。
5. `drizzle-kit push:prod`，输出落 `/tmp/lumideck-dbpush.log` 并 grep 非 TTY 交互崩溃签名。
6. `db:verify:prod` schema 一致性门：对比 dist schema 与 information_schema 的表/列/索引，
   缺失即中止（exit 3），**pm2 不 reload、旧进程继续跑**。
7. `pm2 startOrReload` 注入本次 `GIT_SHA`，删除旧 `lumideck-slidev` 进程并 `pm2 save`。
8. rsync creator 静态文件。
9. healthz 轮询，要求 `status=ok` 且 `gitSha` 精确匹配本次 commit。

拆分部署：

```bash
pnpm deploy:creator       # 只构建并同步 SPA
pnpm deploy:backend       # 后端、schema、PM2、healthz
pnpm deploy:ecosystem     # deploy 配置 + 安全应用 nginx
pnpm deploy:healthz       # 只读探活
```

## 发布后验收

```bash
SHA=$(git rev-parse HEAD)
curl -fsS https://lumideck.illegalscreed.cn/api/healthz
curl -I https://lumideck.illegalscreed.cn/

ssh root@47.120.26.143 'pm2 list'
ssh root@47.120.26.143 \
  "grep -E '@vite|@server-ref|slidev-preview' /etc/nginx/conf.d/lumideck.conf || true"
```

必须满足：

- healthz HTTP 200、`"status":"ok"`、`gitSha` 等于 `$SHA`。
- `lumideck-agent` 为 `online`，不存在 `lumideck-slidev`。
- nginx 检索无输出。
- 首页、登录、编辑器、原生放映、演讲者窗口均可加载。
- 新建分享链接可在无 cookie 浏览器访问；撤销后返回准确的“已撤销”状态。
- 两个账号可同时放映不同 deck，不出现占用冲突 UI。

## Schema 核验

drizzle-kit 0.31 可能在 nullable → NOT NULL 时遗漏 DEFAULT。每次改 schema 后，dev、test
都要 push，并用 `SHOW COLUMNS` 核对；生产部署后同样抽查新列。本 Phase 重点：

```sql
SHOW COLUMNS FROM share_links LIKE 'access_count';
```

## 带风险 schema 变更的部署（先手工 DDL）

drizzle-kit push 遇「有数据的表加唯一索引」等风险变更会弹交互确认，非 TTY 下崩溃且
exit 0（2026-07-14 Phase 17 实锤）。部署脚本会 grep 崩溃签名 + `db:verify:prod` 拦住，
但**正确姿势是部署前先手工补 DDL**：

1. SSH 到部署机，在 `packages/agent` 下写一次性 `.mjs`（mysql2 + `DATABASE_URL`），
   每条 DDL 带存在性 guard（`SHOW TABLES LIKE` / `SHOW COLUMNS LIKE`），用完即删。
2. 绝不选 truncate；加唯一索引时若新列全 NULL，MySQL 唯一索引允许多 NULL，直接
   `ALTER TABLE ... ADD UNIQUE KEY` 零风险。
3. 补完跑 `pnpm -F @big-ppt/agent db:verify:prod` 确认绿，再执行正常部署
   （此时 push 为 no-op，不再弹确认）。

任何时候可单独核验：`ssh` 到部署机跑 `db:verify:prod`，或本地跑 `db:verify` /
`db:verify:test` 对 dev / test 库做同样检查（脚本读 `dist/db/schema.js`，先 build）。

期望 `Null=NO`、`Default=0`。

## 故障排查

### healthz 502

```bash
ssh root@47.120.26.143 'pm2 logs lumideck-agent --lines 100 --nostream'
ssh root@47.120.26.143 'ss -tnlp | grep :4000 || true'
```

如果 PM2 restart 次数持续增长且 4000 被非 PM2 tracked PID 占用，是 wrapper grandchild
残留；确认 PID 后终止占端口进程，PM2 会拉起新实例。

### healthz down

检查 `.env.production.local`、RDS 网络和 `DATABASE_URL`。healthz 只检查 DB，不存在
`degraded`/Slidev 状态。

### nginx 更新失败

`apply-nginx.sh` 会自动恢复备份并拒绝 reload。查看：

```bash
ssh root@47.120.26.143 'nginx -t && tail -100 /var/log/nginx/error.log'
```

### 分享页图片 404

公开页面不得直接请求 owner API `/api/assets/:id`；presentation payload 应改写为
`/api/share/:slug/assets/:assetId`。确认链接仍 active、asset 属于同一 deck，响应应带
`Cache-Control: private, no-store`。

## 备份与回滚

`install-server.sh` 配置每日 02:00 执行 `deploy/scripts/db-backup.sh`，备份位于
`/root/backups/lumideck/`，保留 30 天。

代码回滚必须使用一个已知良好的 git commit 重新执行完整部署，不要在服务器手改 dist：

```bash
git switch --detach <known-good-sha>
FORCE=1 pnpm deploy:all
```

schema 变更默认向前兼容；涉及破坏性 DB 回滚时先停写、备份，再单独 review SQL。任何
`.env.*.local`、API key、数据库密码都不得进入 rsync 输入清单、日志或 git 历史。
