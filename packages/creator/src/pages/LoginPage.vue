<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute, RouterLink } from 'vue-router'
import { Sparkles } from 'lucide-vue-next'
import { useAuth } from '../composables/useAuth'
import { ApiError } from '../api/client'
import PasswordInput from '../components/PasswordInput.vue'

const router = useRouter()
const route = useRoute()
const { login } = useAuth()

const email = ref('')
const password = ref('')
const submitting = ref(false)
const error = ref('')

async function onSubmit() {
  if (submitting.value) return
  error.value = ''
  submitting.value = true
  try {
    await login(email.value.trim(), password.value)
    const next = typeof route.query.next === 'string' ? route.query.next : '/'
    await router.replace(next)
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : String((err as Error).message || err)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="auth-shell">
    <form class="auth-card" @submit.prevent="onSubmit">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">
          <Sparkles :size="20" :stroke-width="1.8" />
        </div>
        <div class="brand-text">
          <div class="brand-title">Lumideck</div>
          <div class="brand-subtitle">幻光千叶</div>
        </div>
      </div>

      <h1 class="auth-heading">登录</h1>

      <label class="field">
        <span class="field-label">邮箱</span>
        <input v-model="email" type="email" autocomplete="email" required placeholder="you@example.com" />
      </label>

      <label class="field">
        <span class="field-label">密码</span>
        <PasswordInput v-model="password" autocomplete="current-password" :required="true" :minlength="6" />
      </label>

      <p v-if="error" class="error">{{ error }}</p>

      <button type="submit" class="primary" :disabled="submitting">
        {{ submitting ? '登录中...' : '登录' }}
      </button>

      <p class="footer">
        还没有账号？<RouterLink to="/register">去注册</RouterLink>
      </p>
    </form>
  </div>
</template>

<style scoped>
.auth-shell {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-app);
  padding: var(--space-6);
}

.auth-card {
  width: 100%;
  max-width: 400px;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--space-8);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-2);
}

.brand-mark {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  background: var(--color-accent-soft);
  color: var(--color-accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.brand-title {
  font-family: var(--font-serif);
  font-size: var(--fs-xl);
  font-weight: var(--fw-semibold);
  color: var(--color-fg-primary);
}

.brand-subtitle {
  font-size: 11px;
  font-weight: var(--fw-medium);
  color: var(--color-fg-tertiary);
  letter-spacing: 0.08em;
  margin-top: 2px;
}

.auth-heading {
  font-family: var(--font-serif);
  font-size: var(--fs-2xl);
  font-weight: var(--fw-semibold);
  color: var(--color-fg-primary);
  margin: 0;
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.field-label {
  font-size: var(--fs-sm);
  color: var(--color-fg-secondary);
  font-weight: var(--fw-medium);
}

.field input {
  height: 40px;
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-bg-app);
  color: var(--color-fg-primary);
  font-size: var(--fs-base);
  transition: border-color var(--dur-fast) var(--ease-out);
}

.field input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(193, 95, 60, 0.15);
}

.error {
  color: var(--color-danger, #B4472C);
  font-size: var(--fs-sm);
  margin: 0;
}

.primary {
  height: 42px;
  border: none;
  background: var(--color-accent);
  color: var(--color-accent-fg, #fff);
  border-radius: var(--radius-md);
  font-size: var(--fs-base);
  font-weight: var(--fw-medium);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}

.primary:hover:not(:disabled) {
  background: #A94E2E;
}

.primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.footer {
  text-align: center;
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--color-fg-tertiary);
}

.footer a {
  color: var(--color-accent);
  text-decoration: none;
}

.footer a:hover {
  text-decoration: underline;
}
</style>
