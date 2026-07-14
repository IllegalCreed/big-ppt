<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { Bookmark, Layers, Sparkles, X } from 'lucide-vue-next'
import type { GeneratedImageStyleCandidate, ImageStyleLibraryPreset } from '@big-ppt/shared'
import { useImageStyleLibrary } from '../composables/useImageStyleLibrary'
import ImageStyleCard, { type ImageStyleCardItem } from './ImageStyleCard.vue'

const props = withDefaults(
  defineProps<{
    hasImageLlm?: boolean
    hasMainLlm?: boolean
    disableTeleport?: boolean
  }>(),
  {
    hasImageLlm: false,
    hasMainLlm: false,
    disableTeleport: false,
  },
)

const emit = defineEmits<{
  'open-settings': []
}>()

type Tab = 'system' | 'user' | 'explore'

const styles = useImageStyleLibrary()
const activeTab = ref<Tab>('system')
const dialogRef = ref<HTMLElement | null>(null)
const tabs: Tab[] = ['system', 'user', 'explore']
const returnFocusElement =
  document.activeElement instanceof HTMLElement ? document.activeElement : null

const {
  open,
  library,
  loading,
  error,
  applyingKey,
  savingAssetIds,
  renamingPresetId,
  deletingPresetId,
  systemPresets,
  userPresets,
  generatedCandidates,
  active,
  draw,
  remainingExplorations,
  decisionPending,
  exploring,
  canExplore,
  closeLibrary,
  dismissLibrary,
  applyStyle,
  chooseFreeStyle,
  explore,
  saveCandidate,
  renamePreset,
  deletePreset,
} = styles

const activeDescription = computed(() => {
  const current = active.value
  if (!current || current.mode === 'undecided') return '尚未选择配图风格'
  if (current.mode === 'free') return '当前使用自由生成，不限制风格'
  const cards = [...systemPresets.value, ...userPresets.value]
  if (current.mode === 'preset') {
    const matched = cards.find(
      (preset) => preset.source === current.styleSource && preset.id === current.styleSourceId,
    )
    return matched ? `当前风格：${matched.name}` : '当前已应用预设风格'
  }
  const generated = generatedCandidates.value.find(
    (candidate) =>
      candidate.assetId === current.anchorAssetId || candidate.assetId === current.styleSourceId,
  )
  return generated ? `当前风格：${generated.style}` : '当前已应用 AI 探索风格'
})

const closeLabel = computed(() => (decisionPending.value ? '关闭并暂不指定风格' : '关闭风格库'))

const explorationGateMessage = computed(() => {
  if (!props.hasImageLlm) return 'AI 探索需要先配置生图模型。系统预设和我的风格仍可直接使用。'
  if (!props.hasMainLlm) return 'AI 探索需要先配置主模型，由它根据当前 deck 生成探索方向。'
  return ''
})

const exploreButtonLabel = computed(() => {
  if (exploring.value) return '正在探索…'
  return generatedCandidates.value.length > 0 ? '再探索 3 个风格' : '探索 3 个新风格'
})

function presetCard(preset: ImageStyleLibraryPreset): ImageStyleCardItem {
  return {
    id: preset.id,
    source: preset.source,
    name: preset.name,
    description: preset.description,
    previewUrl: preset.previewUrl,
  }
}

function candidateCard(candidate: GeneratedImageStyleCandidate): ImageStyleCardItem {
  return {
    id: candidate.assetId,
    source: 'explore',
    name: candidate.style || 'AI 探索风格',
    description: '根据当前 deck 内容生成的专属视觉方向',
    previewUrl: candidate.previewUrl,
  }
}

function isSelected(source: ImageStyleCardItem['source'], id: string): boolean {
  const current = active.value
  if (!current) return false
  if (source === 'explore') {
    return (
      current.mode === 'generated' && (current.anchorAssetId === id || current.styleSourceId === id)
    )
  }
  return current.mode === 'preset' && current.styleSource === source && current.styleSourceId === id
}

function applying(source: ImageStyleCardItem['source'], id: string): boolean {
  return applyingKey.value === `${source}:${id}`
}

async function requestClose(): Promise<void> {
  await dismissLibrary()
}

function requestSettings(): void {
  closeLibrary()
  emit('open-settings')
}

function selectTab(tab: Tab): void {
  activeTab.value = tab
}

function onTabKeydown(event: KeyboardEvent, currentIndex: number): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  let nextIndex = currentIndex
  if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
  if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length
  if (event.key === 'Home') nextIndex = 0
  if (event.key === 'End') nextIndex = tabs.length - 1
  activeTab.value = tabs[nextIndex]!
  const buttons = dialogRef.value?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  buttons?.[nextIndex]?.focus()
}

function onGlobalKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && open.value) {
    event.preventDefault()
    void requestClose()
    return
  }
  if (event.key !== 'Tab' || !open.value || !dialogRef.value) return
  const focusable = Array.from(
    dialogRef.value.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => {
    let current: HTMLElement | null = element
    while (current && current !== dialogRef.value) {
      const style = window.getComputedStyle(current)
      if (style.display === 'none' || style.visibility === 'hidden') return false
      current = current.parentElement
    }
    return true
  })
  if (focusable.length === 0) return
  const first = focusable[0]!
  const last = focusable[focusable.length - 1]!
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(
  () => open.value,
  (isOpen) => {
    if (!isOpen) {
      window.removeEventListener('keydown', onGlobalKeydown)
      return
    }
    activeTab.value = 'system'
    window.addEventListener('keydown', onGlobalKeydown)
    void nextTick(() => {
      dialogRef.value?.querySelector<HTMLButtonElement>('[role="tab"]')?.focus()
    })
  },
  { immediate: true },
)

onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
  if (returnFocusElement?.isConnected) returnFocusElement.focus()
})
</script>

<template>
  <Teleport to="body" :disabled="disableTeleport">
    <div v-if="open" class="modal-overlay" data-image-style-library>
      <section
        ref="dialogRef"
        class="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-style-library-title"
        aria-describedby="image-style-library-subtitle"
      >
        <header class="modal-header">
          <div class="modal-heading">
            <h2 id="image-style-library-title">配图风格</h2>
            <p id="image-style-library-subtitle">
              先从风格库即时选择；都不满意时，再让 AI 探索新的方向。
            </p>
          </div>
          <div class="modal-header__right">
            <span class="active-style-label">{{ activeDescription }}</span>
            <button
              type="button"
              class="icon-button"
              :aria-label="closeLabel"
              :title="closeLabel"
              data-close-style-library
              @click="requestClose"
            >
              <X :size="18" :stroke-width="1.8" aria-hidden="true" />
            </button>
          </div>
        </header>

        <nav class="style-tabs" role="tablist" aria-label="风格来源">
          <button
            id="style-tab-system"
            type="button"
            role="tab"
            :aria-selected="activeTab === 'system'"
            aria-controls="style-panel-system"
            :tabindex="activeTab === 'system' ? 0 : -1"
            data-style-tab="system"
            @click="selectTab('system')"
            @keydown="onTabKeydown($event, 0)"
          >
            <Layers :size="15" :stroke-width="1.8" aria-hidden="true" />
            系统预设
            <span class="tab-count">{{ systemPresets.length }}</span>
          </button>
          <button
            id="style-tab-user"
            type="button"
            role="tab"
            :aria-selected="activeTab === 'user'"
            aria-controls="style-panel-user"
            :tabindex="activeTab === 'user' ? 0 : -1"
            data-style-tab="user"
            @click="selectTab('user')"
            @keydown="onTabKeydown($event, 1)"
          >
            <Bookmark :size="15" :stroke-width="1.8" aria-hidden="true" />
            我的风格
            <span class="tab-count">{{ userPresets.length }}</span>
          </button>
          <button
            id="style-tab-explore"
            type="button"
            role="tab"
            :aria-selected="activeTab === 'explore'"
            aria-controls="style-panel-explore"
            :tabindex="activeTab === 'explore' ? 0 : -1"
            data-style-tab="explore"
            @click="selectTab('explore')"
            @keydown="onTabKeydown($event, 2)"
          >
            <Sparkles :size="15" :stroke-width="1.8" aria-hidden="true" />
            AI 探索
            <span v-if="generatedCandidates.length" class="tab-count">
              {{ generatedCandidates.length }}
            </span>
          </button>
        </nav>

        <div class="modal-body">
          <div v-if="loading && !library" class="loading-state" role="status" aria-live="polite">
            <span class="spinner" aria-hidden="true" />
            正在加载风格库…
          </div>

          <div v-else>
            <div v-if="error" class="error-banner" role="alert">{{ error }}</div>

            <section
              v-show="activeTab === 'system'"
              id="style-panel-system"
              role="tabpanel"
              aria-labelledby="style-tab-system"
              class="style-panel"
            >
              <div class="section-copy">
                <h3>系统预设</h3>
                <p>精选且稳定的配图风格，点击即可应用，不产生模型调用。</p>
              </div>
              <div v-if="systemPresets.length" class="style-grid">
                <ImageStyleCard
                  v-for="(preset, index) in systemPresets"
                  :key="`system:${preset.id}`"
                  :item="presetCard(preset)"
                  :selected="isSelected('system', preset.id)"
                  :disabled="!preset.compatible"
                  disabled-reason="该风格与当前模板尺寸不兼容"
                  :applying="applying('system', preset.id)"
                  :eager="index < 3"
                  @apply="applyStyle('system', preset.id)"
                />
              </div>
              <div v-else class="empty-state">当前模板还没有系统预设。</div>
            </section>

            <section
              v-show="activeTab === 'user'"
              id="style-panel-user"
              role="tabpanel"
              aria-labelledby="style-tab-user"
              class="style-panel"
            >
              <div class="section-copy">
                <h3>我的风格</h3>
                <p>保存过的满意风格会出现在这里，可在新的 deck 中直接复用。</p>
              </div>
              <div v-if="userPresets.length" class="style-grid">
                <ImageStyleCard
                  v-for="preset in userPresets"
                  :key="`user:${preset.id}`"
                  :item="presetCard(preset)"
                  :selected="isSelected('user', preset.id)"
                  :disabled="!preset.compatible"
                  disabled-reason="该风格与当前模板尺寸不兼容"
                  :applying="applying('user', preset.id)"
                  :renaming="renamingPresetId === preset.id"
                  :deleting="deletingPresetId === preset.id"
                  can-manage
                  @apply="applyStyle('user', preset.id)"
                  @rename="renamePreset(preset.id, $event)"
                  @delete="deletePreset(preset.id)"
                />
              </div>
              <div v-else class="empty-state">
                <Bookmark :size="24" :stroke-width="1.5" aria-hidden="true" />
                <strong>还没有保存过风格</strong>
                <span>去 AI 探索抽一组，满意后保存，下个 deck 就能直接使用。</span>
                <button type="button" class="button-secondary" @click="selectTab('explore')">
                  去 AI 探索
                </button>
              </div>
            </section>

            <section
              v-show="activeTab === 'explore'"
              id="style-panel-explore"
              role="tabpanel"
              aria-labelledby="style-tab-explore"
              class="style-panel"
            >
              <div class="explore-intro">
                <div class="section-copy">
                  <h3>AI 探索</h3>
                  <p>显式生成 3 个全新方向，通常需要 3–5 分钟。可关闭弹窗，任务会继续。</p>
                </div>
                <div class="explore-actions">
                  <span class="remaining-count">还可探索 {{ remainingExplorations }} 组</span>
                  <button
                    v-if="!explorationGateMessage"
                    type="button"
                    class="button-primary"
                    :disabled="!canExplore"
                    data-explore-styles
                    @click="explore"
                  >
                    <Sparkles :size="15" :stroke-width="1.8" aria-hidden="true" />
                    {{ exploreButtonLabel }}
                  </button>
                  <button v-else type="button" class="button-secondary" @click="requestSettings">
                    去设置模型
                  </button>
                </div>
              </div>

              <div v-if="explorationGateMessage" class="info-banner">
                {{ explorationGateMessage }}
              </div>

              <div v-if="exploring" class="exploring-state" role="status" aria-live="polite">
                <span class="spinner" aria-hidden="true" />
                <div>
                  <strong>AI 正在探索 3 个新风格…</strong>
                  <p>可以切换到系统预设或关闭风格库；生成完成后重开即可看到结果。</p>
                </div>
              </div>

              <div v-if="draw?.state === 'failed'" class="error-banner" role="alert">
                {{ draw.error || 'AI 探索失败，请重试。' }}
              </div>

              <div v-if="generatedCandidates.length" class="style-grid">
                <ImageStyleCard
                  v-for="candidate in generatedCandidates"
                  :key="`explore:${candidate.assetId}`"
                  :item="candidateCard(candidate)"
                  :selected="isSelected('explore', candidate.assetId)"
                  :disabled="!candidate.compatible"
                  disabled-reason="该候选与当前模板尺寸不兼容"
                  :applying="applying('explore', candidate.assetId)"
                  :saving="savingAssetIds.has(candidate.assetId)"
                  :saved="Boolean(candidate.savedPresetId)"
                  :can-save="!candidate.savedPresetId"
                  @apply="applyStyle('explore', candidate.assetId)"
                  @save="saveCandidate(candidate.assetId, candidate.style)"
                />
              </div>
              <div v-else-if="!exploring" class="empty-state empty-state--compact">
                <Sparkles :size="24" :stroke-width="1.5" aria-hidden="true" />
                <span>尚未探索。系统预设不满意时，再从这里生成一组。</span>
              </div>
            </section>
          </div>
        </div>

        <footer class="modal-footer">
          <span>{{ activeDescription }}</span>
          <button
            type="button"
            class="button-secondary"
            :disabled="applyingKey === 'free' || active?.mode === 'free'"
            data-free-style
            @click="chooseFreeStyle"
          >
            {{ decisionPending ? '暂不指定风格' : '使用自由生成' }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
  background: rgba(70, 54, 30, 0.35);
}

.modal-content {
  width: min(1000px, 100%);
  max-height: 92vh;
  display: flex;
  overflow: hidden;
  flex-direction: column;
  color: var(--color-fg-secondary);
  background: var(--color-bg-elevated);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  font-family: var(--font-sans);
}

.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-6);
  padding: var(--space-5) var(--space-6) var(--space-4);
}

.modal-heading {
  min-width: 0;
}

.modal-heading h2 {
  margin: 0;
  color: var(--color-fg-primary);
  font-family: var(--font-serif);
  font-size: var(--fs-xl);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-tight);
  text-wrap: balance;
}

.modal-heading p {
  margin: var(--space-1) 0 0;
  color: var(--color-fg-tertiary);
  font-size: var(--fs-base);
  line-height: var(--lh-normal);
}

.modal-header__right {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.active-style-label {
  max-width: 260px;
  overflow: hidden;
  padding: var(--space-1) var(--space-2);
  color: var(--color-accent-hover);
  background: var(--color-accent-soft);
  border-radius: var(--radius-sm);
  font-size: var(--fs-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.icon-button {
  width: 32px;
  height: 32px;
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--radius-md);
  color: var(--color-fg-tertiary);
  background: transparent;
  cursor: pointer;
}

.icon-button:hover {
  color: var(--color-fg-primary);
  background: var(--color-bg-subtle);
}

.style-tabs {
  display: flex;
  gap: var(--space-5);
  padding: 0 var(--space-6);
  border-bottom: 1px solid var(--color-border-subtle);
}

.style-tabs button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) 0;
  border: 0;
  border-bottom: 2px solid transparent;
  color: var(--color-fg-tertiary);
  background: transparent;
  cursor: pointer;
  font: inherit;
}

.style-tabs button:hover {
  color: var(--color-fg-secondary);
}

.style-tabs button[aria-selected='true'] {
  border-bottom-color: var(--color-accent);
  color: var(--color-accent);
}

.tab-count {
  min-width: 20px;
  padding: 1px var(--space-1);
  text-align: center;
  color: var(--color-fg-tertiary);
  background: var(--color-bg-subtle);
  border-radius: var(--radius-pill);
  font-size: var(--fs-xs);
  font-variant-numeric: tabular-nums;
}

.modal-body {
  min-height: 390px;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--space-5) var(--space-6);
}

.style-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.section-copy h3 {
  margin: 0;
  color: var(--color-fg-primary);
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
}

.section-copy p {
  margin: var(--space-1) 0 0;
  color: var(--color-fg-tertiary);
  font-size: var(--fs-base);
  line-height: var(--lh-normal);
}

.style-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-4);
}

.loading-state,
.exploring-state,
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  min-height: 220px;
  padding: var(--space-6);
  color: var(--color-fg-tertiary);
  text-align: center;
}

.loading-state,
.empty-state {
  flex-direction: column;
}

.empty-state strong {
  color: var(--color-fg-secondary);
  font-weight: var(--fw-medium);
}

.empty-state--compact {
  min-height: 140px;
}

.spinner {
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}

.explore-intro {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-6);
  padding: var(--space-4);
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
}

.explore-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-3);
}

.remaining-count {
  color: var(--color-fg-muted);
  font-size: var(--fs-sm);
  font-variant-numeric: tabular-nums;
}

.exploring-state {
  min-height: 96px;
  justify-content: flex-start;
  padding: var(--space-4);
  text-align: left;
  background: var(--color-accent-soft);
  border-radius: var(--radius-md);
}

.exploring-state strong {
  color: var(--color-accent-hover);
  font-weight: var(--fw-medium);
}

.exploring-state p {
  margin: var(--space-1) 0 0;
  line-height: var(--lh-normal);
}

.error-banner,
.info-banner {
  margin-bottom: var(--space-4);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  font-size: var(--fs-base);
  line-height: var(--lh-normal);
}

.error-banner {
  color: var(--color-danger);
  background: var(--color-danger-soft);
}

.info-banner {
  color: var(--color-fg-secondary);
  background: var(--color-warning-soft);
}

.button-primary,
.button-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: 36px;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  cursor: pointer;
  font: inherit;
  font-size: var(--fs-base);
}

.button-primary {
  border: 1px solid var(--color-accent);
  color: var(--color-accent-fg);
  background: var(--color-accent);
}

.button-primary:hover:not(:disabled) {
  border-color: var(--color-accent-hover);
  background: var(--color-accent-hover);
}

.button-secondary {
  border: 1px solid var(--color-border);
  color: var(--color-fg-secondary);
  background: var(--color-bg-surface);
}

.button-secondary:hover:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.button-primary:disabled,
.button-secondary:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.icon-button:focus-visible,
.style-tabs button:focus-visible,
.button-primary:focus-visible,
.button-secondary:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-6) var(--space-5);
  border-top: 1px solid var(--color-border-subtle);
  color: var(--color-fg-muted);
  font-size: var(--fs-sm);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 800px) {
  .modal-overlay {
    padding: var(--space-3);
  }

  .style-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .explore-intro,
  .modal-header {
    align-items: stretch;
    flex-direction: column;
  }

  .modal-header__right {
    justify-content: space-between;
  }
}

@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation: none;
    border-top-color: var(--color-border);
    background: var(--color-accent);
  }
}
</style>
