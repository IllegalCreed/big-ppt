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
  font-family: "Microsoft YaHei", "微软雅黑", sans-serif;
}

/* ── 顶部红色标题 ── */
.content-title {
  color: #d00d14;
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
