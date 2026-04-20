import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import fs from 'fs'
import path from 'path'

// 预置 LLM 提供商（均为 OpenAI 兼容接口）
const PROVIDERS: Record<string, { name: string; baseURL: string; defaultModel: string }> = {
  zhipu:    { name: '智谱 (GLM)',      baseURL: 'https://open.bigmodel.cn/api/paas/v4',             defaultModel: 'GLM-5.1' },
  deepseek: { name: 'DeepSeek',        baseURL: 'https://api.deepseek.com/v1',                      defaultModel: 'deepseek-chat' },
  openai:   { name: 'OpenAI',          baseURL: 'https://api.openai.com/v1',                        defaultModel: 'gpt-4o' },
  moonshot: { name: 'Moonshot (Kimi)', baseURL: 'https://api.moonshot.cn/v1',                       defaultModel: 'moonshot-v1-8k' },
  qwen:     { name: '千问 (Qwen)',     baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-plus' },
}

// 会话日志中间件：前端通过 POST /api/log 上报事件，写入 logs/creator-YYYY-MM-DD.jsonl
function loggerPlugin() {
  const LOGS_DIR = path.resolve('logs')

  function ensureDir() {
    if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true })
  }

  function currentLogFile(): string {
    const d = new Date()
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return path.resolve(LOGS_DIR, `creator-${yyyy}-${mm}-${dd}.jsonl`)
  }

  return {
    name: 'creator-logger',
    configureServer(server: any) {
      server.middlewares.use('/api/log-event', (req: any, res: any) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ success: false, error: 'method not allowed' }))
          return
        }
        let body = ''
        req.on('data', (chunk: string) => { body += chunk })
        req.on('end', () => {
          try {
            ensureDir()
            const raw = JSON.parse(body || '{}')
            const { payload, ...indexFields } = raw

            // 大 payload 单独落盘到 logs/payloads/<session>/<序号>-<kind>.json
            if (payload !== undefined && payload !== null) {
              const session = (indexFields.session || 'no-session').toString()
                .replace(/[^a-zA-Z0-9_-]/g, '_')
                .slice(0, 64)
              const payloadDir = path.resolve(LOGS_DIR, 'payloads', session)
              if (!fs.existsSync(payloadDir)) fs.mkdirSync(payloadDir, { recursive: true })
              const seq = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 6)
              const kindSafe = String(indexFields.kind || 'event').replace(/[^a-zA-Z0-9_-]/g, '_')
              const filename = `${seq}-${kindSafe}.json`
              fs.writeFileSync(path.resolve(payloadDir, filename), JSON.stringify(payload, null, 2))
              indexFields.payload_file = `payloads/${session}/${filename}`
              // 统计一下 payload 体积，便于索引行扫描时判断
              indexFields.payload_bytes = Buffer.byteLength(JSON.stringify(payload))
            }

            const line = JSON.stringify({ ts: new Date().toISOString(), ...indexFields })
            fs.appendFileSync(currentLogFile(), line + '\n')
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ success: true }))
          } catch (err: any) {
            res.statusCode = 500
            res.end(JSON.stringify({ success: false, error: err.message }))
          }
        })
      })

      // 方便用户 tail -f 查看：打印日志文件位置
      const firstFile = currentLogFile()
      if (!server.__loggerAnnounced) {
        server.__loggerAnnounced = true
        console.log(`\n  \x1b[36m[creator-logger]\x1b[0m 会话日志将写入: ${firstFile}\n`)
      }
    },
  }
}

// Agent 工具中间件
function slidesToolPlugin() {
  const SLIDES_PATH = path.resolve('slides.md')
  const SLIDES_BAK = path.resolve('slides.md.bak')
  const TEMPLATES_DIR = path.resolve('templates/company-standard')
  const LOGS_DIR = path.resolve('logs')
  // 排除非页面模板的文件
  const IGNORE_FILES = new Set(['DESIGN.md', 'README.md'])

  // 每次 write/edit 前备份当前 slides.md 到 .bak，用于 /undo 恢复
  function backupSlides() {
    if (fs.existsSync(SLIDES_PATH)) {
      fs.copyFileSync(SLIDES_PATH, SLIDES_BAK)
    }
  }

  return {
    name: 'slides-tools',
    configureServer(server: any) {
      // 读取 slides.md
      server.middlewares.use('/api/read-slides', (_req: any, res: any) => {
        try {
          const content = fs.readFileSync(SLIDES_PATH, 'utf-8')
          res.setHeader('Content-Type', 'text/plain; charset=utf-8')
          res.end(content)
        } catch (err: any) {
          res.statusCode = 500
          res.end(JSON.stringify({ success: false, error: err.message }))
        }
      })

      // 全量写入 slides.md（首次生成）
      server.middlewares.use('/api/write-slides', (req: any, res: any) => {
        let body = ''
        req.on('data', (chunk: string) => { body += chunk })
        req.on('end', () => {
          try {
            const { content } = JSON.parse(body)
            if (!content) {
              res.statusCode = 400
              res.end(JSON.stringify({ success: false, error: 'content 不能为空' }))
              return
            }
            backupSlides()
            fs.writeFileSync(SLIDES_PATH, content, 'utf-8')
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ success: true }))
          } catch (err: any) {
            res.statusCode = 500
            res.end(JSON.stringify({ success: false, error: err.message }))
          }
        })
      })

      // 精确替换 slides.md 中的内容（局部修改）
      server.middlewares.use('/api/edit-slides', (req: any, res: any) => {
        let body = ''
        req.on('data', (chunk: string) => { body += chunk })
        req.on('end', () => {
          try {
            const { old_string, new_string } = JSON.parse(body)

            if (!old_string) {
              res.statusCode = 400
              res.end(JSON.stringify({ success: false, error: 'old_string 不能为空' }))
              return
            }

            const content = fs.readFileSync(SLIDES_PATH, 'utf-8')
            const count = content.split(old_string).length - 1

            if (count === 0) {
              // 未找到 → 提供上下文帮助 LLM 定位
              const lines = content.split('\n')
              const suggestions = lines
                .filter(l => similarity(l.trim(), old_string.trim()) > 0.3)
                .slice(0, 3)
                .map(l => l.trim())
              res.statusCode = 200
              res.setHeader('Content-Type', 'application/json; charset=utf-8')
              res.end(JSON.stringify({
                success: false,
                error: `未找到指定内容。相似内容：\n${suggestions.join('\n')}`,
              }))
              return
            }

            if (count > 1) {
              // 多处匹配 → 列出位置
              const positions: number[] = []
              const lines = content.split('\n')
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes(old_string.split('\n')[0])) {
                  positions.push(i + 1)
                }
              }
              res.statusCode = 200
              res.setHeader('Content-Type', 'application/json; charset=utf-8')
              res.end(JSON.stringify({
                success: false,
                error: `找到 ${count} 处匹配，请提供更长的上下文以唯一定位。匹配位置：第 ${positions.join(', ')} 行附近`,
              }))
              return
            }

            // 唯一匹配 → 执行替换
            const newContent = content.replace(old_string, new_string)
            backupSlides()
            fs.writeFileSync(SLIDES_PATH, newContent, 'utf-8')
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ success: true }))
          } catch (err: any) {
            res.statusCode = 500
            res.end(JSON.stringify({ success: false, error: err.message }))
          }
        })
      })

      // 读取模板文件
      server.middlewares.use('/api/read-template', (req: any, res: any) => {
        let body = ''
        req.on('data', (chunk: string) => { body += chunk })
        req.on('end', () => {
          try {
            const { name } = JSON.parse(body)
            // 路径安全：只允许字母、数字、横线、点
            const safeName = name.replace(/[^a-zA-Z0-9\-.]/g, '')
            if (!safeName.endsWith('.md')) {
              res.statusCode = 400
              res.end(JSON.stringify({ success: false, error: '只支持 .md 模板文件' }))
              return
            }

            const templatePath = path.resolve(TEMPLATES_DIR, safeName)
            if (!templatePath.startsWith(path.resolve('templates/'))) {
              res.statusCode = 403
              res.end(JSON.stringify({ success: false, error: '非法路径' }))
              return
            }

            if (!fs.existsSync(templatePath)) {
              res.statusCode = 404
              res.end(JSON.stringify({ success: false, error: `模板 ${safeName} 不存在` }))
              return
            }

            const content = fs.readFileSync(templatePath, 'utf-8')
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ success: true, content }))
          } catch (err: any) {
            res.statusCode = 500
            res.end(JSON.stringify({ success: false, error: err.message }))
          }
        })
      })

      // 列出可用模板
      server.middlewares.use('/api/list-templates', (_req: any, res: any) => {
        try {
          const files = fs.readdirSync(TEMPLATES_DIR)
            .filter(f => f.endsWith('.md') && !IGNORE_FILES.has(f))
            .map(f => ({ name: f, path: `company-standard/${f}` }))

          // 自动附带 README.md（模板使用规范）
          const readmePath = path.resolve(TEMPLATES_DIR, 'README.md')
          const readme = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, 'utf-8') : ''

          // 自动附带 DESIGN.md（设计规范）
          const designPath = path.resolve(TEMPLATES_DIR, 'DESIGN.md')
          const design = fs.existsSync(designPath) ? fs.readFileSync(designPath, 'utf-8') : ''

          // 列出可用的图片资源（帮 AI 避免编造不存在的图片路径）
          const images = fs.readdirSync(TEMPLATES_DIR)
            .filter(f => /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(f))
            .map(f => `/templates/company-standard/${f}`)

          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({
            success: true,
            templates: files,
            usage_guide: readme,
            design_spec: design,
            available_images: images,
          }))
        } catch (err: any) {
          res.statusCode = 500
          res.end(JSON.stringify({ success: false, error: err.message }))
        }
      })

      // 从 slides.md.bak 恢复（斜杠指令 /undo）
      server.middlewares.use('/api/restore-slides', (_req: any, res: any) => {
        try {
          if (!fs.existsSync(SLIDES_BAK)) {
            res.statusCode = 404
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ success: false, error: '没有可撤销的备份（slides.md.bak 不存在）' }))
            return
          }
          fs.copyFileSync(SLIDES_BAK, SLIDES_PATH)
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ success: true, message: '已恢复到上一次修改前的版本' }))
        } catch (err: any) {
          res.statusCode = 500
          res.end(JSON.stringify({ success: false, error: err.message }))
        }
      })

      // 获取最近一次完整会话的日志事件（斜杠指令 /log）
      server.middlewares.use('/api/log/latest', (_req: any, res: any) => {
        try {
          if (!fs.existsSync(LOGS_DIR)) {
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ success: true, events: [] }))
            return
          }
          const files = fs.readdirSync(LOGS_DIR)
            .filter(f => /^creator-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
            .sort()
          if (files.length === 0) {
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ success: true, events: [] }))
            return
          }
          const latestFile = path.resolve(LOGS_DIR, files[files.length - 1])
          const lines = fs.readFileSync(latestFile, 'utf-8').trim().split('\n').filter(Boolean)
          const events = lines.map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) as any[]

          // 倒序找最近一个 session_end，再取该 session 的全部事件
          let sessionId: string | undefined
          for (let i = events.length - 1; i >= 0; i--) {
            if (events[i].kind === 'session_end') { sessionId = events[i].session; break }
          }
          // 如果没有 session_end（尚未结束），取最新一条 event 的 session
          if (!sessionId && events.length > 0) sessionId = events[events.length - 1].session

          const sessionEvents = sessionId
            ? events.filter(e => e.session === sessionId)
            : []

          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ success: true, session: sessionId, events: sessionEvents }))
        } catch (err: any) {
          res.statusCode = 500
          res.end(JSON.stringify({ success: false, error: err.message }))
        }
      })
    },
  }
}

// 简单的字符串相似度计算
function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  const longer = a.length > b.length ? a : b
  const shorter = a.length > b.length ? b : a
  if (longer.length === 0) return 1
  const editDist = levenshtein(longer, shorter)
  return (longer.length - editDist) / longer.length
}

function levenshtein(a: string, b: string): number {
  const matrix: number[][] = []
  for (let i = 0; i <= b.length; i++) matrix[i] = [i]
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] = b[i - 1] === a[j - 1]
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
    }
  }
  return matrix[b.length][a.length]
}

// 根据环境变量选择代理目标（用户运行时可通过 .env.local 配置）
const selectedProvider = process.env.LLM_PROVIDER || 'zhipu'

export default defineConfig({
  root: 'creator/',
  cacheDir: 'node_modules/.vite-creator',
  plugins: [vue(), loggerPlugin(), slidesToolPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'creator/src'),
    },
  },
  server: {
    port: 3030,
    proxy: {
      '/api/llm': {
        target: PROVIDERS[selectedProvider]?.baseURL || PROVIDERS.zhipu.baseURL,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/llm/, ''),
      },
    },
  },
  build: {
    outDir: 'dist-creator',
  },
})
