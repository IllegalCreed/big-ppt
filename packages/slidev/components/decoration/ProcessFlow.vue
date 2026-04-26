<script setup lang="ts">
/**
 * 公共装饰组件：流程箭头。
 *
 * N 个步骤水平排列，相邻步骤间用三角箭头连接；适合"阶段流程 / 工作流"
 * 展示。每个步骤通过 named slot `step1..step6` 填内容，cols prop 决定
 * 实际渲染几个步骤（1-6）。
 *
 * 配色：步骤盒子描边 + 箭头颜色读 `--ld-color-brand-primary`，盒子背景
 *      读 `--ld-color-bg-subtle`，文字读 `--ld-color-fg-primary`。
 */
import { computed } from 'vue'

const props = defineProps<{
  /** 渲染几个步骤；默认 3，最大支持 6 */
  cols?: number
}>()

const stepCount = computed(() => {
  const n = props.cols ?? 3
  return Math.max(1, Math.min(6, n))
})
</script>

<template>
  <div class="ld-process-flow">
    <template v-for="i in stepCount" :key="i">
      <div class="ld-step">
        <slot :name="`step${i}`" />
      </div>
      <div v-if="i < stepCount" class="ld-arrow" aria-hidden="true">
        <svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet">
          <path d="M6 4 L18 12 L6 20 Z" />
        </svg>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* 7.5E：ProcessFlow 不撑满 body 高度，step 自然高度 + body flex column 中
 * 上下 margin: auto 让组件垂直居中显示，留白用于上下文（标题 / 总结）。
 */
.ld-process-flow {
  display: flex;
  align-items: stretch;
  width: 100%;
  margin: auto 0;
  flex: 0 0 auto;
  font-family: var(--ld-font-family-brand);
  color: var(--ld-color-fg-primary);
  font-size: var(--ld-font-size-body);
}

.ld-step {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 1.6em 1.2em;
  min-height: 6em;
  background: var(--ld-color-bg-subtle);
  border: var(--ld-border-width-thick) solid var(--ld-color-brand-primary);
  border-radius: var(--ld-radius-md);
  min-width: 0;
}

.ld-arrow {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  width: 2.4em;
  padding: 0 0.4em;
}

.ld-arrow svg {
  width: 100%;
  height: 50%;
  fill: var(--ld-color-brand-primary);
}
</style>
