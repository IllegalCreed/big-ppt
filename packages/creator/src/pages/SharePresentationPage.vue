<script setup lang="ts">
import type { PresentationPayload, PublicShareErrorCode } from '@big-ppt/shared'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, ApiError } from '../api/client'
import PresentationViewer from '../presentation/PresentationViewer.vue'

type State =
  | { kind: 'loading' }
  | { kind: 'error'; code: PublicShareErrorCode | 'unknown'; message: string }
  | { kind: 'ready'; presentation: PresentationPayload }

const route = useRoute()
const router = useRouter()
const slug = computed(() => String(route.params.slug ?? ''))
const state = ref<State>({ kind: 'loading' })

async function load(): Promise<void> {
  state.value = { kind: 'loading' }
  try {
    const response = await api.get<{ presentation: PresentationPayload }>(
      `/api/share/${encodeURIComponent(slug.value)}/presentation`,
    )
    state.value = { kind: 'ready', presentation: response.presentation }
  } catch (error) {
    const body = error instanceof ApiError ? (error.body as { code?: PublicShareErrorCode }) : null
    const code = body?.code ?? 'unknown'
    const messages: Record<PublicShareErrorCode | 'unknown', string> = {
      'not-found': '这个分享链接不存在',
      expired: '这个分享链接已过期',
      revoked: '这个分享链接已被撤销',
      unknown: error instanceof Error ? error.message : '分享内容加载失败',
    }
    state.value = { kind: 'error', code, message: messages[code] }
  }
}

function exit(): void {
  if (window.history.length > 1) router.back()
  else void router.push('/login')
}

onMounted(() => void load())
watch(slug, () => void load())
</script>

<template>
  <div v-if="state.kind === 'loading'" class="share-state">加载分享内容...</div>
  <div v-else-if="state.kind === 'error'" class="share-state error" :data-error-code="state.code">
    <h1>Lumideck</h1>
    <p>{{ state.message }}</p>
  </div>
  <PresentationViewer v-else :presentation="state.presentation" mode="share-view" @exit="exit" />
</template>

<style scoped>
.share-state {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  background: #121416;
  color: #f4f4f2;
  text-align: center;
  font-family: var(--font-sans);
}

.share-state h1 {
  margin: 0;
  font-size: 24px;
  letter-spacing: 0;
}

.share-state p {
  margin: 0;
  color: rgba(255, 255, 255, 0.68);
}
</style>
