---
layout: none
class: toc-slide
---

<div class="toc-root">
  <!-- 左侧红色色块 -->
  <div class="toc-left-block">
    <div class="toc-left-texture"></div>
    <div class="cross-h"></div>
    <div class="cross-v"></div>
    <div class="toc-zh">目<br/>录</div>
    <div class="toc-en">CONTENTS</div>
  </div>

  <!-- 红色竖分割线 -->
  <div class="toc-divider"></div>

  <!-- 右侧目录列表 -->
  <div class="toc-right">
    <div class="toc-item active">
      <span class="toc-num">1</span>
      <span class="toc-label">{{章节1}}</span>
    </div>
    <div class="toc-item inactive">
      <span class="toc-num">2</span>
      <span class="toc-label">{{章节2}}</span>
    </div>
    <div class="toc-item inactive">
      <span class="toc-num">3</span>
      <span class="toc-label">{{章节3}}</span>
    </div>
  </div>
</div>

<style>
.toc-root {
  position: absolute;
  inset: 0;
  background: #ffffff;
  overflow: hidden;
  display: flex;
  align-items: center;
  padding: 40px 48px;
  box-sizing: border-box;
  gap: 20px;
  font-family: "Microsoft YaHei", "微软雅黑", sans-serif;
}

/* ── 左侧红色色块 ── */
.toc-left-block {
  position: relative;
  width: 350px;
  height: 350px;
  flex-shrink: 0;
  background: linear-gradient(180deg, #d00d14 0%, #c00b11 60%, #a8090e 100%);
  overflow: hidden;
}

.toc-left-texture {
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

/* 十字分割线 */
.cross-h {
  position: absolute;
  top: 90%;
  left: 30%;
  right: 10%;
  height: 1px;
  background: #ffffff;
}
.cross-v {
  position: absolute;
  left: 45%;
  top: 70%;
  bottom: 2%;
  width: 1px;
  background: #ffffff;
}

/* 左上"目录" */
.toc-zh {
  position: absolute;
  top: 48%;
  left: 25%;
  color: #ffffff;
  font-size: 60px;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: 4px;
  z-index: 2;
}

/* 右下"CONTENTS" */
.toc-en {
  position: absolute;
  bottom: 12%;
  left: 50%;
  color: #ffffff;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 3px;
  z-index: 2;
}

/* ── 红色竖分割线 ── */
.toc-divider {
  width: 3px;
  align-self: center;
  height: 350px;
  background: #d00d14;
  flex-shrink: 0;
}

/* ── 右侧目录列表 ── */
.toc-right {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding-left: 36px;
  gap: 30px;
}

/* 共用条目样式 */
.toc-item {
  display: flex;
  align-items: center;
  border: 2px solid #d00d14;
}

.toc-item.inactive {
  opacity: 0.2;
  border-color: rgba(208, 13, 20, 0.4);
}

/* 序号方块 */
.toc-num {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 60px;
  height: 60px;
  font-size: 20px;
  font-weight: 700;
  color: #ffffff;
  background: #d00d14;
  flex-shrink: 0;
}

/* 标签文字 */
.toc-label {
  flex: 1;
  font-size: 22px;
  font-weight: 600;
  color: #333;
  letter-spacing: 2px;
  padding: 10px 16px;
}
</style>
