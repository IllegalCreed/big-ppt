---
layout: none
class: two-col-slide
---

<div class="content-root">
  <!-- 顶部红色标题 -->
  <h1 class="content-title">{{标题}}</h1>

  <!-- 两栏正文 -->
  <div class="two-col-body">
    <div class="col col-left">
      <h2 class="col-title">{{左栏标题}}</h2>
      <div class="col-content">
        {{左栏内容}}
      </div>
    </div>
    <div class="col-divider"></div>
    <div class="col col-right">
      <h2 class="col-title">{{右栏标题}}</h2>
      <div class="col-content">
        {{右栏内容}}
      </div>
    </div>
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

/* ── 两栏布局 ── */
.two-col-body {
  margin-top: 48px;
  display: flex;
  align-items: stretch;
  gap: 40px;
}

.col {
  flex: 1;
  min-width: 0;
}

.col-divider {
  width: 2px;
  background: var(--c-brand);
  opacity: 0.5;
  align-self: stretch;
}

.col-title {
  color: var(--c-brand);
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 2px;
  margin: 0 0 18px 0;
  padding-bottom: 10px;
  border-bottom: 2px solid var(--c-brand);
}

.col-content {
  color: #333333;
  font-size: 20px;
  line-height: 1.8;
}
</style>
