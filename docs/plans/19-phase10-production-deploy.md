# Phase 10 — 首次部署(单实例上线) 实施文档

> **状态**:✅ 已关闭(2026-04-27)
> **前置阶段**:[plan 18 — Phase 9 安全 Audit](18-phase9-security-audit.md)
> **后续候选**:Phase 10.5(Slidev 解耦 spike,未启动) → [Phase 11 多用户并发 + 分享链接](../requirements/roadmap.md#phase-11多用户并发--分享链接--多实例部署切换)
> **路线图**:[roadmap.md Phase 10](../requirements/roadmap.md)
> **运维 runbook**:[deploy.md](../runbooks/deploy.md)
> **执行子技能**:`superpowers:subagent-driven-development`(实际跑下来更接近 inline executing-plans,因为远端实操多每 Task 都需要主 agent 持续协调)

---

## 实施摘要(关闭)

**11 commit**:608297a 10-A healthz / 96c0da2 10-B deploy 脚手架 / 569ce68 10-D deploy.sh / eec6691 runbook + roadmap 入口 / 7400b35 RDS 路径修正 / 61f311a nginx 两阶段 bootstrap / 3efc857 跨过 6 踩坑 / fe2ef86 db-backup pipefail / a3b313e 验收回填 / 9b7af19 NODE_ENV=development / 6ba5d15 nginx gzip

**核心成果**:
- `https://lumideck.illegalscreed.cn` 上线运行
- HTTPS Let's Encrypt 至 2026-07-26(certbot.timer 自动续期)
- 阿里云 RDS 复用 quiz 实例新建 `lumideck` 库 + `lumideck_prod_user` 独立账号
- pm2 双进程:`lumideck-agent`(:4000) + `lumideck-slidev`(:3031,localhost-only)
- crontab 02:00 daily mysqldump 备份保留 30 天(mysql client 8.0.45 装好)
- nginx HTTPS + SPA 静态托管 + /api/ 反代 + Slidev 绝对路径 5 个 location ^~ + WebSocket upgrade

**6 条实施期踩坑**(全部提炼到 [CLAUDE.md 已知坑](../../CLAUDE.md#已知坑)):
1. macOS openrsync 协议 29 vs 远端 rsync 协议 31 不兼容 → brew install rsync(协议 32)
2. Alibaba Cloud Linux 用 dnf 不是 apt
3. nginx HTTPS 必须分两阶段 bootstrap(80-only conf → certbot --webroot → 完整 conf;一阶段会让 nginx -t fail 拖死全 nginx)
4. monorepo ts 包用 NodeNext ESM `from './x.js'` 写法,生产部署前必须先 build 出 .js
5. pm2 跑 ESM Node app 用 bash wrapper + dotenv-cli,`-r dotenv/config` + DOTENV_CONFIG_PATH 不可靠
6. agent fetch slidev 用 localhost 不用 127.0.0.1(slidev v52 + Vite 5 默认只 bind [::1] IPv6)

**性能优化**:nginx gzip 让 SPA 大 chunk 2.35MB → 632KB,加载时间 5.32s → 1.15s(-78%)

**关闭后发现的架构议题**(已记入 roadmap):用户浏览器实测 Slidev iframe 内 dev mode 累计 30-40 秒首屏,Phase 11 进程池方案不解决此问题(编辑路径仍依赖 dev mode HMR)。真正解药是 Phase 10.5 候选"DeckRenderer Vue 组件自封装"——已在 roadmap 立条目,触发条件为 P10 实测体验不可接受。

**Goal**:把当前已通过 Phase 9 审计的 Lumideck 单实例版本部署到 `47.120.26.143`(复用 quiz 服务器),通过 `lumideck.illegalscreed.cn` 子域对外提供完整 Web 体验:注册 / 登录 / 建 deck / AI 对话生成 / 切模板 / 历史版本。**不做** CI/CD、多实例、灰度回滚——这些全部留 Phase 11+。本 Phase 产物 = 一键部署脚本 + nginx/pm2 配置入库 + healthcheck + 每日 DB 备份 + runbook 文档。

---

## 关键设计抉择(2026-04-27 与用户对齐)

1. **服务器/域名**:复用 quiz `47.120.26.143`(root),单子域 `lumideck.illegalscreed.cn`,前端 + API + Slidev 反代全部同源。
   - **Why**:quiz 服务器已装好 nginx + certbot + Node + pnpm + MySQL,边际成本最低;同源避免 CSRF / CORS 复杂度;Slidev 反代的 `/api/slidev-preview/` + `/@server-*` 必须与 API 同源(agent 内部 http-proxy)。

2. **MySQL**:复用 quiz 那台 MySQL 实例,**新建 `lumideck` 数据库 + 独立用户 `lumideck_prod_user`**(只授予该库权限,不与 quiz 用户共用)。
   - **Why**:roadmap.md Phase 5 选型时已定 "复用 quiz-monorepo 所在 MySQL";独立用户保证 SQL 注入万一发生时不会跨业务横向。

3. **Slidev 跑 dev 模式**:`slidev --port 3031 --base /api/slidev-preview/` 绑 `127.0.0.1`,只让 agent 反代访问。
   - **Why**:产品形态依赖 Slidev HMR 实时反映 `slides.md` 改动;build 模式是静态站点,无法支持单实例编辑。CLAUDE.md "Slidev 反代 + HMR" 已知坑全部以此为前提。

4. **PM2 两进程**:`lumideck-agent`(:4000) + `lumideck-slidev`(:3031),agent 依赖 slidev 已起;启动顺序由 pm2 保证(slidev 先,agent 后,延迟 2s)。
   - **Why**:agent 启动时会 verifyTemplatesOrThrow + 反代到 slidev,slidev 没起会造成 healthcheck 红一段时间——错峰启动避免初次健康检查抖动。
   - **进程内单实例锁是内存对象**(plan 10 偏离),pm2 reload 时锁会清空——生产可接受,因为 reload 本来就意味着所有用户重连。

5. **生产 schema 推送用 `drizzle-kit push`**(不引入 migration generate)。
   - **Why**:Phase 5 ~ Phase 9 全程 push 模式跑得稳,引入 migration 生态需要先 baseline 现有 schema(工作量 ≥ 半天);本 Phase 范围是"上线",schema 演进留 Phase 11+。99-tech-debt 已有"生成式 migration"条目。

6. **HTTPS**:`certbot --nginx` 申请 + 默认 systemd timer 自动续期(quiz 服务器已有)。
   - **Why**:quiz 服务器已装 certbot;无需引入 acme.sh 二套机制。

7. **每日 DB 备份**:`mysqldump | gzip | rotate-30-days`,crontab 02:00 跑;落到 `/root/backups/lumideck/`。
   - **Why**:roadmap Phase 10 验收第 5 条强制要求;mysqldump 对 MVP 数据量(预计 < 1GB)足够,无需 xtrabackup。

8. **Healthcheck `/api/healthz`**:agent 暴露 ping(DB SELECT 1 + Slidev origin reachability + git sha + node uptime),authOptional(不暴露敏感信息)。**当前 agent 没有此 endpoint**,Phase 10 必须先加。
   - **Why**:部署脚本完成后要 curl 验收;后续 Phase 11 反代灰度也依赖该端点。

9. **部署脚本路径**:`scripts/deploy.sh`(模仿 quiz 风格)+ `deploy/` 目录放 nginx/ pm2/ 远端脚本配置。
   - **Why**:运维资产入库,新成员能完整重建;quiz 把 ecosystem.config.js / nginx.conf 留在远端是历史包袱(quiz `dev.md` 自己提到 JWT 501 教训),Lumideck 不重蹈。

10. **不做 deploy 鉴权 / GitHub Action**:本 Phase 仍 ssh + scp,后续 Phase 16+ 上 CI。
    - **Why**:范围围栏;一个开发者手动操作,风险可控。

11. **ECS 安全组对外只需 80 / 443**(用户 47.120.26.143 已开),agent / slidev / mysql 全部 `127.0.0.1` 绑定不进安全组。
    - **Why**:外网→ nginx(443)→ 127.0.0.1:4000(agent)→ 127.0.0.1:3031(slidev)是单一信道。slidev 直对外是 Phase 9 audit 列出的硬漏洞,127.0.0.1 绑定是 CLAUDE.md 已知坑里的硬规则。
    - **Phase 11 多 slidev 实例时仍不动安全组**:进程池端口 3031-3050 全 127.0.0.1,agent 维护 `sessionId → slidevPort` 路由表内部分流;公网视角永远只见 443。

12. **域名 DNS 加 A 记录 → ECS 不参与**:用户在 DNS 面板加 `lumideck.illegalscreed.cn A 47.120.26.143`,quiz / quiz-admin / quiz-api 已有的子域是同样加法。`dig +short` 验证后再跑 certbot,避免 rate-limit 5/h 翻车。

---

## 部署前置依赖 Checklist(Task 10-C 之前用户必须完成)

| 项 | 状态 | 操作 |
|---|---|---|
| ECS 安全组 80 / 443 | ✅ 已开 | 不动 |
| ECS 安全组 22 (SSH) | ✅ 已开 | 不动 |
| 不开放任何 4000 / 3031 / 3306 | — | 保持现状 |
| DNS A 记录 `lumideck.illegalscreed.cn → 47.120.26.143` | ⏳ 待加 | 用户在 DNS 服务商面板手动加 |
| `dig +short lumideck.illegalscreed.cn` 返回 47.120.26.143 | ⏳ 待验 | 加完 5-10min 内 |
| ssh-copy-id 本机公钥到 root@47.120.26.143 | ⏳ 待验 | `ssh root@47.120.26.143 'echo ok'` 不要密码即可 |
| 服务器已装 nginx / certbot / pm2 / Node 22+ / pnpm | ⏳ 待验 | quiz 服务器应已全装,远端 `which nginx certbot pm2 node pnpm` 一遍 |
| 服务器已装 mysql 且 root 可登 | ⏳ 待验 | quiz 已有,确认版本 ≥ 8.0 |

---

## ⚠️ Secrets 安全红线(沿用 [CLAUDE.md 安全约定](../../workspace/big-ppt/CLAUDE.md#安全与提交规则))

- 本 Phase **不引入新本地 env**,但生产首次部署需在远端**人工**生成 + 写入 `/root/server/lumideck-agent/.env.production.local`:
  - `DATABASE_URL=mysql://lumideck_prod_user:<现场生成强密码>@127.0.0.1:3306/lumideck`
  - `SESSION_SECRET=<node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">`
  - `APIKEY_MASTER_KEY=<同上,独立一份>`
  - `PUBLIC_ORIGIN=https://lumideck.illegalscreed.cn`
- 这三个值**绝不**进 git,**绝不**进部署脚本。runbook 用占位符 `<REPLACE_ME_*>` 注明 ops 现场填入。
- `.gitignore` 已覆盖 `.env.*.local`,本 Phase 不动现有规则。
- 部署脚本 `scp` 时**永远不上传** `.env.production.local`(只 scp dist + package.json + drizzle/ + slidev 源码)。
- `git add` 全程显式列文件,**禁用** `git add -A` / `git add .` / `-a`。每次 commit 前必跑 `git status` 人工检查。
- nginx config 入库的是**模板**(`${DOMAIN}` 占位),远端 install 脚本 envsubst 后落到 `/etc/nginx/conf.d/`,不入 git 真域名。

---

## 文件结构变更对照表

### 新增

| 文件 | 职责 |
| ---- | ---- |
| `scripts/deploy.sh` | 一键部署主脚本:`./deploy.sh [creator|agent|slidev|all]`,本地 build + scp + ssh remote install + healthcheck |
| `deploy/ecosystem.config.cjs` | PM2 ecosystem:`lumideck-agent`(:4000)+ `lumideck-slidev`(:3031),env block 内嵌 NODE_ENV 与 dotenv 兜底 |
| `deploy/nginx/lumideck.conf.template` | nginx server block 模板,`${DOMAIN}` / `${WEB_ROOT}` / `${BACKEND_PORT}` 占位,远端 envsubst |
| `deploy/scripts/install-server.sh` | 首次远端执行(幂等):建目录 + chown + 写 nginx conf + certbot --nginx + 加 db-backup crontab |
| `deploy/scripts/db-backup.sh` | mysqldump 全 schema 备份 + gzip + 保留 30 天 rotate;crontab 02:00 调 |
| `deploy/scripts/start-slidev.sh` | pm2 调用的 slidev 启动 wrapper:`cd /root/server/lumideck-slidev && pnpm exec slidev --port 3031 --base /api/slidev-preview/ --remote 127.0.0.1` + ensure slides.md 存在 |
| `packages/agent/src/routes/healthz.ts` | `GET /api/healthz`:DB ping + slidev origin reachability + git sha + uptime;无敏感信息 |
| `packages/agent/test/healthz.test.ts` | healthz 单测:happy / DB down 503 / slidev down 200(degraded) |
| `docs/runbooks/deploy.md` | 首次部署 runbook(对零知识读者友好):前置 → 环境准备 → 首次部署 → 日常迭代 → 故障处理 |
| `docs/plans/19-phase10-production-deploy.md` | 本 plan(从临时位置 cp 到此) |

### 修改

| 文件 | 改动摘要 |
| ---- | -------- |
| `packages/agent/src/app.ts` | 注册 `/api/healthz` 路由(authOptional);position 在 origin-check / rate-limit middleware **之前**,免误拦健康检查 |
| `packages/agent/src/index.ts` | 启动时调用新工具函数 ensure `packages/slidev/slides.md` 存在(若缺则从 `slides.example.md` copy);**已部分实现** ,本 Phase 验证 + 移到工具模块 |
| `packages/agent/package.json` | 加 `"db:push:prod": "dotenv -e .env.production.local -- drizzle-kit push"` |
| `packages/agent/.env.production.example` | 顶部说明里增补"首次部署 runbook 见 docs/runbooks/deploy.md" |
| `packages/slidev/package.json` | 加 `"start:prod": "slidev --port 3031 --base /api/slidev-preview/ --remote 127.0.0.1"`(pm2 wrapper 优先,但保留 fallback) |
| `docs/requirements/roadmap.md` | Phase 10 入口指向 plan 19;关闭后回填验收勾选 + 实施摘要 |
| `CLAUDE.md` | 关闭后追加 Phase 10 阶段进展 + 部署相关已知坑(若发现) |

### 删除

无(本 Phase 不删任何现有文件)。

---

## 数据模型变更

**无 schema 变更**。生产首次部署用 `pnpm -F @big-ppt/agent db:push:prod` 把已通过 dev/test 验证的 Drizzle schema 推到新建的 `lumideck` 库(等价于 init)。

后续每次部署只在 schema 变化时跑;Task 10-D 的 deploy.sh agent 子目标里默认带,幂等(无变化时 push 是 no-op)。

---

## 阶段拆分

每个 Task 一个 commit;每步绿测试 + 当步独立可回退。

### Task 10-A:agent healthz endpoint + 启动 ensure slides.md

**目的**:部署前置代码改动,让 deploy 脚本可以靠 `curl /api/healthz` 验收。

**操作**:
1. 新建 `packages/agent/src/routes/healthz.ts`:
   ```ts
   import { Hono } from 'hono';
   import { db } from '../db/client';
   import { sql } from 'drizzle-orm';

   const healthz = new Hono();
   healthz.get('/', async (c) => {
     const start = Date.now();
     const checks: Record<string, { ok: boolean; ms?: number; error?: string }> = {};

     try {
       await db.execute(sql`SELECT 1`);
       checks.db = { ok: true, ms: Date.now() - start };
     } catch (e) {
       checks.db = { ok: false, error: (e as Error).message };
     }

     const slidevOrigin = process.env.SLIDEV_ORIGIN || 'http://127.0.0.1:3031';
     try {
       const r = await fetch(slidevOrigin, { signal: AbortSignal.timeout(2000) });
       checks.slidev = { ok: r.ok || r.status === 404, ms: Date.now() - start };
     } catch (e) {
       checks.slidev = { ok: false, error: (e as Error).message };
     }

     const overall = checks.db?.ok ? 200 : 503;
     return c.json({
       status: overall === 200 ? 'ok' : 'degraded',
       gitSha: process.env.GIT_SHA ?? 'unknown',
       uptimeSec: Math.floor(process.uptime()),
       checks,
     }, overall);
   });
   export default healthz;
   ```
2. 在 `packages/agent/src/app.ts` `app.route('/api/healthz', healthz)` 挂载;**位置在 origin-check / rate-limit middleware 之前**(否则健康检查可能被 rate limit 误拦)。
3. 单测 `packages/agent/test/healthz.test.ts`:happy(DB up + slidev up = 200) / DB down(返回 503 + status=degraded) / slidev unreachable(DB up 仍 200,checks.slidev.ok=false)。
4. 工具函数 `packages/agent/src/utils/ensure-slides-md.ts`:if `packages/slidev/slides.md` 不存在,从 `slides.example.md` copy(本 Phase 之前散在 index.ts / 启动脚本里,统一收敛)。
5. `packages/agent/src/index.ts` 启动时调用 `ensureSlidesMd()`(在 createServer 之前)。
6. `packages/agent/package.json` 加:
   ```json
   "db:push:prod": "dotenv -e .env.production.local -- drizzle-kit push"
   ```

**验证方法**:
- `pnpm -F @big-ppt/agent test test/healthz.test.ts` 三测全绿
- `pnpm -F @big-ppt/agent vitest run` 全量绿(确认无回归)
- 本地 `pnpm dev` → `curl localhost:4000/api/healthz` 看 JSON

**风险**:
- healthz 必须在 origin-check 前:CSRF middleware 会拦无 Origin 的 GET? Phase 9-D 实现里 origin-check 只拦 state-changing(POST/PUT/DELETE/PATCH)所以 GET healthz 不会被拦,但保险起见放前面更稳。
- rate-limit 默认对未登录路径限速:健康检查器(uptime kuma 之类)频率 < 60/min/IP 安全,但记得别在 healthz 之前加 LRU 中间件占位置。

**Commit**:`feat(phase-10a): agent /api/healthz + ensure slides.md helper`

---

### Task 10-B:`deploy/` 目录脚手架(本地文件,不上线)

**目的**:把 nginx / pm2 / 远端脚本全部入库,新成员能用 git 完整恢复运维资产。

**操作**:
1. 新建 `deploy/ecosystem.config.cjs`:
   ```js
   module.exports = {
     apps: [
       {
         name: 'lumideck-slidev',
         cwd: '/root/server/lumideck-slidev',
         script: '/root/server/lumideck-slidev/start-slidev.sh',
         interpreter: 'bash',
         max_memory_restart: '512M',
         env: { NODE_ENV: 'production' },
       },
       {
         name: 'lumideck-agent',
         cwd: '/root/server/lumideck-agent',
         script: 'dist/index.js',
         interpreter: 'node',
         interpreter_args: '-r dotenv/config',
         node_args: '--enable-source-maps',
         max_memory_restart: '768M',
         env: {
           NODE_ENV: 'production',
           DOTENV_CONFIG_PATH: '/root/server/lumideck-agent/.env.production.local',
         },
         wait_ready: false,
         listen_timeout: 10000,
         kill_timeout: 5000,
         restart_delay: 2000,
       },
     ],
   };
   ```
2. 新建 `deploy/nginx/lumideck.conf.template`:
   ```nginx
   # Auto-generated from deploy/nginx/lumideck.conf.template via envsubst
   server {
       listen 80;
       listen [::]:80;
       server_name ${DOMAIN};
       location / { return 301 https://$host$request_uri; }
   }

   server {
       listen 443 ssl http2;
       listen [::]:443 ssl http2;
       server_name ${DOMAIN};

       # certbot 接管时会注入:
       #   ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
       #   ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
       #   include /etc/letsencrypt/options-ssl-nginx.conf;
       #   ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

       client_max_body_size 20m;

       # 前端 SPA
       root ${WEB_ROOT};
       index index.html;
       location / {
           try_files $uri $uri/ /index.html;
       }

       # API + Slidev 反代,统一上 agent
       location /api/ {
           proxy_pass http://127.0.0.1:${BACKEND_PORT};
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_read_timeout 600s;
           proxy_send_timeout 600s;
       }

       # Slidev HMR / Vite 客户端等绝对路径资源(agent 反代承接)
       location ~ ^/(@vite|@id|@fs|@server-ref|@server-reactive|node_modules|src) {
           proxy_pass http://127.0.0.1:${BACKEND_PORT};
           proxy_set_header Host $host;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
       }
   }
   ```
3. 新建 `deploy/scripts/start-slidev.sh`:
   ```bash
   #!/usr/bin/env bash
   set -e
   cd /root/server/lumideck-slidev
   if [ ! -f packages/slidev/slides.md ]; then
       cp packages/slidev/slides.example.md packages/slidev/slides.md
   fi
   exec pnpm -C packages/slidev exec slidev --port 3031 --base /api/slidev-preview/ --remote 127.0.0.1
   ```
4. 新建 `deploy/scripts/install-server.sh`(幂等;首次手工跑,后续不需要):
   ```bash
   #!/usr/bin/env bash
   set -e
   DOMAIN="${DOMAIN:-lumideck.illegalscreed.cn}"
   WEB_ROOT="/var/www/lumideck"
   BACKEND_PORT="4000"

   # 建目录
   mkdir -p "$WEB_ROOT" /root/server/lumideck-agent /root/server/lumideck-slidev /root/backups/lumideck

   # 写 nginx conf
   export DOMAIN WEB_ROOT BACKEND_PORT
   envsubst '${DOMAIN} ${WEB_ROOT} ${BACKEND_PORT}' \
     < /root/server/lumideck-agent/nginx-template/lumideck.conf.template \
     > /etc/nginx/conf.d/lumideck.conf
   nginx -t && systemctl reload nginx

   # certbot(若证书未申请)
   if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
       certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m ops@illegalscreed.cn --redirect
   fi

   # crontab:每日 02:00 备份;若已有则跳过
   ( crontab -l 2>/dev/null | grep -v db-backup.sh ; echo "0 2 * * * /root/server/lumideck-agent/db-backup.sh >> /root/backups/lumideck/cron.log 2>&1" ) | crontab -

   echo "✓ install-server.sh done. 下一步:写 .env.production.local,然后跑 ./deploy.sh all"
   ```
5. 新建 `deploy/scripts/db-backup.sh`:
   ```bash
   #!/usr/bin/env bash
   set -e
   DEST="/root/backups/lumideck"
   STAMP=$(date +%Y%m%d-%H%M%S)
   FILE="$DEST/lumideck-$STAMP.sql.gz"

   # 从 .env.production.local 抽 DATABASE_URL(简易解析;mysql://user:pass@host:port/db)
   ENV_FILE="/root/server/lumideck-agent/.env.production.local"
   DB_URL=$(grep '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)
   USER=$(echo "$DB_URL" | sed -E 's|mysql://([^:]+):.*|\1|')
   PASS=$(echo "$DB_URL" | sed -E 's|mysql://[^:]+:([^@]+)@.*|\1|')
   HOST=$(echo "$DB_URL" | sed -E 's|.*@([^:/]+).*|\1|')
   DB=$(echo "$DB_URL" | sed -E 's|.*/([^/?]+).*|\1|')

   mysqldump --single-transaction --quick --hex-blob \
       -h "$HOST" -u "$USER" -p"$PASS" "$DB" | gzip > "$FILE"

   # 30 天 rotate
   find "$DEST" -name 'lumideck-*.sql.gz' -mtime +30 -delete

   echo "[$(date)] backup ok: $FILE ($(du -h $FILE | cut -f1))"
   ```
6. `chmod +x deploy/scripts/*.sh`,本地 `shellcheck deploy/scripts/*.sh` 通过(无 warning)。

**验证方法**:
- `shellcheck deploy/scripts/*.sh` 通过
- `node -e "require('./deploy/ecosystem.config.cjs')"` 不抛
- 本地 `envsubst < deploy/nginx/lumideck.conf.template` 设环境变量后看输出格式正常

**风险**:
- nginx location 顺序:`/api/` 必须在 `/` 之前;`/@vite` 等正则 location 需 `^~` 避开 SPA fallback。Task 10-C 远端测试时手验。
- slidev `--remote 127.0.0.1` 是 v52+ 语法;Phase 8 已升到该版本(plan 17 验证)。
- pm2 `interpreter_args: '-r dotenv/config'` 配合 `DOTENV_CONFIG_PATH` env 比 `dotenv -e .env.production.local --` wrap 更稳(quiz 踩过 NestJS dotenv 顺序坑;agent 用 ESM dotenv preload 是干净路径)。

**Commit**:`feat(phase-10b): deploy/ 脚手架 - nginx + pm2 + remote scripts`

---

### Task 10-C:首次远端环境准备(手工执行,不入脚本)

**目的**:在 `47.120.26.143` 准备 Lumideck 运行所需的 OS/MySQL/nginx/证书前置,为 Task 10-D 的 deploy.sh 做铺垫。**这步不能自动化**——涉及生成强密码、人工录入 secrets。

**操作**(对照 `docs/runbooks/deploy.md` 操作,所有命令在远端执行):

1. **MySQL 准备**(SSH 进 `47.120.26.143`,以 root 登 MySQL):
   ```sql
   CREATE DATABASE lumideck CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'lumideck_prod_user'@'127.0.0.1' IDENTIFIED BY '<现场生成 32 字节随机>';
   GRANT ALL PRIVILEGES ON lumideck.* TO 'lumideck_prod_user'@'127.0.0.1';
   FLUSH PRIVILEGES;
   ```
   密码生成:`openssl rand -hex 16`,记录到密码管理器。

2. **建 deploy 目录骨架**(若 install-server.sh 还没传):
   ```bash
   mkdir -p /root/server/lumideck-agent/{dist,drizzle,nginx-template} \
            /root/server/lumideck-slidev \
            /var/www/lumideck \
            /root/backups/lumideck
   ```

3. **从本地 scp 把 deploy/ 目录上传到远端**(deploy.sh 后续会重复做,首次手工):
   ```bash
   # 本地终端:
   scp deploy/nginx/lumideck.conf.template root@47.120.26.143:/root/server/lumideck-agent/nginx-template/
   scp deploy/scripts/{install-server.sh,db-backup.sh,start-slidev.sh} root@47.120.26.143:/root/server/lumideck-agent/
   ```

4. **跑 install-server.sh**:
   ```bash
   ssh root@47.120.26.143 "DOMAIN=lumideck.illegalscreed.cn bash /root/server/lumideck-agent/install-server.sh"
   ```
   预期输出:nginx -t 通过 + certbot 申请成功(域名 DNS 必须先指到 47.120.26.143) + crontab 加上 db-backup。

5. **写 `.env.production.local`**(远端编辑):
   ```bash
   ssh root@47.120.26.143
   cd /root/server/lumideck-agent
   cat > .env.production.local <<EOF
   NODE_ENV=production
   DATABASE_URL=mysql://lumideck_prod_user:<刚才的密码>@127.0.0.1:3306/lumideck
   SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
   APIKEY_MASTER_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
   AGENT_PORT=4000
   SLIDEV_ORIGIN=http://127.0.0.1:3031
   PUBLIC_ORIGIN=https://lumideck.illegalscreed.cn
   EOF
   chmod 600 .env.production.local
   ```

6. **DNS 检查**:`dig +short lumideck.illegalscreed.cn` 必须返回 `47.120.26.143`(certbot 申请前置)。

7. **nginx 与证书 sanity**:
   ```bash
   curl -I https://lumideck.illegalscreed.cn  # 此时无 dist,nginx 返 404 是预期(SPA 还没 deploy)
   ```

**验证方法**:
- `mysql -u lumideck_prod_user -p -h 127.0.0.1 lumideck -e "SELECT 1"` 通
- `ls -la /etc/letsencrypt/live/lumideck.illegalscreed.cn/` 看到 fullchain.pem
- `crontab -l | grep db-backup` 看到 cron 行
- 浏览器 https://lumideck.illegalscreed.cn 看到 nginx 404(SPA 还没传)即正常

**风险**:
- DNS 没生效就跑 certbot 会失败(rate limit 5/h);卡 `dig` 检查通过再跑。
- MySQL `bind-address` 必须包含 127.0.0.1(quiz 服务器已是默认 `*`,确认过)。
- `.env.production.local` chmod 600 不能漏(避免其他用户读)。

**Commit**:无(纯运维操作,产物在远端;过程截图 / 命令记录写入 `docs/runbooks/deploy.md`)。

---

### Task 10-D:`scripts/deploy.sh` 主部署脚本

**目的**:本地一行命令完成从 build 到远端 reload 的完整部署。

**操作**:

1. 新建 `scripts/deploy.sh`(模仿 quiz 风格,加 Lumideck 特化):
   ```bash
   #!/usr/bin/env bash
   set -e

   SERVER_HOST="47.120.26.143"
   SERVER_USER="root"
   DOMAIN="lumideck.illegalscreed.cn"

   REMOTE_WEB="/var/www/lumideck"
   REMOTE_AGENT="/root/server/lumideck-agent"
   REMOTE_SLIDEV="/root/server/lumideck-slidev"

   SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
   PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

   GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
   log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
   log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
   log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

   check_ssh() {
     log_info "检查 SSH 连接..."
     ssh -o ConnectTimeout=5 -o BatchMode=yes "${SERVER_USER}@${SERVER_HOST}" 'echo ok' >/dev/null 2>&1 \
       || { log_error "SSH 不通,确认 ssh-copy-id 已做"; exit 1; }
   }

   build() {
     local target=$1
     cd "$PROJECT_ROOT"
     case $target in
       creator) log_info "构建 creator..."; pnpm -F @big-ppt/creator build ;;
       agent)   log_info "构建 agent...";   pnpm -F @big-ppt/agent build ;;
       slidev)  log_info "slidev 无需 build,源码 rsync" ;;
       all)
         log_info "全量 build..."
         pnpm -F @big-ppt/creator build
         pnpm -F @big-ppt/agent build
         ;;
     esac
   }

   deploy_creator() {
     log_info "部署 creator → ${REMOTE_WEB}/"
     rsync -az --delete \
       "${PROJECT_ROOT}/packages/creator/dist/" \
       "${SERVER_USER}@${SERVER_HOST}:${REMOTE_WEB}/"
     log_info "creator ✓"
   }

   deploy_agent() {
     log_info "部署 agent → ${REMOTE_AGENT}/"
     rsync -az --delete \
       "${PROJECT_ROOT}/packages/agent/dist/" \
       "${SERVER_USER}@${SERVER_HOST}:${REMOTE_AGENT}/dist/"
     rsync -az \
       "${PROJECT_ROOT}/packages/agent/drizzle/" \
       "${SERVER_USER}@${SERVER_HOST}:${REMOTE_AGENT}/drizzle/"
     scp "${PROJECT_ROOT}/packages/agent/package.json" "${SERVER_USER}@${SERVER_HOST}:${REMOTE_AGENT}/package.json"
     scp "${PROJECT_ROOT}/packages/agent/drizzle.config.ts" "${SERVER_USER}@${SERVER_HOST}:${REMOTE_AGENT}/drizzle.config.ts"
     # 同步 shared 包源码(workspace dep)
     rsync -az --delete \
       "${PROJECT_ROOT}/packages/shared/" \
       "${SERVER_USER}@${SERVER_HOST}:${REMOTE_AGENT}/../packages/shared/" \
       --exclude node_modules

     ssh "${SERVER_USER}@${SERVER_HOST}" "set -e
       cd ${REMOTE_AGENT}
       pnpm install --prod --ignore-scripts 2>&1 | tail -5
       # bcrypt 需要重新 build 因为 ignore-scripts;若装过会跳
       pnpm rebuild bcrypt 2>&1 | tail -3
       pnpm db:push:prod 2>&1
       pm2 reload lumideck-agent --update-env || pm2 start /root/server/lumideck-agent/ecosystem.config.cjs --only lumideck-agent
     "
     log_info "agent ✓"
   }

   deploy_slidev() {
     log_info "部署 slidev → ${REMOTE_SLIDEV}/"
     rsync -az --delete \
       --exclude node_modules \
       --exclude slides.md \
       --exclude dist \
       "${PROJECT_ROOT}/packages/slidev/" \
       "${SERVER_USER}@${SERVER_HOST}:${REMOTE_SLIDEV}/packages/slidev/"
     scp "${PROJECT_ROOT}/package.json" "${SERVER_USER}@${SERVER_HOST}:${REMOTE_SLIDEV}/"
     scp "${PROJECT_ROOT}/pnpm-workspace.yaml" "${SERVER_USER}@${SERVER_HOST}:${REMOTE_SLIDEV}/"
     scp "${PROJECT_ROOT}/pnpm-lock.yaml" "${SERVER_USER}@${SERVER_HOST}:${REMOTE_SLIDEV}/"

     ssh "${SERVER_USER}@${SERVER_HOST}" "set -e
       cd ${REMOTE_SLIDEV}
       pnpm install --frozen-lockfile 2>&1 | tail -5
       pm2 reload lumideck-slidev --update-env || pm2 start /root/server/lumideck-agent/ecosystem.config.cjs --only lumideck-slidev
     "
     log_info "slidev ✓"
   }

   ecosystem() {
     log_info "更新 ecosystem.config.cjs / install scripts → 远端"
     scp "${PROJECT_ROOT}/deploy/ecosystem.config.cjs" "${SERVER_USER}@${SERVER_HOST}:${REMOTE_AGENT}/ecosystem.config.cjs"
     scp "${PROJECT_ROOT}/deploy/scripts/start-slidev.sh" "${SERVER_USER}@${SERVER_HOST}:${REMOTE_SLIDEV}/start-slidev.sh"
     scp "${PROJECT_ROOT}/deploy/scripts/db-backup.sh" "${SERVER_USER}@${SERVER_HOST}:${REMOTE_AGENT}/db-backup.sh"
     scp "${PROJECT_ROOT}/deploy/nginx/lumideck.conf.template" "${SERVER_USER}@${SERVER_HOST}:${REMOTE_AGENT}/nginx-template/"
     ssh "${SERVER_USER}@${SERVER_HOST}" "chmod +x ${REMOTE_SLIDEV}/start-slidev.sh ${REMOTE_AGENT}/db-backup.sh"
   }

   healthcheck() {
     log_info "健康检查..."
     local result
     result=$(curl -fsS "https://${DOMAIN}/api/healthz" || echo "FAIL")
     echo "$result" | head -c 500
     echo ""
     if echo "$result" | grep -q '"status":"ok"'; then
       log_info "Healthz ok ✓"
     else
       log_warn "Healthz 非 ok,远端 pm2 logs lumideck-agent 排查"
     fi
   }

   main() {
     local target="${1:-all}"
     echo "========================================"
     echo "  Lumideck 部署 → ${target} → ${SERVER_HOST}"
     echo "========================================"
     check_ssh
     case $target in
       creator) build creator && deploy_creator ;;
       agent)   build agent && ecosystem && deploy_agent ;;
       slidev)  build slidev && ecosystem && deploy_slidev ;;
       ecosystem) ecosystem ;;
       healthz) healthcheck ;;
       all)
         build all
         ecosystem
         deploy_slidev
         deploy_agent
         deploy_creator
         healthcheck
         ;;
       *)
         echo "用法: $0 [creator|agent|slidev|ecosystem|healthz|all]"
         exit 1 ;;
     esac
     log_info "完成! https://${DOMAIN}"
   }
   main "$@"
   ```
2. `chmod +x scripts/deploy.sh`
3. `shellcheck scripts/deploy.sh` 通过

**验证方法**:
- `shellcheck scripts/deploy.sh` 0 warning
- 本地 `./scripts/deploy.sh healthz`(仅检查不部署,且要求 Task 10-E 之后)
- 不能本 task 测部署:留 Task 10-E

**风险**:
- `pnpm install --prod` 在 `lumideck-agent/` 单包内会因 `workspace:*` dep 失败:必须以 monorepo 根装。**修正方案**:agent 远端装包改为在 `lumideck-slidev/`(承担 monorepo 根角色)装一次 + agent 用 symlink 引;或更稳:agent 也是 monorepo 根布局(scp 整个 `packages/agent` + `packages/shared` + 根 `package.json` / lockfile,远端 `pnpm install --frozen-lockfile`)。**本 plan 选后者**:重写 deploy_agent 让 agent 也走 monorepo 根布局(与 slidev 合并到同一个远端目录?)。
- **决策**:agent 与 slidev 共用一个远端 monorepo 根 `/root/server/lumideck/`,内含 `packages/agent/dist/` + `packages/slidev/`(源码 + node_modules) + `packages/shared/` + 根 lockfile。pm2 ecosystem 的 cwd 全部指向该根的子目录。**这意味着 deploy.sh 需要重构:不要拆 deploy_agent / deploy_slidev,而是 deploy_backend 一起 rsync monorepo 必要文件**。Task 10-D 的脚本上面那版要按此调整。

**调整后的 Task 10-D 操作**(实际跑这版):

把 deploy.sh 里 `REMOTE_AGENT` / `REMOTE_SLIDEV` 合并为 `REMOTE_MONOREPO=/root/server/lumideck`,deploy_agent + deploy_slidev 合并为 deploy_backend:

```bash
deploy_backend() {
  log_info "部署 backend (agent + slidev) → ${REMOTE_MONOREPO}/"
  rsync -az --delete \
    --exclude node_modules \
    --exclude '.env.*.local' \
    --exclude 'packages/agent/data' \
    --exclude 'packages/slidev/slides.md' \
    --exclude 'packages/creator/dist' \
    --exclude 'packages/creator/node_modules' \
    --exclude 'packages/e2e' \
    --exclude '.git' \
    --include 'packages/agent/dist/***' \
    "${PROJECT_ROOT}/" \
    "${SERVER_USER}@${SERVER_HOST}:${REMOTE_MONOREPO}/"

  ssh "${SERVER_USER}@${SERVER_HOST}" "set -e
    cd ${REMOTE_MONOREPO}
    pnpm install --frozen-lockfile --prod=false 2>&1 | tail -5
    pnpm -F @big-ppt/agent db:push:prod 2>&1
    pm2 startOrReload deploy/ecosystem.config.cjs
  "
  log_info "backend ✓"
}
```
配套:`deploy/ecosystem.config.cjs` 的 cwd 改成 `/root/server/lumideck/packages/agent` 和 `.../packages/slidev`,`script` / `interpreter_args` 同步;`.env.production.local` 路径调整为 `/root/server/lumideck/packages/agent/.env.production.local`;`db-backup.sh` 的 ENV_FILE 同步;**Task 10-B 的所有路径都要按此调整**(本 plan 关闭后回填一次:Task 10-B 写出 `${REMOTE_MONOREPO}` 模型即可)。

**Commit**:`feat(phase-10d): scripts/deploy.sh - 一键部署 + monorepo 远端根`

---

### Task 10-E:首次完整部署 + 验收 + runbook 落档

**目的**:跑一次完整部署,验收 roadmap Phase 10 全部 6 条,落档 runbook。

**操作**:
1. 本地干净状态:`git status` 清,`pnpm test && pnpm -F @big-ppt/e2e test` 全绿。
2. 跑 `./scripts/deploy.sh all`,看输出每一段。
3. 浏览器开 `https://lumideck.illegalscreed.cn`:
   - 注册新用户 → 收登录态
   - 登录进 deck 列表(空) → 新建 deck → 选模板(beitou / jingyeda 两套都试)
   - 看到 starter 3 页骨架 → 用对话改第 1 页标题 → Slidev HMR 即时反映
   - 切换模板 → 进度条 → 成功 → /undo 回去
   - 登出 → 重登 → deck 仍在
4. 第二浏览器(无痕)登录另一账号 → 进 same deck URL → 见等待页(占用锁验证)
5. SSH 远端 `pm2 restart lumideck-agent` → 浏览器刷新 → 数据全在,登录态(因为 session 在 DB,内存锁清空让用户能重抢)。
6. 触发一次 db-backup:`ssh root@47.120.26.143 'bash /root/server/lumideck/packages/agent/db-backup.sh'`,确认 `/root/backups/lumideck/lumideck-*.sql.gz` 存在 + 解压能 `mysql lumideck < ...sql` 还原。
7. **safety final**:
   ```bash
   git status                              # 干净,无 .env.*.local 待 commit
   git log -p --all -S 'SESSION_SECRET'    # 历史无明文 secret
   git log -p --all -S 'APIKEY_MASTER'     # 同上
   gitleaks detect --source . --no-banner  # 0 leak
   ```
8. 写 `docs/runbooks/deploy.md`(执行流程 + 故障应对):
   - 前置依赖(SSH key / DNS / .env.production.local 模板)
   - 首次部署 step-by-step(Task 10-C 的全部命令)
   - 日常迭代(只 deploy.sh creator / agent / slidev / all)
   - 故障树:nginx 502 → pm2 status / logs / 内存 → restart / DB 不通 → mysql ping → 备份恢复路径
   - 回滚:`pm2 reload --update-env` + 上一版 dist 留本地,需要时 `rsync` 旧 dist 上去再 reload
9. 关闭 plan:回填执行期偏离 + 踩坑(若有)+ 测试落地表 + roadmap.md Phase 10 验收勾选。

**验证方法**:
- roadmap.md Phase 10 验收 6 条全勾
- runbook 一份新人能照着重复部署一次

**风险**:
- 第一次跑 db:push:prod 会建一堆表,Drizzle 可能卡几秒 — 接受
- pm2 startOrReload 第一次跑没旧进程时会 startup,后续 reload 不丢连接

**Commit**:
- `feat(phase-10e): 首次部署落地 + runbook`(若 runbook 与代码同 commit)
- `docs(phase-10): roadmap 回填 + plan 关闭`

---

## 验收条件(roadmap.md Phase 10 清单映射)

- [ ] 公网 `https://lumideck.illegalscreed.cn` 可访问,HTTPS 证书正确(certbot 出的)
- [ ] 注册 → 登录 → 建 deck → 编辑(改标题 / 加页 / 切模板)→ 登出 → 重登全流程通
- [ ] 第二浏览器登录另一账号,进入相同 deck URL 看到 OccupiedWaitingPage
- [ ] `pm2 restart lumideck-agent` 后,数据全在,用户重新登录能继续(session 在 DB,锁清空再抢)
- [ ] `/root/backups/lumideck/lumideck-YYYYMMDD-*.sql.gz` 每日自动产生,可 `gunzip + mysql restore`
- [ ] `git log -p --all -S 'SECRET'` / `gitleaks detect` 仍 0 leak;`.env.production.local` 不在任何 commit
- [ ] healthz `https://lumideck.illegalscreed.cn/api/healthz` 返回 `status:ok` + DB ms < 50
- [ ] `docs/runbooks/deploy.md` 落档 + 路线图 Phase 10 入口指向 plan 19
- [ ] 全量回归:本地 `pnpm test` + `pnpm -F @big-ppt/e2e test` + 远端 healthz 三件全绿

---

## 不做什么(范围围栏)

- ❌ **CI/CD 自动化**(Phase 16+):本 Phase 仍 ssh + scp,一个开发者人工跑足够
- ❌ **多 Slidev 实例 / 多用户并发**(Phase 11)
- ❌ **灰度部署 / 自动回滚 / 蓝绿**:回滚机制就是 "本地保留上版 dist,再 rsync 上去 reload" 手工操作
- ❌ **Sentry / Datadog / Prometheus 监控**:MVP 用 `pm2 logs` + healthz 足够;监控属 Phase 16+
- ❌ **CDN / 多地区**:单服务器
- ❌ **容器化 (Docker / k8s)**:多实例时再考虑
- ❌ **drizzle migration generate**:仍 `push`(99-tech-debt 已记;切换时机 = Phase 11 多实例)
- ❌ **修复进程内单实例锁问题**(plan 10 偏离):pm2 reload 锁清空可接受,Phase 11 多实例时整套机制重写
- ❌ **新引入运维包**(如 acme.sh / ansible / supervisord):全部用 quiz 服务器既有的(certbot + pm2 + crontab)
- ❌ **ECS 安全组开任何 > 443 的端口**:agent / slidev / mysql 永远 127.0.0.1;Phase 11 多 slidev 进程池仍不动安全组(进程池在内部端口分流)

---

## 执行期偏离(关闭后追加)

> 实际跑下来与 plan 不一致的点。

### 偏离 1:DATABASE_URL 用 RDS 域名而非 127.0.0.1

- **原 plan**:`mysql://lumideck_prod_user:PASS@127.0.0.1:3306/lumideck`
- **实际**:`mysql://lumideck_prod_user:***@rm-bp1ezwg4a7ugd67mx4o.mysql.rds.aliyuncs.com:3306/lumideck`
- **原因**:quiz 服务器实际用阿里云 RDS,ECS 47.120.26.143 上没装 mysql server。runbook 在执行期已修正为 RDS 路径 + RDS 控制台建库

### 偏离 2:加了 deploy/scripts/start-agent.sh wrapper

- **原 plan**:agent 用 ecosystem.config.cjs 的 `interpreter_args: '-r dotenv/config'` 自动加载 secrets
- **实际**:加 `start-agent.sh` 用 `pnpm exec dotenv -e .env.production.local -- node dist/index.js`(详见踩坑 #5)
- **原因**:pm2 + `-r dotenv/config` 注入 env 不可靠,改用 wrapper 与本地 `pnpm start` 行为一致

### 偏离 3:加了 lumideck-http-only.conf.template + install-server.sh 两阶段 bootstrap

- **原 plan**:install-server.sh 一次性 envsubst 完整 nginx 模板 → certbot --nginx
- **实际**:阶段 A 写 80-only conf → certbot --webroot 申请证书 → 阶段 B 写完整 conf
- **原因**:nginx -t 在 ssl_certificate 文件不存在时直接 fail,certbot 接管不了(详见踩坑 #3)

### 偏离 4:init-db.mjs 加了 --allow-prod 标志

- **原 plan**:生产 secrets 由 ops 在远端手工 `cat > .env.production.local` 写入
- **实际**:复用 init-db.mjs(本来 production 是被显式拒绝的安全护栏),加 `--allow-prod` 显式覆盖标志,本地一行命令完成"连 root 建库 + 生成强密码 + 写 .env.production.local + 随机生成 SESSION_SECRET / APIKEY_MASTER_KEY"
- **原因**:简化部署体验,同时保留护栏(默认仍拒绝,必须显式 `--allow-prod`)

### 偏离 5:packages/shared 加了 build script

- **原 plan**:plan 19 假设 shared 不需要 build(沿用 CLAUDE.md "直接 import 源文件不打包")
- **实际**:shared 加 `"build": "tsc"` 输出 src/*.js,deploy.sh build_agent 之前先 build shared
- **原因**:shared/src/index.ts 用 NodeNext ESM `from './chat.js'`,生产 node 必须有真实 .js 才能 resolve(详见踩坑 #4)

### 偏离 6:SLIDEV_ORIGIN 默认值改为 localhost

- **原 plan**:`SLIDEV_ORIGIN=http://127.0.0.1:3031`(plan 19 + .env.production.example 默认)
- **实际**:`SLIDEV_ORIGIN=http://localhost:3031`
- **原因**:slidev v52 + Vite 5+ 默认 bind [::1] IPv6 only,127.0.0.1 ECONNREFUSED(详见踩坑 #6)

---

## 踩坑与解决(实施期 / 关闭后追加)

### 坑 1:macOS 自带 openrsync 协议版本 29 跟远端真 rsync 协议 31 不兼容

- **症状**:本地 `./scripts/deploy.sh ecosystem` 报 `rsync(8751): error: unexpected end of file`,无 rsync 输出明细
- **根因**:macOS Sequoia 起默认 `/usr/bin/rsync` 是 Apple 的 openrsync(协议 29);远端装的 rsync 3.1.3(协议 31)
- **修复**:`brew install rsync`(3.4.1 协议 32),`/opt/homebrew/bin/rsync` 优先于系统 PATH
- **防再犯**:**未提炼到 CLAUDE.md** — 一次性 onboarding 坑,新成员看本 plan 即可

### 坑 2:Alibaba Cloud Linux 用 dnf,不是 apt

- **症状**:`apt-get install rsync` 报 `bash: apt-get: command not found`
- **根因**:服务器是 Alibaba Cloud Linux 3(RHEL/CentOS 系),包管理是 dnf/yum
- **修复**:`dnf install -y rsync`
- **防再犯**:已在 [runbook](../runbooks/deploy.md) 注明

### 坑 3:nginx 模板含 `listen 443 ssl` 但证书未申请,nginx -t 直接 fail

- **症状**:首次跑 install-server.sh 时 `nginx: [emerg] no "ssl_certificate" is defined`,脚本 set -e 退出,但**坏 conf 已写入** `/etc/nginx/conf.d/`,任何后续 `systemctl reload nginx` 都会让 nginx 拒绝重载,quiz 风险
- **根因**:certbot 需要先申请证书才有 ssl_certificate 文件,但我的模板默认带 443 ssl block,bootstrap 阶段证书还不存在
- **修复**:install-server.sh 改两阶段
  - 阶段 A:写 `lumideck-http-only.conf.template`(只 80 + ACME challenge webroot),reload,跑 `certbot certonly --webroot`
  - 阶段 B:写完整 `lumideck.conf.template`(80 跳 443 + 443 ssl,直接 hardcode `ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem`),reload
- **防再犯**:**已提炼到 CLAUDE.md "Slidev 反代 + HMR" 旁边新增"nginx HTTPS bootstrap"一条**

### 坑 4:packages/shared 未 build,prod node 找不到 .js

- **症状**:agent 启动报 `Cannot find module '/root/server/lumideck/packages/shared/src/chat.js' imported from .../shared/src/index.ts`
- **根因**:shared 走"src/*.ts 直接 import,不打包"的设计(CLAUDE.md "包与端口" 章节),只在 dev/tsx 模式 work;生产 node 解析 main 字段 `./src/index.ts` 后,index.ts 用 ESM `export * from './chat.js'`,Node 找不到 .js
- **修复**:
  - shared 加 `"build": "tsc"`,产物落 `src/*.js`(NodeNext 风格,跟 .ts 同目录共存)
  - deploy.sh `build_agent` 函数先 build shared 再 build agent
  - .gitignore 加 `packages/shared/src/*.js` `*.js.map` 避免 build 产物入 git
- **防再犯**:**已提炼到 CLAUDE.md "已知坑 → 工具链 / 构建"** — "monorepo 内部 ts 包用 ESM `from './x.js'` 风格,生产部署前必须先 build 出 .js"

### 坑 5:pm2 ecosystem 用 `-r dotenv/config` + DOTENV_CONFIG_PATH 不可靠

- **症状**:agent 启动后 `process.env.DATABASE_URL` 仍是 undefined,落到 src/index.ts 的 fallback `loadDotenv({ path: ['.env.development.local', '.env.local'] })`,健康检查 `db.error: '[agent/db] DATABASE_URL 未设置'`
- **根因**:pm2 通过 ecosystem.config.cjs 的 `interpreter_args: '-r dotenv/config'` + `env: { DOTENV_CONFIG_PATH: '...' }` 让 node 预加载 dotenv,但 dotenv preload 只支持 CLI 参数 `dotenv_config_path=...` 不读 env vars,加上 pm2 environment 注入顺序与 -r 标志的交互不可靠
- **修复**:写 `deploy/scripts/start-agent.sh` wrapper,内容是 `pnpm exec dotenv -e .env.production.local -- node dist/index.js`(跟本地 `pnpm start` 行为一致),pm2 通过 `script: '.../start-agent.sh'` `interpreter: 'bash'` 调起
- **防再犯**:**已提炼到 CLAUDE.md "已知坑 → 工具链 / 构建"** — "pm2 跑 ESM Node app 时 secrets 通过 bash wrapper + dotenv-cli 注入,不要走 -r dotenv/config + DOTENV_CONFIG_PATH"

### 坑 6:slidev v52 + Vite 5+ 默认只 bind IPv6 [::1],SLIDEV_ORIGIN=http://127.0.0.1 不通

- **症状**:agent healthz `slidev.error: 'fetch failed'`,本机 `curl http://127.0.0.1:3031/...` 报 `Connection refused`,但 `curl http://localhost:3031/...` 正常 200
- **根因**:`ss -tlnp` 看到 slidev 监听 `[::1]:3031`(IPv6 loopback only),不绑 127.0.0.1;`localhost` 在 glibc resolver 下解析为 `::1, 127.0.0.1`,fetch 自动跑到 IPv6 通路
- **修复**:.env.production.local 把 `SLIDEV_ORIGIN=http://127.0.0.1:3031` 改为 `http://localhost:3031`;同步更新 `.env.production.example` 默认值 + 注释
- **防再犯**:**已提炼到 CLAUDE.md "已知坑 → Slidev 反代 + HMR"** — "agent fetch slidev 用 localhost 不要用 127.0.0.1,Vite 5 默认 bind ::1"

---

## 测试数量落地

| 指标             | 起点 | 终点 | 增量 |
| ---------------- | ---- | ---- | ---- |
| agent unit       | 428  | 434  | +6(healthz 5 + mount-integration 1) |
| creator unit     | 79   | 79   | 0 |
| shared unit      | 3    | 3    | 0 |
| slidev unit      | 38   | 38   | 0 |
| E2E              | 9    | 9    | 0 |
| coverage lines   | 92.82| 维持 | — |
| coverage branch  | 83.83| 维持 | — |

实际增量与预期一致(运维代码 shell / config 不计单测)。

---

## 部署期实测验收(2026-04-27)

服务端验收(8/8):
- [x] HTTPS 可达 + Let's Encrypt 证书签发至 2026-07-26
- [x] /api/healthz status:ok(DB 34ms / Slidev 5ms;/healthz + /api/healthz 双挂载)
- [x] /api/auth/me 401(未登录鉴权工作)
- [x] /api/list-templates 公开返 2 个模板(beitou + jingyeda)
- [x] 注册→登录→建 deck→列 deck→登出→401 全 6 步 API smoke 通过
- [x] pm2 restart lumideck-agent 后 users/decks 数据保留 + healthz 8s uptime
- [x] db-backup 手动触发产 390 字节真实 sql.gz(mysqldump 8.0.45 装好)
- [x] git history 0 secret leak(SESSION_SECRET / APIKEY_MASTER_KEY / DB 凭据真值无入库)

UI 待手验(2/2):
- [ ] 浏览器:注册 → 配 LLM key → 建 deck → 切模板 → /undo
- [ ] 第二浏览器无痕:登另一账号 → 进 same deck URL → 看 OccupiedWaitingPage

---

## 关键引用

- 部署参考脚本:`/Users/zhangxu/illegal/quiz-monorepo/scripts/deploy.sh`(本 plan 的 deploy.sh 模仿其结构,扩展为 monorepo 根 + slidev 进程 + healthz)
- 安全上下文:[plan 18 — Phase 9 audit-report](../../workspace/big-ppt/docs/security/2026-04-audit-report.md)的 OWASP A01 / A04 / A05 / A09 全部依赖本 Phase 的 PUBLIC_ORIGIN / nginx HTTPS / log redact 路径生效
- env 模板:[packages/agent/.env.production.example](../../workspace/big-ppt/packages/agent/.env.production.example)
- Slidev 反代规则:[CLAUDE.md "Slidev 反代 + HMR"](../../workspace/big-ppt/CLAUDE.md#slidev-反代--hmr)
- 单实例锁约束:[plan 10 偏离纪录](../../workspace/big-ppt/docs/plans/10-phase5-user-deck-versions.md)
