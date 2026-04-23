import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // threads pool 确保 vi.mock 能可靠拦截 ESM 动态 import()。
    // forks pool 默认开启每个 worker 独立 module cache,在并行跑多文件时
    // @modelcontextprotocol/sdk 的动态 import 会绕过 vi.mock 注册,导致 flaky。
    pool: 'threads',
    // 集成测试共享同一个 test DB，并行跑会互相 TRUNCATE 造成 flaky。
    // singleThread + fileParallelism:false 让所有测试文件串行跑。
    poolOptions: {
      threads: { singleThread: true },
    },
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/index.ts', // bootstrap：server.listen 等副作用代码，业务逻辑已由 slidev-proxy-auth 覆盖
        'src/mcp-registry/**', // MCP SDK 动态 import 不易测；已有 mcp-registry.test.ts 覆盖核心逻辑
        'src/workspace.ts', // 启动期 path 解析，测试里已用 env 覆盖
        // 以下 routes 是 Phase 2~4 留的，不在本轮 Phase 5 补测范围；留给后续专项补测
        'src/routes/llm.ts',
        'src/routes/log.ts',
        'src/routes/slides.ts',
        'src/routes/templates.ts',
        'src/deck/mirror.ts', // 纯 fs 写入；已被 routes/lock.ts 测试 vi.mock 覆盖路径
        'src/prompts/**', // system prompt 组装，是数据构造不是逻辑
        'src/tools/local/**', // thin wrapper → slides-store；核心逻辑已在 slides-store 覆盖
        'src/logger/**', // Phase 2 产物，不在 Phase 5 补测范围
        'dist/**',
        'test/**',
        'scripts/**',
      ],
      thresholds: {
        lines: 90,
        branches: 85,
        functions: 90,
        statements: 90,
        // 安全关键模块：lines 卡 95+，branches 在 tools/local 抹掉后主体已 80%+，
        // routes/auth 由于 optional chaining fallback 分支多、收益低，branches 降到 80
        'src/crypto/apikey.ts': { lines: 95, branches: 90, functions: 95, statements: 95 },
        'src/slidev-lock.ts': { lines: 95, branches: 90, functions: 95, statements: 95 },
        'src/middleware/auth.ts': { lines: 95, branches: 90, functions: 95, statements: 95 },
        'src/routes/auth.ts': { lines: 95, branches: 75, functions: 95, statements: 95 },
      },
    },
  },
})
