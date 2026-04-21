---
layout: none
class: cover-slide
---

<div class="cover-root">
  <!-- 右上角: mark + 公司名 -->
  <div class="logo-area">
    <img src="/templates/company-standard/logo-mark.png" class="logo-mark" />
    <img src="/templates/company-standard/logo-text.png" class="logo-text" />
  </div>

  <!-- 中央红色标题区 -->
  <div class="title-block">
    <div class="title-texture"></div>
    <div class="title-content">
      <h1>{{主标题}}</h1>
      <h2>{{副标题}}</h2>
    </div>
  </div>

  <!-- 底部汇报信息 -->
  <div class="info-area">
    <p class="info-line">汇报人：{{汇报人}}</p>
    <p class="info-line">时&emsp;间：{{日期}}</p>
  </div>
</div>

<style>
.cover-root {
  position: absolute;
  inset: 0;
  background: #ffffff;
  overflow: hidden;
  padding: 36px 48px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: center;
  font-family: "Microsoft YaHei", "微软雅黑", sans-serif;
}

/* ── 右上角 logo ── */
.logo-area {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-bottom: 20px;
}
.logo-mark {
  height: 44px;
  filter: invert(87%) sepia(98%) saturate(4811%) hue-rotate(352deg) brightness(82%) contrast(100%);
}
.logo-text {
  height: 44px;
  filter: brightness(0);
}

/* ── 中央红色标题区 ── */
.title-block {
  position: relative;
  padding: 32px 0;
  background: linear-gradient(180deg, #d00d14 0%, #c00b11 60%, #a8090e 100%);
  overflow: hidden;
}

/* mark 纹理叠加 —— 单个大图拉伸 */
.title-texture {
  position: absolute;
  inset: 0;
  background-image: url('/templates/company-standard/logo-mark.png');
  background-repeat: no-repeat;
  background-size: 100% 100%;
  background-position: center;
  opacity: 0.1;
  mix-blend-mode: screen;
  pointer-events: none;
}

/* 标题文字 */
.title-content {
  position: relative;
  z-index: 2;
  text-align: center;
}
.title-content h1 {
  color: #ffffff;
  font-size: 52px;
  font-weight: 700;
  letter-spacing: 4px;
  margin: 0;
  line-height: 1.6;
}
.title-content h2 {
  color: #ffffff;
  font-size: 46px;
  font-weight: 600;
  letter-spacing: 3px;
  margin: 0;
  line-height: 1.6;
}

/* ── 底部汇报信息 ── */
.info-area {
  margin-top: 20px;
  margin-left: 40px;
  color: #333333;
  font-size: 20px;
  font-weight: bold;
  letter-spacing: 1px;
}
.info-line {
  margin: 2px 0;
  line-height: 1.5;
}
</style>
