<!--
  Phase 10.5 spike Task D：DeckRenderer 验证页。

  访问 /_spike/deck-renderer。直接 import 两套真实 starter.md 喂给 DeckRenderer，
  顶部按钮切模板 → 同一份 starter 在另一套 layout 里渲染（layout 字段会不匹配
  落到 unknown 提示，这是预期 —— spike 是验证「能不能渲」不是「能不能跨模板复用 starter」）。

  跟 Slidev iframe 对比的方法：
    1. 跑 `pnpm dev`（顺便起 agent + slidev）
    2. 浏览器开两 tab：
       a. http://localhost:3030/_spike/deck-renderer  ← 本组件
       b. http://localhost:3030/decks/<id>             ← 编辑器 Slidev iframe
    3. 把 (b) 的 deck 也喂同一份 starter.md（dev DB 新建 deck 默认就是这个）
    4. 逐页肉眼并排 + devtools spot check getComputedStyle()
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import DeckRenderer from './DeckRenderer.vue'
import beitouStarter from '@big-ppt/slidev/templates/beitou-standard/starter.md?raw'
import jingyedaStarter from '@big-ppt/slidev/templates/jingyeda-standard/starter.md?raw'

const templateId = ref<'beitou-standard' | 'jingyeda-standard'>('beitou-standard')
const sourceName = ref<'beitou' | 'jingyeda'>('beitou')

const markdown = computed(() =>
  sourceName.value === 'beitou' ? beitouStarter : jingyedaStarter,
)
</script>

<template>
  <div class="playground">
    <header class="playground-toolbar">
      <h2>Phase 10.5 Spike — DeckRenderer Playground</h2>
      <div class="toolbar-row">
        <span>模板：</span>
        <button
          :class="{ active: templateId === 'beitou-standard' }"
          @click="templateId = 'beitou-standard'"
        >
          北投
        </button>
        <button
          :class="{ active: templateId === 'jingyeda-standard' }"
          @click="templateId = 'jingyeda-standard'"
        >
          竞业达
        </button>
      </div>
      <div class="toolbar-row">
        <span>Starter 源：</span>
        <button :class="{ active: sourceName === 'beitou' }" @click="sourceName = 'beitou'">
          beitou starter.md
        </button>
        <button :class="{ active: sourceName === 'jingyeda' }" @click="sourceName = 'jingyeda'">
          jingyeda starter.md
        </button>
      </div>
      <p class="hint">
        提示：starter 源与模板不匹配时（如 beitou starter + 竞业达模板），layout
        字段是 beitou-* 前缀，会落到 unknown 提示框 —— 这是预期行为，spike 不验
        跨模板自动重写（那是切模板工具链的事）。
      </p>
    </header>
    <DeckRenderer :markdown="markdown" :template-id="templateId" />
  </div>
</template>

<style scoped>
.playground {
  padding: 24px;
  font-family: -apple-system, system-ui, sans-serif;
}
.playground-toolbar {
  margin-bottom: 24px;
  padding: 16px;
  background: #fafafa;
  border: 1px solid #eee;
}
.playground-toolbar h2 {
  margin: 0 0 12px;
  font-size: 18px;
}
.toolbar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.toolbar-row button {
  padding: 4px 12px;
  border: 1px solid #d9d9d9;
  background: #fff;
  cursor: pointer;
}
.toolbar-row button.active {
  background: #1677ff;
  color: #fff;
  border-color: #1677ff;
}
.hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: #888;
}
</style>
