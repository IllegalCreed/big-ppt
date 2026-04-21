import { serve } from '@hono/node-server'
import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => c.text('Big-PPT Agent'))
app.get('/healthz', (c) => c.json({ ok: true, service: 'big-ppt-agent', version: '0.1.0' }))

const port = Number(process.env.AGENT_PORT ?? 4000)

serve(
  { fetch: app.fetch, port },
  (info) => {
    console.log(`[agent] listening on http://localhost:${info.port}`)
  },
)
