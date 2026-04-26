<script setup lang="ts">
/**
 * 公共内容块组件：表格。
 *
 * 展示二维结构化数据（项目状态 / 对比矩阵 / 资源清单等）；
 * 表头读 `--ld-color-brand-primary` 主色填充白字，
 * 斑马条用 `--ld-color-bg-subtle` 浅灰，文字读 `--ld-color-fg-*` token。
 */
defineProps<{
  /** 表头数组 */
  headers: string[]
  /** 数据行数组；每行长度应与 headers 一致 */
  rows: (string | number)[][]
  /** 视觉档位；默认 'striped' 含斑马条；'plain' 仅边框无斑马 */
  variant?: 'striped' | 'plain'
}>()
</script>

<template>
  <table class="ld-table" :data-variant="variant ?? 'striped'">
    <thead>
      <tr>
        <th v-for="(h, idx) in headers" :key="idx">{{ h }}</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="(row, rIdx) in rows" :key="rIdx">
        <td v-for="(cell, cIdx) in row" :key="cIdx">{{ cell }}</td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.ld-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--ld-font-family-brand);
  font-size: var(--ld-font-size-body);
  color: var(--ld-color-fg-primary);
  border-radius: var(--ld-radius-sm);
  overflow: hidden;
}

.ld-table thead th {
  background: var(--ld-color-brand-primary);
  color: #ffffff;
  font-weight: var(--ld-font-weight-bold);
  text-align: left;
  padding: 0.7em 1em;
  letter-spacing: 0.05em;
}

.ld-table tbody td {
  padding: 0.6em 1em;
  border-bottom: var(--ld-border-width-thin) solid var(--ld-color-bg-subtle);
}

.ld-table[data-variant='striped'] tbody tr:nth-child(even) td {
  background: var(--ld-color-bg-subtle);
}

.ld-table[data-variant='plain'] tbody td {
  border-bottom: var(--ld-border-width-thin) solid var(--ld-color-fg-muted);
}
</style>
