---
layout: none
class: content-slide
---

<div class="content-root">
  <!-- 顶部红色标题 -->
  <h1 class="content-title">{{标题}}</h1>

  <!-- 正文区域 -->
  <div class="content-body">
    {{正文}}
  </div>
</div>

<style>
.content-root {
  position: absolute;
  inset: 0;
  background: #ffffff;
  overflow: hidden;
  padding: 48px 60px;
  box-sizing: border-box;
  font-family: var(--ff-brand);
}

/* ── 顶部红色标题 ── */
.content-title {
  color: var(--c-brand);
  font-size: 40px;
  font-weight: 900;
  letter-spacing: 4px;
  margin: 0;
  line-height: 1.2;
}

/* ── 正文区域 ── */
.content-body {
  margin-top: 48px;
  color: #333333;
  font-size: 22px;
  line-height: 1.8;
}
</style>
