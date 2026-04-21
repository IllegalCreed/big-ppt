<!-- packages/creator/src/components/MCPCustomServer.vue -->
<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import type { CreateMcpServerRequest, McpServerWithStatus } from '@big-ppt/shared'

const props = defineProps<{ customServers: McpServerWithStatus[] }>()
const emit = defineEmits<{
  create: [req: CreateMcpServerRequest]
  remove: [id: string]
}>()

const expanded = ref(false)
const form = reactive<CreateMcpServerRequest>({
  id: '',
  displayName: '',
  description: '',
  url: '',
  headers: {},
})
const headerKey = ref('')
const headerValue = ref('')
const pendingId = ref<string | null>(null)

function addHeader() {
  if (!headerKey.value) return
  form.headers = { ...(form.headers ?? {}), [headerKey.value]: headerValue.value }
  headerKey.value = ''
  headerValue.value = ''
}

function submit() {
  if (!form.id || !form.displayName || !form.url) {
    alert('id / 名称 / URL 三项必填')
    return
  }
  // 客户端同步 id 格式校验,与 agent 的 /^[a-zA-Z0-9_-]+$/ 一致
  if (!/^[a-zA-Z0-9_-]+$/.test(form.id)) {
    alert('id 只能包含字母、数字、- 和 _')
    return
  }
  pendingId.value = form.id
  emit('create', { ...form })
}

// 监听 customServers 变化,只有当 pending 的 id 出现时才清空表单
watch(
  () => props.customServers.map((s) => s.id).join(','),
  () => {
    if (pendingId.value && props.customServers.some((s) => s.id === pendingId.value)) {
      form.id = ''
      form.displayName = ''
      form.description = ''
      form.url = ''
      form.headers = {}
      pendingId.value = null
    }
  },
)
</script>

<template>
  <div class="mcp-custom">
    <button class="mcp-custom__toggle" @click="expanded = !expanded">
      {{ expanded ? '▼' : '▶' }} 自定义 MCP Server(进阶)
    </button>
    <div v-if="expanded" class="mcp-custom__body">
      <div class="mcp-custom__list">
        <div v-for="srv in customServers" :key="srv.id" class="mcp-custom__row">
          <span>{{ srv.displayName }}</span>
          <code>{{ srv.url }}</code>
          <button @click="emit('remove', srv.id)">删除</button>
        </div>
        <div v-if="customServers.length === 0" class="mcp-custom__empty">尚未添加自定义 MCP</div>
      </div>

      <div class="mcp-custom__form">
        <input v-model="form.id" placeholder="id(字母/数字/-/_)" />
        <input v-model="form.displayName" placeholder="显示名" />
        <input v-model="form.url" placeholder="https://your-mcp/endpoint/mcp" />
        <input v-model="form.description" placeholder="说明(可选)" />
        <div class="mcp-custom__headers">
          <input v-model="headerKey" placeholder="Header Name" />
          <input v-model="headerValue" placeholder="Header Value" />
          <button @click="addHeader">+ 添加 Header</button>
        </div>
        <div v-for="(v, k) in form.headers" :key="k" class="mcp-custom__header-row">
          <span>{{ k }}:{{ v }}</span>
        </div>
        <button class="mcp-custom__submit" @click="submit">创建</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mcp-custom { border-top: 1px dashed #eee; padding-top: 12px; }
.mcp-custom__toggle { border: none; background: none; cursor: pointer; font-size: 13px; color: #666; padding: 0; }
.mcp-custom__body { margin-top: 10px; display: flex; flex-direction: column; gap: 10px; }
.mcp-custom__row { display: flex; align-items: center; gap: 10px; font-size: 12px; }
.mcp-custom__row code { color: #666; flex: 1; overflow: hidden; text-overflow: ellipsis; }
.mcp-custom__empty { color: #999; font-size: 12px; }
.mcp-custom__form { display: flex; flex-direction: column; gap: 6px; }
.mcp-custom__form input { padding: 6px 10px; border: 1px solid #d9d9d9; border-radius: 6px; font-size: 13px; }
.mcp-custom__headers { display: grid; grid-template-columns: 1fr 1fr auto; gap: 6px; }
.mcp-custom__header-row { font-size: 11px; color: #666; }
.mcp-custom__submit { padding: 6px 12px; background: #1677ff; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
</style>
