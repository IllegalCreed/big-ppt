<script setup lang="ts">
/**
 * 公共栅格组件：图文左右（45 / 55）。
 *
 * 图片在一侧，文字在另一侧；direction 控制图在左还是右。
 * 边框颜色读 `--ld-color-brand-primary`，宽度按 imageBorder 切 token。
 */
const props = defineProps<{
  /** 图片 src（必填）；以 / 开头的绝对路径会自动加 Slidev base 前缀 */
  image: string
  /** 图片描述（默认空） */
  alt?: string
  /** 边框宽度档位；默认 'thick' */
  imageBorder?: 'none' | 'thin' | 'thick'
  /** 图片在左还是右；默认 'image-left' */
  direction?: 'image-left' | 'image-right'
}>()

/**
 * Slidev iframe 内 dev 时配了 `--base /api/slidev-preview/`，但 SFC 模板里
 * 硬编码 `<img src="/templates/...">` 不会被 vite 自动加 base，要手工拼。
 * http(s):// 外链不动；其他相对路径不动；以 / 开头的绝对路径加 base。
 */
const resolvedImage = (() => {
  const src = props.image
  if (!src) return ''
  if (/^https?:\/\//.test(src)) return src
  if (!src.startsWith('/')) return src
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '')
  return `${base}${src}`
})()

const borderWidthVar = (() => {
  switch (props.imageBorder ?? 'thick') {
    case 'none':
      return '0'
    case 'thin':
      return 'var(--ld-border-width-thin)'
    case 'thick':
    default:
      return 'var(--ld-border-width-thick)'
  }
})()
</script>

<template>
  <div class="ld-image-text" :data-direction="direction ?? 'image-left'">
    <div class="ld-image-wrap" :style="{ borderWidth: borderWidthVar }">
      <img :src="resolvedImage" :alt="alt ?? ''" class="ld-image" />
    </div>
    <div class="ld-text">
      <slot name="text" />
    </div>
  </div>
</template>

<style scoped>
.ld-image-text {
  display: grid;
  gap: 1.5em;
  width: 100%;
  height: 100%;
  flex: 1;
  min-height: 0; /* Phase 7.5E flex slot 撑满 */
  align-items: center;
  font-family: var(--ld-font-family-brand);
  color: var(--ld-color-fg-primary);
  font-size: var(--ld-font-size-body);
}

.ld-image-text[data-direction='image-left'] {
  grid-template-columns: 45fr 55fr;
}

.ld-image-text[data-direction='image-right'] {
  grid-template-columns: 55fr 45fr;
}

.ld-image-text[data-direction='image-right'] .ld-image-wrap {
  order: 2;
}

.ld-image-text[data-direction='image-right'] .ld-text {
  order: 1;
}

.ld-image-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  border-style: solid;
  border-color: var(--ld-color-brand-primary);
  border-radius: var(--ld-radius-sm);
  overflow: hidden;
}

.ld-image {
  width: 100%;
  height: auto;
  display: block;
}

.ld-text {
  min-width: 0;
}
</style>
