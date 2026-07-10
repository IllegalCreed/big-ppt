<script setup lang="ts">
import { ref, watch } from 'vue'
import type { DrawingMode, DrawingPoint, DrawingStroke } from './types'
import { DRAWING_VIEWBOX_HEIGHT, DRAWING_VIEWBOX_WIDTH } from './types'

const ERASER_RADIUS = 24

const props = withDefaults(
  defineProps<{
    strokes: DrawingStroke[]
    enabled?: boolean
    tool?: DrawingMode
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
const erasing = ref(false)
const lastEraserPoint = ref<DrawingPoint | null>(null)

watch(
  () => props.strokes,
  (strokes) => {
    if (!activeId.value && !erasing.value) draft.value = strokes
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

function squaredDistanceToSegment(
  point: DrawingPoint,
  start: DrawingPoint,
  end: DrawingPoint,
): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (dx === 0 && dy === 0) {
    return (point.x - start.x) ** 2 + (point.y - start.y) ** 2
  }
  const ratio = Math.min(
    1,
    Math.max(0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx ** 2 + dy ** 2)),
  )
  const nearestX = start.x + ratio * dx
  const nearestY = start.y + ratio * dy
  return (point.x - nearestX) ** 2 + (point.y - nearestY) ** 2
}

function strokeTouchesEraser(stroke: DrawingStroke, point: DrawingPoint): boolean {
  const threshold = ERASER_RADIUS + stroke.width / 2
  if (stroke.points.length === 1) {
    return squaredDistanceToSegment(point, stroke.points[0]!, stroke.points[0]!) <= threshold ** 2
  }
  for (let index = 1; index < stroke.points.length; index++) {
    if (
      squaredDistanceToSegment(point, stroke.points[index - 1]!, stroke.points[index]!) <=
      threshold ** 2
    ) {
      return true
    }
  }
  return false
}

function eraseAtPoints(points: DrawingPoint[]): void {
  const remaining = draft.value.filter(
    (stroke) => !points.some((point) => strokeTouchesEraser(stroke, point)),
  )
  if (remaining.length === draft.value.length) return
  draft.value = remaining
  emitDraft()
}

function pointsAlongPath(start: DrawingPoint, end: DrawingPoint): DrawingPoint[] {
  const distance = Math.hypot(end.x - start.x, end.y - start.y)
  const steps = Math.max(1, Math.ceil(distance / (ERASER_RADIUS / 2)))
  return Array.from({ length: steps }, (_, index) => {
    const ratio = (index + 1) / steps
    return {
      x: start.x + (end.x - start.x) * ratio,
      y: start.y + (end.y - start.y) * ratio,
    }
  })
}

function onPointerDown(event: PointerEvent): void {
  if (!props.enabled || event.button !== 0) return
  const point = pointFromEvent(event)
  if (!point) return
  event.preventDefault()
  svgRef.value?.setPointerCapture?.(event.pointerId)
  const tool = props.tool
  if (tool === 'eraser') {
    activeId.value = null
    erasing.value = true
    lastEraserPoint.value = point
    draft.value = props.strokes
    eraseAtPoints([point])
    return
  }
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
  activeId.value = id
  draft.value = [
    ...props.strokes,
    {
      id,
      tool,
      color: props.color,
      width: props.width,
      points: [point],
    },
  ]
  emitDraft()
}

function onPointerMove(event: PointerEvent): void {
  if (erasing.value) {
    const point = pointFromEvent(event)
    if (!point) return
    event.preventDefault()
    const previous = lastEraserPoint.value ?? point
    eraseAtPoints(pointsAlongPath(previous, point))
    lastEraserPoint.value = point
    return
  }
  if (!activeId.value) return
  const point = pointFromEvent(event)
  if (!point) return
  event.preventDefault()
  draft.value = draft.value.map((stroke) =>
    stroke.id === activeId.value ? { ...stroke, points: [...stroke.points, point] } : stroke,
  )
  emitDraft()
}

function finishInteraction(event: PointerEvent): void {
  if (!activeId.value && !erasing.value) return
  svgRef.value?.releasePointerCapture?.(event.pointerId)
  const wasDrawing = activeId.value !== null
  activeId.value = null
  erasing.value = false
  lastEraserPoint.value = null
  if (wasDrawing) emitDraft()
}

function points(stroke: DrawingStroke): string {
  return stroke.points.map((point) => `${point.x},${point.y}`).join(' ')
}
</script>

<template>
  <svg
    ref="svgRef"
    class="drawing-layer"
    :class="[{ 'is-enabled': enabled }, `tool-${tool}`]"
    :viewBox="`0 0 ${DRAWING_VIEWBOX_WIDTH} ${DRAWING_VIEWBOX_HEIGHT}`"
    preserveAspectRatio="none"
    aria-hidden="true"
    data-drawing-layer
    @pointerdown.stop="onPointerDown"
    @pointermove.stop="onPointerMove"
    @pointerup.stop="finishInteraction"
    @pointercancel.stop="finishInteraction"
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

.drawing-layer.is-enabled.tool-eraser {
  cursor: cell;
}

.stroke-highlighter {
  mix-blend-mode: multiply;
}
</style>
