<script setup lang="ts">
/**
 * Phase 12.5 Task D：从 CacheStatsHint 改名 + 扩展 cost 显示。
 *
 * 历史定位（Phase 12 Task I）：assistant bubble 下方小字，提示 Anthropic prompt
 * caching 本轮命中数据（cached / cost token + 节省比例）。
 *
 * 12.5 起：pi-ai 透传 `usage.cost`（USD 浮点），UI 加 ¥ 成本一栏让用户对单轮
 * 开销有量化感。汇率 USD_TO_RMB = 7.2 写死，TODO 配置化（后续 Phase 加入
 * Settings 的「币种 / 自定义汇率」字段后挪走）。
 *
 * Props：
 * - `usage`: canonical `TokenUsage`（含 cached? + cost?）。`null` 时整条 hint
 *   不渲染（visible computed 控制）。
 *
 * 渲染规则（visible）：
 * - cached > 0 → 渲染缓存命中片段
 * - cost.total > 0 → 渲染 ¥ 成本片段（节省额仅当 cacheRead > 0 时附加）
 * - 两者都为 0/空 → 整体不渲染
 */
import { computed } from 'vue'
import type { TokenUsage } from '@big-ppt/shared'

const props = defineProps<{
  usage: TokenUsage | null
}>()

/** Phase 12.5 写死汇率，TODO（Phase 13+）：搬到 Settings 让用户自定义 / 自动取汇率。 */
const USD_TO_RMB = 7.2

const cachedTokens = computed(() => props.usage?.cached ?? 0)
const cost = computed(() => props.usage?.cost ?? null)

const totalRmb = computed(() => {
  const t = cost.value?.total
  return typeof t === 'number' && t > 0 ? t * USD_TO_RMB : 0
})

/**
 * 节省额 = cost.cacheRead × USD_TO_RMB。
 * pi-ai 把 cacheRead 算成单独一项成本（缓存读取价，通常远低于 input price）；
 * 直接把它显示为「节省 ¥X」最直观——用户看到非零节省即知本轮吃到 cache。
 * cacheRead 不存在 / =0 时不显示节省片段。
 */
const savingsRmb = computed(() => {
  const cr = cost.value?.cacheRead
  return typeof cr === 'number' && cr > 0 ? cr * USD_TO_RMB : 0
})

const visible = computed(() => cachedTokens.value > 0 || totalRmb.value > 0)

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function formatRmb(rmb: number): string {
  // 4 位小数（单轮 ¥ 通常在 0.001~0.5 区间，4 位精度可读）
  return rmb.toFixed(4)
}
</script>

<template>
  <div v-if="visible" class="usage-stats-hint" role="note">
    <span v-if="cachedTokens > 0" class="part part--cache">
      缓存命中 {{ formatTokens(cachedTokens) }} tokens
    </span>
    <span v-if="totalRmb > 0" class="part part--cost">
      本轮 ¥{{ formatRmb(totalRmb) }}
      <span v-if="savingsRmb > 0" class="savings">
        (节省 ¥{{ formatRmb(savingsRmb) }})
      </span>
    </span>
  </div>
</template>

<style scoped>
.usage-stats-hint {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--space-2, 8px);
  margin: 4px 0 0;
  padding: 2px 8px;
  font-size: var(--fs-xs, 11px);
  color: var(--color-fg-tertiary, var(--ld-color-text-subtle, #888));
  background: var(--color-bg-subtle, var(--ld-bg-subtle, rgba(0, 0, 0, 0.03)));
  border-radius: var(--radius-sm, 4px);
  letter-spacing: 0.02em;
}

.part {
  white-space: nowrap;
}

.part--cost {
  color: var(--color-fg-secondary, #6a6a6a);
}

.savings {
  color: var(--color-success, var(--ld-color-success, #4a9d4a));
  margin-left: 2px;
}
</style>
