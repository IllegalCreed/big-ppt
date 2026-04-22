---
layout: none
class: image-content-slide
---

<div class="content-root">
  <!-- 顶部红色标题 -->
  <h1 class="content-title">{{标题}}</h1>

  <!-- 图文主体 -->
  <div class="image-content-body">
    <!-- 左侧图片 -->
    <div class="image-wrap">
      <img src="{{图片路径}}" class="content-image" />
    </div>

    <!-- 右侧文字 -->
    <div class="text-wrap">
      <h2 class="text-title">{{副标题}}</h2>
      <div class="text-body">
        {{正文}}
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

/* ── 图文主体 ── */
.image-content-body {
  margin-top: 48px;
  display: flex;
  align-items: center;
  gap: 48px;
}

.image-wrap {
  flex: 0 0 45%;
  aspect-ratio: 4 / 3;
  background: #f5f5f5;
  border: 4px solid var(--c-brand);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.content-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.text-wrap {
  flex: 1;
  min-width: 0;
}

.text-title {
  color: var(--c-brand);
  font-size: 30px;
  font-weight: 700;
  letter-spacing: 2px;
  margin: 0 0 20px 0;
  padding-bottom: 12px;
  border-bottom: 2px solid var(--c-brand);
}

.text-body {
  color: #333333;
  font-size: 20px;
  line-height: 1.8;
}
</style>
