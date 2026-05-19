<script setup lang="ts">
/**
 * Phase 11.8 Task F-2: 选风格 modal。
 * Phase 11.8 dogfood(2026-05-19)重写:
 *   - 已选 anchor 状态:卡片高亮选中,「换一批」按钮 disabled,底部主按钮文案「取消风格限制」
 *   - 未选 anchor:卡片正常,「换一批」可用,底部主按钮文案「暂不指定风格」
 *   - 重开 modal 显示历史候选(不再每次 regenerate)
 *
 * VTU 2 不跨 Teleport 边界 query,组件外 `disableTeleport` prop 给单测用(参考
 * TemplatePickerModal 套路)。
 */
import { computed } from 'vue'
import { X, RefreshCw, Check } from 'lucide-vue-next'
import { useMoodBoardPicker } from '../composables/useMoodBoardPicker'

defineProps<{
  /** 测试用:禁用 Teleport,让 modal 在父 wrapper 内渲染 */
  disableTeleport?: boolean
}>()

const picker = useMoodBoardPicker()
const {
  open,
  loading,
  candidates,
  error,
  retried,
  diversityDegraded,
  remainingGenerations,
  selectedAssetId,
  canRegenerate,
  primaryActionMode,
  selectAnchor,
  regenerate,
  triggerPrimaryAction,
  closePicker,
} = picker

const remainingLabel = computed(() => {
  if (remainingGenerations.value === -1) return ''
  if (remainingGenerations.value === 0) return '已用完 3 次生成,可继续选已有候选或取消风格限制'
  return `还可换 ${remainingGenerations.value} 次`
})

const primaryButtonLabel = computed(() =>
  primaryActionMode.value === 'clear' ? '取消风格限制' : '暂不指定风格',
)

const regenerateTooltip = computed(() => {
  if (selectedAssetId.value !== null) {
    return '请先点「取消风格限制」放弃当前 anchor,才能换一批'
  }
  if (remainingGenerations.value === 0) return '本 deck 已用完 3 次生成'
  return ''
})

const progressHint = computed(() => {
  if (!loading.value) return ''
  if (candidates.value.length === 0) {
    return '正在为您准备 3 张样张,约 30-60 秒(分析大纲 → 主 LLM 出 prompt → 并发出图)…'
  }
  return '正在更新…'
})

const modalSubtitle = computed(() => {
  if (selectedAssetId.value !== null) {
    return '你已选定这个风格作为锚图,后续每页都按它生成。可以「取消风格限制」让 AI 自由发挥,或重新挑一张。'
  }
  return '主 LLM 根据 deck 内容出了 3 个不同风格的样张。挑一张作为锚图,后续每页都按它的风格生成。'
})
</script>

<template>
  <Teleport to="body" :disabled="disableTeleport">
    <div v-if="open" class="modal-overlay" data-anchor-picker-modal>
      <div class="modal-content">
        <div class="modal-header">
          <div>
            <h3>选个视觉风格</h3>
            <p class="modal-sub">{{ modalSubtitle }}</p>
          </div>
          <button
            type="button"
            class="close-btn"
            aria-label="关闭"
            data-close-button
            @click="closePicker"
          >
            <X :size="18" :stroke-width="1.8" />
          </button>
        </div>

        <div class="modal-body">
          <div v-if="loading && candidates.length === 0" class="loading-state">
            <div class="spinner" />
            <p>{{ progressHint }}</p>
          </div>

          <div v-else-if="error" class="error-state">
            <p class="error-msg">{{ error }}</p>
            <p v-if="remainingGenerations === 0" class="error-sub">
              建议跳过用默认模板风格继续生成(text-only + 模板色板约束)。
            </p>
          </div>

          <template v-else-if="candidates.length > 0">
            <div class="candidate-grid">
              <button
                v-for="c in candidates"
                :key="c.assetId"
                type="button"
                class="candidate-card"
                :class="{ 'is-selected': selectedAssetId === c.assetId }"
                :disabled="loading"
                :data-candidate-id="c.assetId"
                :data-selected="selectedAssetId === c.assetId ? 'true' : 'false'"
                @click="selectAnchor(c.assetId)"
              >
                <div class="candidate-img-wrap">
                  <img
                    :src="`/api/assets/${c.assetId}`"
                    :alt="c.style"
                    class="candidate-img"
                    loading="lazy"
                  />
                  <div v-if="selectedAssetId === c.assetId" class="selected-badge" aria-label="已选定">
                    <Check :size="16" :stroke-width="2.5" />
                  </div>
                </div>
                <div class="candidate-label">{{ c.style || '风格' }}</div>
              </button>
            </div>

            <div v-if="retried" class="retry-hint">
              <span v-if="diversityDegraded">⚠ LLM 出了风格仍然偏雷同,可点"换一批"</span>
              <span v-else>已自动 retry 一次让 3 种风格差异化</span>
            </div>
          </template>
        </div>

        <div class="modal-footer">
          <span class="remaining-label">{{ remainingLabel }}</span>
          <div class="modal-footer__btns">
            <button
              type="button"
              class="btn-primary-action"
              data-primary-action
              :data-mode="primaryActionMode"
              :disabled="loading"
              @click="triggerPrimaryAction"
            >
              {{ primaryButtonLabel }}
            </button>
            <button
              type="button"
              class="btn-regenerate"
              data-regenerate
              :disabled="!canRegenerate"
              :title="regenerateTooltip"
              @click="regenerate"
            >
              <RefreshCw :size="14" :stroke-width="1.8" />
              换一批
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.modal-content {
  background: var(--color-bg-base, #fff);
  border-radius: 12px;
  max-width: 720px;
  width: 92vw;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 50px rgba(15, 23, 42, 0.2);
  overflow: hidden;
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 18px 22px 12px;
  border-bottom: 1px solid var(--color-border-subtle, #e5e7eb);
}
.modal-header h3 {
  margin: 0 0 4px;
  font-size: 17px;
  font-weight: 600;
}
.modal-sub {
  margin: 0;
  font-size: 13px;
  color: var(--color-fg-muted, #6b7280);
  line-height: 1.5;
}
.close-btn {
  background: transparent;
  border: 0;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  color: var(--color-fg-muted, #6b7280);
}
.close-btn:hover {
  background: var(--color-bg-hover, #f3f4f6);
}
.modal-body {
  padding: 18px 22px;
  overflow-y: auto;
  min-height: 200px;
}
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 32px;
  text-align: center;
  color: var(--color-fg-muted, #6b7280);
}
.spinner {
  width: 28px;
  height: 28px;
  border: 2.5px solid var(--color-border-subtle, #e5e7eb);
  border-top-color: var(--color-accent, #ea580c);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.error-state {
  padding: 16px;
  background: var(--color-bg-warn, #fef3c7);
  border-radius: 8px;
}
.error-msg {
  margin: 0 0 6px;
  font-size: 14px;
  color: var(--color-fg-warn, #92400e);
}
.error-sub {
  margin: 0;
  font-size: 13px;
  color: var(--color-fg-muted, #6b7280);
}
.candidate-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.candidate-card {
  background: transparent;
  border: 2px solid var(--color-border-subtle, #e5e7eb);
  border-radius: 10px;
  padding: 0;
  cursor: pointer;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s;
}
.candidate-card:hover:not(:disabled) {
  border-color: var(--color-accent, #ea580c);
  transform: translateY(-2px);
}
.candidate-card:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.candidate-card.is-selected {
  border-color: var(--color-accent, #ea580c);
  box-shadow: 0 0 0 3px rgba(234, 88, 12, 0.18);
}
.candidate-img-wrap {
  position: relative;
}
.candidate-img {
  width: 100%;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  background: var(--color-bg-hover, #f3f4f6);
  display: block;
}
.selected-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 26px;
  height: 26px;
  background: var(--color-accent, #ea580c);
  color: #fff;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.25);
}
.candidate-label {
  font-size: 12px;
  padding: 8px;
  text-align: center;
  color: var(--color-fg-base, #1f2937);
  background: var(--color-bg-subtle, #f9fafb);
  font-weight: 500;
}
.retry-hint {
  margin-top: 12px;
  font-size: 12px;
  color: var(--color-fg-muted, #6b7280);
  text-align: center;
}
.modal-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 22px 18px;
  border-top: 1px solid var(--color-border-subtle, #e5e7eb);
}
.remaining-label {
  font-size: 12px;
  color: var(--color-fg-muted, #6b7280);
}
.modal-footer__btns {
  display: flex;
  gap: 8px;
}
.btn-primary-action,
.btn-regenerate {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid var(--color-border-subtle, #e5e7eb);
  background: var(--color-bg-base, #fff);
  color: var(--color-fg-base, #1f2937);
}
.btn-regenerate {
  background: var(--color-accent, #ea580c);
  border-color: var(--color-accent, #ea580c);
  color: #fff;
}
.btn-primary-action:hover:not(:disabled) {
  background: var(--color-bg-hover, #f3f4f6);
}
.btn-regenerate:hover:not(:disabled) {
  filter: brightness(0.9);
}
.btn-primary-action:disabled,
.btn-regenerate:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
