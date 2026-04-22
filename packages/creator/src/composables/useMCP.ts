// packages/creator/src/composables/useMCP.ts
import { ref } from 'vue'
import type {
  CreateMcpServerRequest,
  McpServerWithStatus,
  UpdateMcpServerRequest,
} from '@big-ppt/shared'

const servers = ref<McpServerWithStatus[]>([])
const loading = ref(false)
const lastError = ref<string | null>(null)

async function refresh(): Promise<void> {
  loading.value = true
  lastError.value = null
  try {
    const res = await fetch('/api/mcp/servers')
    const json = (await res.json()) as { success: boolean; servers?: McpServerWithStatus[]; error?: string }
    if (!res.ok || !json.success || !json.servers) {
      throw new Error(json.error || `HTTP ${res.status}`)
    }
    servers.value = json.servers
  } catch (err) {
    lastError.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

async function create(req: CreateMcpServerRequest): Promise<void> {
  const res = await fetch('/api/mcp/servers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  const json = await res.json()
  if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`)
  await refresh()
}

async function update(id: string, patch: UpdateMcpServerRequest): Promise<void> {
  const res = await fetch(`/api/mcp/servers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const json = await res.json()
  if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`)
  await refresh()
}

async function remove(id: string): Promise<void> {
  const res = await fetch(`/api/mcp/servers/${encodeURIComponent(id)}`, { method: 'DELETE' })
  const json = await res.json()
  if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`)
  await refresh()
}

export function useMCP() {
  return { servers, loading, lastError, refresh, create, update, remove }
}
