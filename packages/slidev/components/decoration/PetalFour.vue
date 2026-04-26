<script setup lang="ts">
/**
 * 公共装饰组件：花瓣 4 区。
 *
 * 7.5E 重设计（按用户参考图）：2 行 × 4 列 grid。
 *   - 第 1 / 4 列：内容区（标题胶囊 + 列表项）
 *   - 第 2 / 3 列：4 个序号 div，每个 div 一对对角 round 拼成花瓣轮廓
 *     · (1,2) bl-tr round（左下 + 右上 大圆角）
 *     · (1,3) tl-br round（左上 + 右下）
 *     · (2,2) tl-br round
 *     · (2,3) bl-tr round
 *
 * 配色：胶囊标题 + 序号 + 花瓣描边 全部读 `--ld-color-brand-primary`，跨模板自动适配。
 */
defineProps<{
  /** 4 个分区，每段 title + items（li 文字数组）；超出 4 截断、不足 4 补空 */
  sections: Array<{ title: string; items: string[] }>
}>()
</script>

<template>
  <div class="ld-petal-four">
    <!-- 第一行 -->
    <div class="ld-petal-content ld-petal-content--right">
      <div v-if="sections[0]" class="ld-petal-title">{{ sections[0]?.title }}</div>
      <ul v-if="sections[0]" class="ld-petal-list">
        <li v-for="(item, idx) in sections[0].items" :key="idx">{{ item }}</li>
      </ul>
    </div>
    <div class="ld-petal-cell ld-petal-cell--bl-tr">
      <span class="ld-petal-num">1</span>
    </div>
    <div class="ld-petal-cell ld-petal-cell--tl-br">
      <span class="ld-petal-num">2</span>
    </div>
    <div class="ld-petal-content ld-petal-content--left">
      <div v-if="sections[1]" class="ld-petal-title">{{ sections[1]?.title }}</div>
      <ul v-if="sections[1]" class="ld-petal-list">
        <li v-for="(item, idx) in sections[1].items" :key="idx">{{ item }}</li>
      </ul>
    </div>

    <!-- 第二行 -->
    <div class="ld-petal-content ld-petal-content--right">
      <div v-if="sections[2]" class="ld-petal-title">{{ sections[2]?.title }}</div>
      <ul v-if="sections[2]" class="ld-petal-list">
        <li v-for="(item, idx) in sections[2].items" :key="idx">{{ item }}</li>
      </ul>
    </div>
    <div class="ld-petal-cell ld-petal-cell--tl-br">
      <span class="ld-petal-num">3</span>
    </div>
    <div class="ld-petal-cell ld-petal-cell--bl-tr">
      <span class="ld-petal-num">4</span>
    </div>
    <div class="ld-petal-content ld-petal-content--left">
      <div v-if="sections[3]" class="ld-petal-title">{{ sections[3]?.title }}</div>
      <ul v-if="sections[3]" class="ld-petal-list">
        <li v-for="(item, idx) in sections[3].items" :key="idx">{{ item }}</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.ld-petal-four {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto minmax(0, 1fr);
  grid-template-rows: 1fr 1fr;
  align-items: center;
  justify-content: center;
  /* 中央 4 cell 上下行 align-self 形成花瓣聚拢；保留 gap 留出花心十字白空 */
  column-gap: 0.7em;
  row-gap: 0.7em;
  width: 100%;
  height: 100%;
  flex: 1;
  min-height: 0;
  font-family: var(--ld-font-family-brand);
  color: var(--ld-color-fg-primary);
  font-size: var(--ld-font-size-body);
}

/* 4 个序号方块：对角 round 拼花瓣 */
.ld-petal-cell {
  width: 7em;
  height: 7em;
  display: flex;
  align-items: center;
  justify-content: center;
  border: calc(var(--ld-border-width-thick) * 2) solid var(--ld-color-brand-primary);
  color: var(--ld-color-brand-primary);
  box-sizing: border-box;
  background: var(--ld-color-bg-page);
}

/* 上一行向底聚拢，下一行向顶聚拢 → 4 花瓣围花心 */
.ld-petal-four > .ld-petal-cell:nth-child(2),
.ld-petal-four > .ld-petal-cell:nth-child(3) {
  align-self: end;
}

.ld-petal-four > .ld-petal-cell:nth-child(6),
.ld-petal-four > .ld-petal-cell:nth-child(7) {
  align-self: start;
}

.ld-petal-num {
  font-size: 3em;
  font-weight: var(--ld-font-weight-bold);
  line-height: 1;
}

/* border-radius 顺序：top-left, top-right, bottom-right, bottom-left */
.ld-petal-cell--bl-tr {
  border-radius: 0 50% 0 50%;
}

.ld-petal-cell--tl-br {
  border-radius: 50% 0 50% 0;
}

/* 内容区：标题胶囊 + 列表 */
.ld-petal-content {
  padding: 0.4em 0;
  min-width: 0;
}

.ld-petal-content--left {
  text-align: left;
  padding-left: 0.5em;
}

.ld-petal-content--right {
  text-align: right;
  padding-right: 0.5em;
}

.ld-petal-title {
  display: inline-block;
  background: var(--ld-color-brand-primary);
  color: #ffffff;
  padding: 0.35em 1.4em;
  border-radius: 999px;
  font-weight: var(--ld-font-weight-bold);
  font-size: 1.1em;
  letter-spacing: 0.08em;
  margin-bottom: 0.5em;
}

.ld-petal-list {
  list-style: disc;
  margin: 0;
  padding: 0;
  font-size: 0.95em;
  line-height: 1.7;
  color: var(--ld-color-fg-primary);
}

.ld-petal-content--right .ld-petal-list {
  /* 右侧列：让列表也右对齐 */
  list-style-position: inside;
  padding: 0;
}

.ld-petal-content--left .ld-petal-list {
  list-style-position: outside;
  padding-left: 1.2em;
}

.ld-petal-list li {
  padding: 0.05em 0;
}
</style>
