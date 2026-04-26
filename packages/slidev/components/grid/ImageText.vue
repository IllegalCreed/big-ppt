<script setup lang="ts">
/**
 * 公共栅格组件：图文左右（45 / 55）。
 *
 * 图片在一侧，文字在另一侧；direction 控制图在左还是右。
 * 边框颜色读 `--ld-color-brand-primary`，宽度按 imageBorder 切 token。
 */
const props = defineProps<{
  /** 图片 src（必填） */
  image: string
  /** 图片描述（默认空） */
  alt?: string
  /** 边框宽度档位；默认 'thick' */
  imageBorder?: 'none' | 'thin' | 'thick'
  /** 图片在左还是右；默认 'image-left' */
  direction?: 'image-left' | 'image-right'
}>()

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
      <img :src="image" :alt="alt ?? ''" class="ld-image" />
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
