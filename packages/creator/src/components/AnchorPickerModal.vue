<script setup lang="ts">
/**
 * Phase 11.8 Task F-2: 选风格 modal。
 *
 * 3 张样张缩略图(`/api/assets/<assetId>` 加载)+ "换一批" + "跳过本次" + 选定 → 写 anchor。
 * 真 state 由 useMoodBoardPicker composable 提供(单例 modal,自动触发 / 顶栏按钮共享)。
 *
 * VTU 2 不跨 Teleport 边界 query,组件外 `disableTeleport` prop 给单测用(参考
 * TemplatePickerModal 套路)。
 */
import { computed } from 'vue'
import { X, RefreshCw, SkipForward } from 'lucide-vue-next'
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
  canRegenerate,
  selectAnchor,
  regenerate,
  skip,
} = picker

const remainingLabel = computed(() => {
  if (remainingGenerations.value === -1) return ''
  if (remainingGenerations.value === 0) return '已用完 3 次,请跳过或选定一张'
  return `还可换 ${remainingGenerations.value} 次`
})

const progressHint = computed(() => {
  if (!loading.value) return ''
  if (candidates.value.length === 0) {
    return '正在为您准备 3 张样张,约 30-60 秒(分析大纲 → 主 LLM 出 prompt → 并发出图)…'
  }
  return '正在更新…'
})
</script>

<template>
  <Teleport to="body" :disabled="disableTeleport">
    <div v-if="open" class="modal-overlay" data-anchor-picker-modal>
      <div class="modal-content">
        <div class="modal-header">
          <div>
            <h3>选个视觉风格</h3>
            <p class="modal-sub">主 LLM 根据 deck 内容出了 3 个不同风格的样张。挑一张作为锚图,后续每页都按它的风格生成。</p>
          </div>
          <button
            type="button"
            class="close-btn"
            aria-label="跳过本次选风格"
            data-skip-button
            @click="skip"
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
                :disabled="loading"
                :data-candidate-id="c.assetId"
                @click="selectAnchor(c.assetId)"
              >
                <img
                  :src="`/api/assets/${c.assetId}`"
                  :alt="c.style"
                  class="candidate-img"
                  loading="lazy"
                />
                <div class="candidate-label">{{ c.style }}</div>
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
              class="btn-skip"
              data-skip-bottom
              :disabled="loading"
              @click="skip"
            >
              <SkipForward :size="14" :stroke-width="1.8" />
              跳过本次
            </button>
            <button
              type="button"
              class="btn-regenerate"
              data-regenerate
              :disabled="!canRegenerate"
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
  transition: border-color 0.15s, transform 0.15s;
}
.candidate-card:hover:not(:disabled) {
  border-color: var(--color-accent, #ea580c);
  transform: translateY(-2px);
}
.candidate-card:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.candidate-img {
  width: 100%;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  background: var(--color-bg-hover, #f3f4f6);
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
.btn-skip,
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
.btn-skip:hover:not(:disabled) {
  background: var(--color-bg-hover, #f3f4f6);
}
.btn-regenerate:hover:not(:disabled) {
  filter: brightness(0.9);
}
.btn-skip:disabled,
.btn-regenerate:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
