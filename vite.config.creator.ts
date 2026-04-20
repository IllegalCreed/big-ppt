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

// Agent 工具中间件
function slidesToolPlugin() {
  const SLIDES_PATH = path.resolve('slides.md')
  const TEMPLATES_DIR = path.resolve('templates/company-standard')
  // 排除非页面模板的文件
  const IGNORE_FILES = new Set(['DESIGN.md', 'README.md'])

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

          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({
            success: true,
            templates: files,
            usage_guide: readme,
            design_spec: design,
          }))
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
  plugins: [vue(), slidesToolPlugin()],
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
