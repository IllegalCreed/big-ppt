import { execFile } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const DEPLOY_SCRIPT = fileURLToPath(new URL('../../../scripts/deploy.sh', import.meta.url))
const EXPECTED_SHA = '0123456789abcdef0123456789abcdef01234567'

type HealthResponse = { statusCode: number; body: string }

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
        }),
    ),
  )
})

async function startHealthServer(responses: HealthResponse[]) {
  let requests = 0
  const server = createServer((_req, res) => {
    const response = responses[Math.min(requests, responses.length - 1)]!
    requests += 1
    res.writeHead(response.statusCode, { 'content-type': 'application/json' })
    res.end(response.body)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)

  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('测试 health server 未获取到端口')

  return {
    url: `http://127.0.0.1:${address.port}/healthz`,
    requestCount: () => requests,
  }
}

async function runHealthcheck(url: string, extraEnv: NodeJS.ProcessEnv = {}) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(
      'bash',
      [DEPLOY_SCRIPT, 'healthz'],
      {
        env: {
          ...process.env,
          HEALTHCHECK_URL: url,
          HEALTHCHECK_ATTEMPTS: '3',
          HEALTHCHECK_RETRY_SECONDS: '0',
          HEALTHCHECK_TIMEOUT_SECONDS: '2',
          ...extraEnv,
        },
      },
      (error, stdout, stderr) => {
        resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr })
      },
    )
  })
}

describe('deploy.sh healthz', () => {
  it('重试瞬时失败与旧版本，直到目标 gitSha ready', async () => {
    const health = await startHealthServer([
      { statusCode: 502, body: '{"status":"down"}' },
      { statusCode: 200, body: '{"status":"ok","gitSha":"old"}' },
      { statusCode: 200, body: `{"status":"ok","gitSha":"${EXPECTED_SHA}"}` },
    ])

    const result = await runHealthcheck(health.url, { EXPECTED_GIT_SHA: EXPECTED_SHA })

    expect(result.code).toBe(0)
    expect(health.requestCount()).toBe(3)
    expect(result.stdout).toContain('status 未就绪')
    expect(result.stdout).toContain(`gitSha 尚未切到 ${EXPECTED_SHA}`)
    expect(result.stdout).toContain(`gitSha=${EXPECTED_SHA}`)
  })

  it('达到最大尝试次数后让部署失败', async () => {
    const health = await startHealthServer([
      { statusCode: 200, body: '{"status":"degraded","gitSha":"old"}' },
    ])

    const result = await runHealthcheck(health.url)

    expect(result.code).toBe(1)
    expect(health.requestCount()).toBe(3)
    expect(result.stdout).toContain('attempt 3/3')
    expect(result.stdout).toContain('3 次尝试后仍未就绪')
  })
})
