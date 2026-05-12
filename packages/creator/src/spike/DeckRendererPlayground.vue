<script setup lang="ts">
// Phase 10.5 spike 临时页（Task B stub，Task D 完整实现）
// 当前只验证：creator 能 import slidev 的 token 变量，渲染出对应颜色。
</script>

<template>
  <div style="padding: 24px; font-family: sans-serif">
    <h2>Phase 10.5 Spike — DeckRenderer Playground</h2>
    <p>Task B 烟测：以下色块应显示对应模板的品牌色（验证 tokens.css 加载成功）。</p>
    <div style="display: flex; gap: 16px; margin-top: 16px">
      <div
        style="
          width: 120px;
          height: 120px;
          background: var(--bt-brand);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
        "
      >
        北投 --bt-brand
      </div>
      <div
        style="
          width: 120px;
          height: 120px;
          background: var(--jyd-brand);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
        "
      >
        竞业达 --jyd-brand
      </div>
    </div>
    <p style="margin-top: 24px; color: #666">Task D 之后，下方会换成真实 DeckRenderer 渲染。</p>
  </div>
</template>
