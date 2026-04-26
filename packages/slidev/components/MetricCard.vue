<script setup lang="ts">
/**
 * 公共内容块组件：单指标卡。
 *
 * 展示"数字 + 单位 + 标签"的标准三段结构（如"89% 留存率 / +23% 增长"）。
 * 通过 variant 切三种视觉：fill 主色填充白字、subtle 浅灰底黑字、outline 仅边框。
 * 配色 / 字号读 `--ld-*` token，跨模板自动适配。
 */
defineProps<{
  /** 数值（必填） */
  value: string | number
  /** 单位（可选，如 '%' / '万' / '点'） */
  unit?: string
  /** 标签描述（必填，如 '客户留存率'） */
  label: string
  /** 视觉档位；默认 'fill' */
  variant?: 'fill' | 'subtle' | 'outline'
}>()
</script>

<template>
  <div class="ld-metric-card" :data-variant="variant ?? 'fill'">
    <div class="ld-metric-value">
      <span class="ld-metric-number">{{ value }}</span>
      <span v-if="unit" class="ld-metric-unit">{{ unit }}</span>
    </div>
    <div class="ld-metric-label">{{ label }}</div>
  </div>
</template>

<style scoped>
.ld-metric-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.4em;
  padding: 1em 1.2em;
  border-radius: var(--ld-radius-md);
  font-family: var(--ld-font-family-brand);
  text-align: center;
  min-width: 0;
}

.ld-metric-card[data-variant='fill'] {
  background: var(--ld-color-brand-primary);
  color: #ffffff;
}

.ld-metric-card[data-variant='subtle'] {
  background: var(--ld-color-bg-subtle);
  color: var(--ld-color-fg-primary);
}

.ld-metric-card[data-variant='outline'] {
  background: transparent;
  color: var(--ld-color-fg-primary);
  border: var(--ld-border-width-thin) solid var(--ld-color-brand-primary);
}

.ld-metric-value {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 0.15em;
  font-weight: var(--ld-font-weight-bold);
  line-height: 1;
}

.ld-metric-number {
  font-size: var(--ld-font-size-h1);
}

.ld-metric-unit {
  font-size: var(--ld-font-size-h2);
  opacity: 0.85;
}

.ld-metric-label {
  font-family: var(--ld-font-family-ui);
  font-size: var(--ld-font-size-body);
  font-weight: var(--ld-font-weight-regular);
  opacity: 0.92;
}
</style>
