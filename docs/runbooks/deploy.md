# Lumideck 部署 Runbook

> 配套 plan:[19-phase10-production-deploy](../plans/19-phase10-production-deploy.md)
> 服务器:`47.120.26.143`(复用 quiz-monorepo 服务器)
> 域名:`lumideck.illegalscreed.cn`
> 工作目录:`/root/server/lumideck/`(monorepo 远端根)

---

## 0. 一图看懂部署架构

```
互联网
    │ HTTPS 443
    ▼
nginx ─ /             ───────► /var/www/lumideck/(creator dist)
        │
        ├─ /api/      ────────► 127.0.0.1:4000 (lumideck-agent)
        ├─ /healthz   ────────►          ↓
        └─ /@vite|@id|@fs|       ┌───────┴────────┐
            @server-ref|         │                │
            @server-reactive     │  内部 http-proxy │
                                 │  (鉴权后转发)    │
                                 ▼                │
                          127.0.0.1:3031          │
                          (lumideck-slidev,      │
                           只绑 localhost,        │
                           不对外)                │
                                                  │
              MySQL 127.0.0.1:3306 ◄──── lumideck-agent
              (lumideck 库 + lumideck_prod_user)
```

ECS 安全组 **永远只需要 80 / 443 / 22**,其他全部本机回环。

---

## 1. 首次部署完整步骤(从零到上线)

### 1.1 前置 checklist

| 步骤 | 怎么做 | 校验 |
|------|--------|------|
| 域名 DNS | 阿里云 DNS 控制台加 A 记录:`lumideck` → `47.120.26.143`,TTL 600 | `dig +short lumideck.illegalscreed.cn` 返回 `47.120.26.143` |
| ssh-copy-id | `ssh-copy-id root@47.120.26.143`(若已为 quiz 部署过则已有) | `ssh -o BatchMode=yes root@47.120.26.143 echo ok` 不要密码 |
| ECS 安全组 | 阿里云 ECS 控制台,确认 80 / 443 / 22 已开 | 浏览器 `http://47.120.26.143` 看到默认 nginx 页(若 quiz 也在跑就不一定) |
| 服务器装好基础软件 | quiz 服务器已有 nginx / certbot / pm2 / Node 22+ / pnpm / mysql | `ssh root@47.120.26.143 'which nginx certbot pm2 node pnpm mysql'` 全有 |

### 1.2 RDS 建库(阿里云 RDS,与 quiz 共用同一实例)

> 实际架构是阿里云 RDS(`rm-bp1ezwg4a7ugd67mx4o.mysql.rds.aliyuncs.com:3306`),
> 不是 47.120.26.143 上的本地 MySQL。47.120.26.143 上不需要也没装 mysql client。

**推荐路径:阿里云 RDS 控制台网页操作**(无需 root 密码暴露):

1. 打开阿里云 RDS 控制台 → 选实例 `rm-bp1ezwg4a7ugd67mx4o`
2. **账号管理** → 创建账号:
   - 账号:`lumideck_prod_user`
   - 类型:**普通账号**
   - 密码:点"生成"获取强密码,**记到密码管理器**
3. **数据库管理** → 创建数据库:
   - 库名:`lumideck`
   - 字符集:`utf8mb4`
   - 排序规则:`utf8mb4_unicode_ci`
   - 授权账号:勾选刚才的 `lumideck_prod_user`,权限设 `读写`
4. 校验:登录 RDS 控制台的 DMS(数据管理服务),用 `lumideck_prod_user` 凭据连接,跑 `SELECT 1`。

**或者 SSH + mysql client 路径**(若有 root 凭据):
```bash
ssh root@47.120.26.143 'apt-get install -y mysql-client-core-8.0'
ssh root@47.120.26.143
RDS_HOST=rm-bp1ezwg4a7ugd67mx4o.mysql.rds.aliyuncs.com
DB_PASS=$(openssl rand -hex 16); echo "lumideck DB 密码: ${DB_PASS}"
mysql -h "${RDS_HOST}" -uroot -p <<SQL
CREATE DATABASE IF NOT EXISTS lumideck CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'lumideck_prod_user'@'%' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON lumideck.* TO 'lumideck_prod_user'@'%';
FLUSH PRIVILEGES;
SQL
```

⚠️ RDS 用户的 host 部分用 `'%'`(任意源)而不是 `'127.0.0.1'`,因为 ECS 通过 RDS 内网域名访问,RDS 视角的 client IP 不是 loopback。RDS 默认走 IP 白名单层(在 RDS 控制台配 ECS 内网 IP 白名单)。

### 1.3 本地推一次 deploy/ 到远端

> 此步骤只 rsync `deploy/` 目录(nginx 模板 + pm2 ecosystem + 远端脚本),不动业务代码。

```bash
# 本地 zhangxu/workspace/big-ppt
./scripts/deploy.sh ecosystem
```

预期输出:`同步 deploy/ 配置 → /root/server/lumideck/deploy/` 然后 `ecosystem ✓`。

### 1.4 远端跑 install-server.sh

> 此步骤生成 nginx 配置 + 申请 HTTPS 证书 + 加 crontab 备份任务。**前提:1.1 的 DNS 已生效**(certbot 会校验 DNS 拿证书)。

```bash
ssh root@47.120.26.143 \
  "DOMAIN=lumideck.illegalscreed.cn ACME_EMAIL=ops@illegalscreed.cn \
   bash /root/server/lumideck/deploy/scripts/install-server.sh"
```

预期看到:
- `nginx -t` 通过
- `systemctl reload nginx`
- `certbot --nginx 申请证书` 成功(如果是 first time)
- `crontab` 加上 db-backup 行

校验:
```bash
ssh root@47.120.26.143 'ls /etc/letsencrypt/live/lumideck.illegalscreed.cn/'
# 应看到 fullchain.pem privkey.pem cert.pem chain.pem

ssh root@47.120.26.143 'crontab -l | grep db-backup'
# 应看到 "0 2 * * * /root/server/lumideck/deploy/scripts/db-backup.sh ..."
```

### 1.5 远端写 .env.production.local

> ⚠️ **此步骤生成的 secrets 严禁离开服务器**。不要 cat 到本地终端 history,不要进 git,不要发给任何人。

```bash
ssh root@47.120.26.143

# 生成两个 32 字节随机密钥
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
APIKEY_MASTER=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
DB_PASS="<RDS lumideck_prod_user 密码,从密码管理器复制>"
RDS_HOST=rm-bp1ezwg4a7ugd67mx4o.mysql.rds.aliyuncs.com   # 与 quiz 共用 RDS 实例

# 写入(在 ssh 进去后的远端 shell 跑)
cat > /root/server/lumideck/packages/agent/.env.production.local <<EOF
NODE_ENV=production
DATABASE_URL=mysql://lumideck_prod_user:${DB_PASS}@${RDS_HOST}:3306/lumideck
SESSION_SECRET=${SESSION_SECRET}
APIKEY_MASTER_KEY=${APIKEY_MASTER}
AGENT_PORT=4000
SLIDEV_ORIGIN=http://127.0.0.1:3031
PUBLIC_ORIGIN=https://lumideck.illegalscreed.cn
EOF

chmod 600 /root/server/lumideck/packages/agent/.env.production.local

# 不留 history
unset SESSION_SECRET APIKEY_MASTER DB_PASS RDS_HOST
history -c

exit
```

### 1.6 本地跑完整部署

```bash
# 本地
./scripts/deploy.sh all
# 输入 yes 确认
```

预期最后看到:
```
[INFO]  HTTP 200
{"status":"ok","service":"big-ppt-agent","version":"0.1.0","gitSha":"unknown","uptimeSec":...,"checks":{"db":{"ok":true,...},"slidev":{"ok":true,...}}}
[INFO]  healthz: status=ok ✓
```

### 1.7 浏览器手验

打开 `https://lumideck.illegalscreed.cn`:
1. 看到登录/注册页(若先看到 nginx 404 → SPA 没传成功,重跑 `./scripts/deploy.sh creator`)
2. 注册一个账号 → 自动登录
3. 进入 Deck 列表(空)→ 新建 deck → 选 beitou-standard 或 jingyeda-standard
4. 看到 starter 3 页骨架预览(Slidev iframe)
5. 用对话改第一页标题 → 几秒后 Slidev iframe HMR 反映新内容
6. 顶栏切模板 → 进度条 → 成功 → 出现 UndoToast

无痕浏览器登另一账号 → 进同一 deck URL → 看到"占用中"等待页(单实例锁验收)。

---

## 2. 日常迭代部署

| 改了什么 | 跑哪个目标 |
|---------|-----------|
| creator UI / Vue 组件 | `./scripts/deploy.sh creator` |
| agent 后端代码 / DB schema | `./scripts/deploy.sh backend` |
| nginx 模板 / pm2 ecosystem / 远端脚本 | `./scripts/deploy.sh ecosystem` 然后视情况手 reload nginx / pm2 |
| 全部 | `./scripts/deploy.sh all` |
| 只看健康 | `./scripts/deploy.sh healthz` |

DB schema 变了的部署:`backend` 子目标内部已经跑 `pnpm -F @big-ppt/agent db:push:prod`,**幂等,无变化为 no-op**。

---

## 3. 故障树

### 3.1 healthz 不通(curl HTTP 502 / 000)

```bash
ssh root@47.120.26.143 'pm2 list'
# 看 lumideck-agent / lumideck-slidev 状态:online / errored / stopped

# 查日志
ssh root@47.120.26.143 'pm2 logs lumideck-agent --lines 50 --nostream'
ssh root@47.120.26.143 'pm2 logs lumideck-slidev --lines 50 --nostream'
```

常见原因:
- agent errored:`.env.production.local` 缺字段或 DATABASE_URL 写错
- slidev errored:`packages/slidev/slides.md` 缺(start-slidev.sh 应自动 copy,看是否 slides.example.md 也缺)
- 进程 online 但 healthz 仍 502:nginx 未 reload(检查 `nginx -t && systemctl status nginx`)

### 3.2 healthz status=degraded(slidev 不通)

agent 起着但 slidev 进程挂了。`pm2 restart lumideck-slidev`,等 5 秒再 curl healthz。

### 3.3 healthz status=down(DB 不通)

```bash
ssh root@47.120.26.143
mysql -ulumideck_prod_user -p -h 127.0.0.1 lumideck -e "SELECT 1"
```

可能原因:
- MySQL 服务挂了:`systemctl status mysql`
- 密码错:重新生成密码 + 改 `.env.production.local` + `pm2 restart lumideck-agent`
- `bind-address` 不允许 127.0.0.1 连接(quiz 服务器不应有此问题)

### 3.4 创建 deck 后 Slidev 预览空白 / iframe 一直 loading

- 切 deck 时 agent 改写 `slides.md` → Slidev HMR 应自动反映
- 若卡住:`pm2 restart lumideck-slidev`(锁是 agent 进程内存对象,slidev 重启不影响锁;但如果 agent 跟 slidev 都重启,所有用户需要重连)
- 检查 `/api/slidev-preview/` 反代鉴权:必须是当前持有锁的用户才能访问(Phase 5 设计)

### 3.5 用户重启 agent 后单实例锁清空

**这是设计意图**(plan 10 偏离纪录)。pm2 reload `lumideck-agent` 会让进程内存锁清空,等价于"所有用户都需要重连"。Phase 11 多实例才会换成 DB 持久锁。

---

## 4. DB 备份与恢复

### 备份(自动)

crontab 已配每日 02:00 跑 `db-backup.sh`,备份落到 `/root/backups/lumideck/lumideck-YYYYMMDD-HHMMSS.sql.gz`,保留 30 天。

手动触发一次:
```bash
ssh root@47.120.26.143 'bash /root/server/lumideck/deploy/scripts/db-backup.sh'
ssh root@47.120.26.143 'ls -lah /root/backups/lumideck/ | head -5'
```

### 恢复

```bash
ssh root@47.120.26.143

# 选择要恢复的备份
BACKUP=/root/backups/lumideck/lumideck-20260427-020000.sql.gz

# (建议)先停 agent 避免读写冲突
pm2 stop lumideck-agent

# DROP & RECREATE(危险,确认后执行)
mysql -ulumideck_prod_user -p -h 127.0.0.1 -e "DROP DATABASE lumideck; CREATE DATABASE lumideck CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 还原
gunzip -c "${BACKUP}" | mysql -ulumideck_prod_user -p -h 127.0.0.1 lumideck

# 起 agent
pm2 start lumideck-agent
```

---

## 5. 回滚

本 phase **不做自动回滚**,手动方案:

```bash
# 本地从 git 切回上一版
git log --oneline | head -5
git checkout <prev-sha>

# 重部
FORCE=1 ./scripts/deploy.sh all   # FORCE=1 跳 confirm,因为这是 emergency
```

DB schema 回滚:**没有自动回滚机制**(drizzle push 模式)。如果新版本改了 schema,回到旧版本必须手 mysqldump + DROP + 还原旧版备份。Phase 11 多实例时引入 migration generate 才有真正回滚能力。

---

## 6. 证书续期

certbot 默认装 systemd timer (`certbot.timer`) 自动续期,**无需手动**。

校验:
```bash
ssh root@47.120.26.143 'systemctl list-timers | grep certbot'
ssh root@47.120.26.143 'certbot certificates'
# 看 Expiry Date,通常 90 天剩 30 天时自动续
```

手动测试续期:
```bash
ssh root@47.120.26.143 'certbot renew --dry-run'
```

---

## 7. 已知 issue / 不做项

- **进程内单实例锁**(plan 10 偏离):pm2 reload 会清空,所有用户需要重新抢锁。Phase 11 多实例时换 DB 持久锁。
- **drizzle migration generate**:仍 push 模式,schema 演进不生成 SQL 文件。Phase 11 切换。
- **CI/CD**:本 phase 仍 ssh + scp,Phase 16+ 上 GitHub Actions。
- **CDN / 多地区**:不做,单服务器 50 内部用户场景足够。
- **监控告警**(Sentry / Datadog):不做,`pm2 logs` + 日 healthz 巡检足够。
