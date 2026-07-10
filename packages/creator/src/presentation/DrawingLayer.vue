<script setup lang="ts">
import { ref, watch } from 'vue'
import type { DrawingPoint, DrawingStroke, DrawingTool } from './types'
import { DRAWING_VIEWBOX_HEIGHT, DRAWING_VIEWBOX_WIDTH } from './types'

const props = withDefaults(
  defineProps<{
    strokes: DrawingStroke[]
    enabled?: boolean
    tool?: DrawingTool
    color?: string
    width?: number
  }>(),
  {
    enabled: false,
    tool: 'pen',
    color: '#ef4444',
    width: 4,
  },
)

const emit = defineEmits<{
  'update:strokes': [strokes: DrawingStroke[]]
}>()

const svgRef = ref<SVGSVGElement | null>(null)
const draft = ref<DrawingStroke[]>(props.strokes)
const activeId = ref<string | null>(null)

watch(
  () => props.strokes,
  (strokes) => {
    if (!activeId.value) draft.value = strokes
  },
)

function pointFromEvent(event: PointerEvent): DrawingPoint | null {
  const svg = svgRef.value
  if (!svg) return null
  const rect = svg.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return {
    x: Math.min(
      DRAWING_VIEWBOX_WIDTH,
      Math.max(0, ((event.clientX - rect.left) / rect.width) * DRAWING_VIEWBOX_WIDTH),
    ),
    y: Math.min(
      DRAWING_VIEWBOX_HEIGHT,
      Math.max(0, ((event.clientY - rect.top) / rect.height) * DRAWING_VIEWBOX_HEIGHT),
    ),
  }
}

function emitDraft(): void {
  emit(
    'update:strokes',
    draft.value.map((stroke) => ({ ...stroke, points: [...stroke.points] })),
  )
}

function onPointerDown(event: PointerEvent): void {
  if (!props.enabled || event.button !== 0) return
  const point = pointFromEvent(event)
  if (!point) return
  event.preventDefault()
  svgRef.value?.setPointerCapture?.(event.pointerId)
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
  activeId.value = id
  draft.value = [
    ...props.strokes,
    {
      id,
      tool: props.tool,
      color: props.color,
      width: props.width,
      points: [point],
    },
  ]
  emitDraft()
}

function onPointerMove(event: PointerEvent): void {
  if (!activeId.value) return
  const point = pointFromEvent(event)
  if (!point) return
  event.preventDefault()
  draft.value = draft.value.map((stroke) =>
    stroke.id === activeId.value ? { ...stroke, points: [...stroke.points, point] } : stroke,
  )
  emitDraft()
}

function finishStroke(event: PointerEvent): void {
  if (!activeId.value) return
  svgRef.value?.releasePointerCapture?.(event.pointerId)
  activeId.value = null
  emitDraft()
}

function points(stroke: DrawingStroke): string {
  return stroke.points.map((point) => `${point.x},${point.y}`).join(' ')
}
</script>

<template>
  <svg
    ref="svgRef"
    class="drawing-layer"
    :class="{ 'is-enabled': enabled }"
    :viewBox="`0 0 ${DRAWING_VIEWBOX_WIDTH} ${DRAWING_VIEWBOX_HEIGHT}`"
    preserveAspectRatio="none"
    aria-hidden="true"
    data-drawing-layer
    @pointerdown.stop="onPointerDown"
    @pointermove.stop="onPointerMove"
    @pointerup.stop="finishStroke"
    @pointercancel.stop="finishStroke"
  >
    <polyline
      v-for="stroke in draft"
      :key="stroke.id"
      :points="points(stroke)"
      :stroke="stroke.color"
      :stroke-width="stroke.width"
      :stroke-opacity="stroke.tool === 'highlighter' ? 0.32 : 1"
      :class="`stroke-${stroke.tool}`"
      fill="none"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>

<style scoped>
.drawing-layer {
  position: absolute;
  inset: 0;
  z-index: 4;
  width: 100%;
  height: 100%;
  pointer-events: none;
  touch-action: none;
}

.drawing-layer.is-enabled {
  pointer-events: auto;
  cursor: crosshair;
}

.stroke-highlighter {
  mix-blend-mode: multiply;
}
</style>
