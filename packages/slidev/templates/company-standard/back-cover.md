---
layout: none
class: back-cover-slide
---

<div class="back-cover-root">
  <!-- 中央红色结束语区 -->
  <div class="ending-block">
    <div class="ending-texture"></div>
    <div class="ending-content">
      <h1>汇报完毕，谢谢！</h1>
    </div>
  </div>

  <!-- 底部 logo + 日期 -->
  <div class="footer-area">
    <div class="footer-logo">
      <img src="/templates/company-standard/logo-mark.png" class="footer-mark" />
      <img src="/templates/company-standard/logo-text.png" class="footer-text" />
    </div>
    <p class="footer-date">{{日期}}</p>
  </div>
</div>

<style>
.back-cover-root {
  position: absolute;
  inset: 0;
  background: #ffffff;
  overflow: hidden;
  padding: 36px 48px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding-top: 120px;
  font-family: "Microsoft YaHei", "微软雅黑", sans-serif;
}

/* ── 中央红色结束语区 ── */
.ending-block {
  position: relative;
  width: 100%;
  padding: 40px 0;
  background: linear-gradient(180deg, #d00d14 0%, #c00b11 60%, #a8090e 100%);
  overflow: hidden;
}

/* mark 纹理叠加 */
.ending-texture {
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

/* 结束语文字 */
.ending-content {
  position: relative;
  z-index: 2;
  text-align: center;
}
.ending-content h1 {
  color: #ffffff;
  font-size: 52px;
  font-weight: 700;
  letter-spacing: 4px;
  margin: 0;
  line-height: 1.6;
}

/* ── 底部 logo + 日期 ── */
.footer-area {
  margin-top: 120px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.footer-logo {
  display: flex;
  align-items: center;
  gap: 10px;
}

.footer-mark {
  height: 24px;
  filter: invert(87%) sepia(98%) saturate(4811%) hue-rotate(352deg) brightness(82%) contrast(100%);
}

.footer-text {
  height: 24px;
  filter: brightness(0);
}

.footer-date {
  color: #333333;
  font-size: 20px;
  font-weight: bold;
  letter-spacing: 2px;
  margin: 0;
}
</style>
