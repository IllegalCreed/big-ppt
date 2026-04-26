<script setup lang="ts">
/**
 * 公共内容块组件：引文。
 *
 * 默认 slot 是引文文字；可选 author / cite 标注来源。左侧粗竖线 +
 * 主文字色文字，简洁不抢眼。配色读 `--ld-*` token。
 */
defineProps<{
  /** 作者（可选） */
  author?: string
  /** 引用来源（可选，如出版物 / 演讲场合） */
  cite?: string
}>()
</script>

<template>
  <blockquote class="ld-quote">
    <div class="ld-quote-body">
      <slot />
    </div>
    <footer v-if="author || cite" class="ld-quote-footer">
      <span v-if="author" class="ld-quote-author">— {{ author }}</span>
      <cite v-if="cite" class="ld-quote-cite">{{ cite }}</cite>
    </footer>
  </blockquote>
</template>

<style scoped>
.ld-quote {
  display: flex;
  flex-direction: column;
  gap: 0.6em;
  padding: 0.4em 0 0.4em 1em;
  border-left: var(--ld-border-width-thick) solid var(--ld-color-brand-primary);
  margin: 0;
  font-family: var(--ld-font-family-brand);
  color: var(--ld-color-fg-primary);
  font-size: var(--ld-font-size-body);
}

.ld-quote-body {
  font-style: italic;
  line-height: 1.55;
}

.ld-quote-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4em 1em;
  font-family: var(--ld-font-family-ui);
  font-size: 0.9em;
  color: var(--ld-color-fg-muted);
}

.ld-quote-cite {
  font-style: normal;
}
</style>
