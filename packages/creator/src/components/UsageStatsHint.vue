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
 * - cost.total > 0 → 渲染 ¥ 成本片段（缓存命中价仅当 cacheRead > 0 时附加）
 * - 两者都为 0/空 → 整体不渲染
 *
 * **重要：「缓存命中 ¥X」不是节省额**：pi-ai 的 `cost.cacheRead` 是缓存读取
 * **已付**的钱（typical 是 normal input rate 的 ~10%），不是「节省了多少」。
 * 早期把它显示为「节省 ¥X」是误导（code review 指出）；改成「缓存命中 ¥X」
 * 让用户知道这是「用缓存的成本」，再对比 cost.input 自行体会差价。
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
 * 缓存读取的实际成本（不是节省额）。
 *
 * 重要：pi-ai 的 `cost.cacheRead` 是**缓存读取已付**的钱（typical 是 normal
 * input rate 的 10%~25%），不是「节省了多少」。早期写成「节省 ¥X」误导用户
 * （code review fix）。诚实做法是直接 label「缓存命中 ¥X」—— 让用户知道这
 * 是「用缓存的成本」，可对比 `cost.input` 体会差价。
 *
 * 真节省 ≈ cacheRead_tokens × (normal_rate − cache_read_rate)，但不同 provider
 * cache rate 差异大（OpenAI 25% / Anthropic 10% / Gemini 10%...），单一估算
 * 反而误导。等 pi-ai 上游补 `savings` 字段后再扩展；现在保持「显示已付价」最诚实。
 */
const cacheReadCostRmb = computed(() => {
  const cr = cost.value?.cacheRead
  return typeof cr === 'number' && cr > 0 ? cr * USD_TO_RMB : 0
})

const cacheHit = computed(() => cacheReadCostRmb.value > 0)

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
      <span v-if="cacheHit" class="cache-cost">
        (缓存命中 ¥{{ formatRmb(cacheReadCostRmb) }})
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

.cache-cost {
  /* 不再用 success 绿色——「缓存命中」是中性事实，不是「节省 / 收益」语义；
     保持次级文字色让它视觉上像辅助说明（subtle hint）而非高亮成就。 */
  color: var(--color-fg-tertiary, var(--ld-color-text-subtle, #888));
  margin-left: 2px;
}
</style>
