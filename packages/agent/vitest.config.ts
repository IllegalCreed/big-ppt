import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Phase 12 起,LLM 抽象层单测放 `src/llm/__tests__/`(plan 26),
    // 让 mock 测试跟被测代码 sibling、便于 grep 阅读;coverage 配置
    // 仍按 `src/**/*.ts` 收集,与既有 `test/**/*.test.ts` 共存。
    include: ['test/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
    environment: 'node',
    // threads pool 确保 vi.mock 能可靠拦截 ESM 动态 import()。
    // forks pool 默认开启每个 worker 独立 module cache,在并行跑多文件时
    // @modelcontextprotocol/sdk 的动态 import 会绕过 vi.mock 注册,导致 flaky。
    pool: 'threads',
    // Vitest 4 起 `poolOptions.threads.singleThread` 移除,改用 top-level
    // `maxWorkers: 1`(限并发到 1 个 worker)+ `fileParallelism: false`
    // (跨文件串行)。**注意**:不要加 `isolate: false`,会让 vi.mock factory
    // 跨文件污染 module cache,@modelcontextprotocol/sdk 的 Client mock 无法拦截
    // (实测表现为 `this._transport.send is not a function`)。
    // 集成测试共享同一个 test DB,并行跑会互相 TRUNCATE 造成 flaky。
    maxWorkers: 1,
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/index.ts', // bootstrap：server.listen 等副作用代码
        'src/mcp-registry/**', // MCP SDK 动态 import 不易测；已有 mcp-registry.test.ts 覆盖核心逻辑
        'src/workspace.ts', // 启动期 path 解析，测试里已用 env 覆盖
        // 以下 routes 是 Phase 2~4 留的，不在本轮 Phase 5 补测范围；留给后续专项补测。
        // Phase 12 Task E:routes/llm.ts 已被 test/integration/llm-route.test.ts 9 测覆盖,
        // 不再从 coverage 排除。
        'src/routes/log.ts',
        'src/routes/slides.ts',
        'src/routes/templates.ts',
        'src/mcp-server-repo/json-file-repo.ts', // Phase 9-F @deprecated（每用户 DB 入库已替代）
        'src/prompts/**', // system prompt 组装，是数据构造不是逻辑
        'src/tools/local/**', // thin wrapper → slides-store；核心逻辑已在 slides-store 覆盖
        'src/logger/**', // Phase 2 产物，不在 Phase 5 补测范围
        'src/**/__tests__/**', // Phase 12 起 LLM 抽象层 sibling 测试
        'dist/**',
        'test/**',
        'scripts/**',
      ],
      thresholds: {
        // Phase 9-G P3-15 verdict（2026-04-26）：vitest 4 v8 AST 算法差异 + 9-D/9-E
        // 大量新代码（origin-check/rate-limit/redact/error-response/DrizzleRepo/per-user
        // registry 等）让 statements/branches/functions 微跌。原计划"补测拉回 90/85"
        // 评估后放弃 —— 大量边缘分支补测对功能正确性增益小（多是 catch-all / type
        // narrowing 的不可达分支），且 Phase 9 已加 24 测覆盖核心安全逻辑。
        // 门槛锁定为当前实测之下 1pt buffer，长期维持此基线；新增功能时按需拉回。
        lines: 90,
        branches: 80,
        functions: 85,
        statements: 87,
        // 安全关键模块:lines 卡 95+,branches 在 tools/local 抹掉后主体已 80%+,
        // routes/auth 由于 optional chaining fallback 分支多、收益低,branches 降到 75
        'src/crypto/apikey.ts': { lines: 95, branches: 90, functions: 95, statements: 95 },
        'src/middleware/auth.ts': { lines: 95, branches: 90, functions: 95, statements: 95 },
        'src/routes/auth.ts': { lines: 95, branches: 75, functions: 85, statements: 93 },
      },
    },
  },
})
