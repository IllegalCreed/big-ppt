<!--
  通用密码输入框：右侧带"显示/隐藏"小眼睛 toggle。
  样式与 LoginPage / RegisterPage 的 .field input 保持视觉一致（同 token + 同尺寸）。
-->
<script setup lang="ts">
import { ref } from 'vue'
import { Eye, EyeOff } from 'lucide-vue-next'

withDefaults(
  defineProps<{
    modelValue: string
    autocomplete?: string
    minlength?: number
    required?: boolean
    placeholder?: string
  }>(),
  { required: false, minlength: 0 },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const visible = ref(false)

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
}

function toggle() {
  visible.value = !visible.value
}
</script>

<template>
  <div class="password-wrap">
    <input
      :type="visible ? 'text' : 'password'"
      :value="modelValue"
      :autocomplete="autocomplete"
      :minlength="minlength || undefined"
      :required="required"
      :placeholder="placeholder"
      @input="onInput"
    />
    <button
      type="button"
      class="toggle"
      :aria-label="visible ? '隐藏密码' : '显示密码'"
      :title="visible ? '隐藏密码' : '显示密码'"
      tabindex="-1"
      @click="toggle"
    >
      <component :is="visible ? EyeOff : Eye" :size="16" :stroke-width="1.8" />
    </button>
  </div>
</template>

<style scoped>
.password-wrap {
  position: relative;
  display: flex;
  align-items: stretch;
}
.password-wrap input {
  flex: 1;
  height: 40px;
  padding: 0 40px 0 var(--space-3);  /* 右侧给 toggle 按钮预留空间 */
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-bg-app);
  color: var(--color-fg-primary);
  font-size: var(--fs-base);
  transition: border-color var(--dur-fast) var(--ease-out);
}
.password-wrap input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(193, 95, 60, 0.15);
}
.toggle {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--color-fg-tertiary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  transition: color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
}
.toggle:hover {
  color: var(--color-fg-primary);
  background: rgba(0, 0, 0, 0.04);
}
.toggle:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}
</style>
