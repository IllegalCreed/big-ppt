<script setup lang="ts">
/**
 * 公共内容块组件：表格。
 *
 * 展示二维结构化数据（项目状态 / 对比矩阵 / 资源清单等）；
 * 表头读 `--ld-color-brand-primary` 主色填充白字，
 * 斑马条用 `--ld-color-bg-subtle` 浅灰，文字读 `--ld-color-fg-*` token。
 *
 * 7.5E：包一层 wrapper + overflow: hidden 防止 row 多时撑出 layout body。
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
  <div class="ld-table-wrap">
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
  </div>
</template>

<style scoped>
.ld-table-wrap {
  width: 100%;
  height: 100%;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border-radius: var(--ld-radius-sm);
}

.ld-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-family: var(--ld-font-family-brand);
  font-size: 0.9em;
  color: var(--ld-color-fg-primary);
}

.ld-table thead th {
  background: var(--ld-color-brand-primary);
  color: #ffffff;
  font-weight: var(--ld-font-weight-bold);
  text-align: left;
  padding: 0.5em 0.9em;
  letter-spacing: 0.04em;
}

.ld-table tbody td {
  padding: 0.45em 0.9em;
  line-height: 1.4;
  border-bottom: var(--ld-border-width-thin) solid var(--ld-color-bg-subtle);
}

.ld-table[data-variant='striped'] tbody tr:nth-child(even) td {
  background: var(--ld-color-bg-subtle);
}

.ld-table[data-variant='plain'] tbody td {
  border-bottom: var(--ld-border-width-thin) solid var(--ld-color-fg-muted);
}
</style>
