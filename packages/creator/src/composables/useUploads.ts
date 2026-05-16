/** Phase 13 Task F:upload / list / delete API client composable。 */
import { ref } from 'vue'

export interface UploadedAsset {
  id: string
  filename: string
  mime: string
  sizeBytes: number
  extractStatus: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
  uploadedAt: string
}

export interface QuotaInfo {
  usedBytes: number
  limitBytes: number
}

/**
 * 默认 quota limit(100MB),用于 AssetManagerPanel 空态时容量条占位。
 * backend Task A 实际 limit 来自 user quota,前端拿到 `GET /api/uploads` 返的
 * `quota.limitBytes` 才覆盖。
 */
export const QUOTA_LIMIT_DEFAULT = 100 * 1024 * 1024

export function useUploads() {
  const uploading = ref(false)

  async function uploadFile(file: File): Promise<{ asset: UploadedAsset; quota: QuotaInfo }> {
    uploading.value = true
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/uploads', {
        method: 'POST',
        credentials: 'include',
        body: fd,
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { code?: string; message?: string }
        }
        throw new Error(body.error?.message ?? `上传失败:HTTP ${res.status}`)
      }
      return (await res.json()) as { asset: UploadedAsset; quota: QuotaInfo }
    } finally {
      uploading.value = false
    }
  }

  async function listAssets(): Promise<{ assets: UploadedAsset[]; quota: QuotaInfo }> {
    const res = await fetch('/api/uploads', { credentials: 'include' })
    if (!res.ok) throw new Error(`列出素材失败:HTTP ${res.status}`)
    return (await res.json()) as { assets: UploadedAsset[]; quota: QuotaInfo }
  }

  async function deleteAsset(id: string): Promise<QuotaInfo> {
    const res = await fetch(`/api/uploads/${id}`, { method: 'DELETE', credentials: 'include' })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      throw new Error(body.error?.message ?? `删除失败:HTTP ${res.status}`)
    }
    const data = (await res.json()) as { quota: QuotaInfo }
    return data.quota
  }

  return { uploading, uploadFile, listAssets, deleteAsset, QUOTA_LIMIT_DEFAULT }
}
