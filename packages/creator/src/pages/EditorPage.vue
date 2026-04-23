<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { LogOut, Settings, Sparkles } from 'lucide-vue-next'
import ChatPanel from '../components/ChatPanel.vue'
import SlidePreview from '../components/SlidePreview.vue'
import SettingsModal from '../components/SettingsModal.vue'
import { useAuth } from '../composables/useAuth'

const router = useRouter()
const { currentUser, logout } = useAuth()

const showSettings = ref(false)
const leftWidth = ref(40)
const isDragging = ref(false)
const mainRef = ref<HTMLElement | null>(null)

function onMouseDown(e: MouseEvent) {
  isDragging.value = true
  e.preventDefault()

  const startX = e.clientX
  const startWidth = leftWidth.value
  const containerWidth = mainRef.value!.offsetWidth

  function onMouseMove(e: MouseEvent) {
    const delta = ((e.clientX - startX) / containerWidth) * 100
    leftWidth.value = Math.min(70, Math.max(20, startWidth + delta))
  }

  function onMouseUp() {
    isDragging.value = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

async function onLogout() {
  await logout()
  await router.replace('/login')
}
</script>

<template>
  <div class="app-root">
    <header class="toolbar">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">
          <Sparkles :size="18" :stroke-width="1.8" />
        </div>
        <div class="brand-text">
          <div class="brand-title">Lumideck</div>
          <div class="brand-subtitle">幻光千叶</div>
        </div>
      </div>

      <div class="toolbar-actions">
        <span v-if="currentUser" class="user-email">{{ currentUser.email }}</span>
        <button
          type="button"
          class="icon-btn"
          title="设置"
          aria-label="设置"
          @click="showSettings = true"
        >
          <Settings :size="18" :stroke-width="1.8" />
        </button>
        <button
          type="button"
          class="icon-btn"
          title="退出登录"
          aria-label="退出登录"
          @click="onLogout"
        >
          <LogOut :size="18" :stroke-width="1.8" />
        </button>
      </div>
    </header>

    <main class="main-content" ref="mainRef">
      <div class="panel-left" :style="{ width: leftWidth + '%' }">
        <ChatPanel />
      </div>
      <div class="divider" :class="{ active: isDragging }" @mousedown="onMouseDown" />
      <div class="panel-right">
        <SlidePreview />
      </div>
      <div v-if="isDragging" class="drag-overlay" />
    </main>

    <SettingsModal v-model:open="showSettings" />
  </div>
</template>

<style scoped>
.app-root {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-app);
  font-family: var(--font-sans);
  color: var(--color-fg-secondary);
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-6);
  height: 56px;
  background: var(--color-bg-surface);
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.brand-mark {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  background: var(--color-accent-soft);
  color: var(--color-accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: inset 0 0 0 1px rgba(193, 95, 60, 0.12);
  flex-shrink: 0;
}

.brand-text {
  display: flex;
  flex-direction: column;
  line-height: var(--lh-tight);
  padding-top: 1px;
}

.brand-title {
  font-family: var(--font-serif);
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
  color: var(--color-fg-primary);
  letter-spacing: 0.01em;
}

.brand-subtitle {
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: var(--fw-medium);
  color: var(--color-fg-tertiary);
  letter-spacing: 0.08em;
  margin-top: 2px;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.user-email {
  font-size: var(--fs-sm);
  color: var(--color-fg-tertiary);
  padding: 0 var(--space-2);
}

.icon-btn {
  width: 34px;
  height: 34px;
  border: none;
  background: transparent;
  border-radius: var(--radius-md);
  color: var(--color-fg-tertiary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.icon-btn:hover {
  background: var(--color-bg-subtle);
  color: var(--color-accent);
}

.icon-btn:active {
  background: var(--color-accent-soft);
}

.main-content {
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
}

.panel-left {
  min-width: 320px;
  display: flex;
  flex-direction: column;
}

.divider {
  width: 6px;
  cursor: col-resize;
  background: var(--color-border-strong);
  transition: background var(--dur-base) var(--ease-out);
  flex-shrink: 0;
  position: relative;
}

.divider::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 2px;
  height: 24px;
  background-image: radial-gradient(circle, var(--color-fg-muted) 1px, transparent 1.5px);
  background-size: 2px 8px;
  background-repeat: repeat-y;
  transition: background-image var(--dur-base) var(--ease-out);
  pointer-events: none;
}

.divider:hover,
.divider.active {
  background: var(--color-accent);
}

.divider:hover::before,
.divider.active::before {
  background-image: radial-gradient(circle, var(--color-accent-fg) 1px, transparent 1.5px);
}

.panel-right {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 320px;
}

.drag-overlay {
  position: absolute;
  inset: 0;
  z-index: 100;
  cursor: col-resize;
}
</style>
