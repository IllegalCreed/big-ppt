---
theme: seriph
title: 述职报告 - 2025年总结及2026年工作计划
layout: none
class: cover-slide
transition: slide-left
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
      <h1>述职报告（员工）</h1>
      <h2>2025年总结及2026年工作计划</h2>
    </div>
  </div>

  <!-- 底部汇报信息 -->
  <div class="info-area">
    <p class="info-line">汇报人：张旭</p>
    <p class="info-line">时&emsp;间：2026/1/16</p>
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
  margin-left:40px;
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

---
layout: none
---

<div class="toc-root">
  <!-- 左侧红色色块 -->
  <div class="toc-left-block">
    <div class="toc-left-texture"></div>
    <!-- 十字线 -->
    <div class="cross-h"></div>
    <div class="cross-v"></div>
    <!-- 左上：目录 -->
    <div class="toc-zh">目<br/>录</div>
    <!-- 右下：CONTENTS -->
    <div class="toc-en">CONTENTS</div>
  </div>

  <!-- 红色竖分割线 -->
  <div class="toc-divider"></div>

  <!-- 右侧目录 -->
  <div class="toc-right">
    <div class="toc-item active">
      <span class="toc-num">1</span>
      <span class="toc-label">个人基本情况说明</span>
    </div>
    <div class="toc-item inactive">
      <span class="toc-num">2</span>
      <span class="toc-label">2025年度工作总结</span>
    </div>
    <div class="toc-item inactive">
      <span class="toc-num">3</span>
      <span class="toc-label">2026年工作计划</span>
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

---
layout: default
---

# 个人基本情况说明

- **姓名**：张旭
- **部门**：XX部门
- **岗位**：XX岗位
- **入职时间**：20XX年X月

---
layout: none
---

<div class="toc-root">
  <div class="toc-left-block">
    <div class="toc-left-texture"></div>
    <div class="cross-h"></div>
    <div class="cross-v"></div>
    <div class="toc-zh">目<br/>录</div>
    <div class="toc-en">CONTENTS</div>
  </div>
  <div class="toc-divider"></div>
  <div class="toc-right">
    <div class="toc-item inactive">
      <span class="toc-num">1</span>
      <span class="toc-label">个人基本情况说明</span>
    </div>
    <div class="toc-item active">
      <span class="toc-num">2</span>
      <span class="toc-label">2025年度工作总结</span>
    </div>
    <div class="toc-item inactive">
      <span class="toc-num">3</span>
      <span class="toc-label">2026年工作计划</span>
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
.toc-divider {
  width: 3px;
  align-self: center;
  height: 350px;
  background: #d00d14;
  flex-shrink: 0;
}
.toc-right {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding-left: 36px;
  gap: 30px;
}
.toc-item {
  display: flex;
  align-items: center;
  border: 2px solid #d00d14;
}
.toc-item.inactive {
  opacity: 0.2;
  border-color: rgba(208, 13, 20, 0.4);
}
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
.toc-label {
  flex: 1;
  font-size: 22px;
  font-weight: 600;
  color: #333;
  letter-spacing: 2px;
  padding: 10px 16px;
}
</style>

---
layout: default
---

# 2025 年度工作总结

本年度围绕业务目标，重点推进了以下几个方面：

- **产品迭代**：完成 3 个核心功能模块上线
- **团队协作**：主导 2 次跨部门项目
- **技术沉淀**：输出 5 篇技术文档

---
layout: none
---

<div class="toc-root">
  <div class="toc-left-block">
    <div class="toc-left-texture"></div>
    <div class="cross-h"></div>
    <div class="cross-v"></div>
    <div class="toc-zh">目<br/>录</div>
    <div class="toc-en">CONTENTS</div>
  </div>
  <div class="toc-divider"></div>
  <div class="toc-right">
    <div class="toc-item inactive">
      <span class="toc-num">1</span>
      <span class="toc-label">个人基本情况说明</span>
    </div>
    <div class="toc-item inactive">
      <span class="toc-num">2</span>
      <span class="toc-label">2025年度工作总结</span>
    </div>
    <div class="toc-item active">
      <span class="toc-num">3</span>
      <span class="toc-label">2026年工作计划</span>
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
.toc-divider {
  width: 3px;
  align-self: center;
  height: 350px;
  background: #d00d14;
  flex-shrink: 0;
}
.toc-right {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding-left: 36px;
  gap: 30px;
}
.toc-item {
  display: flex;
  align-items: center;
  border: 2px solid #d00d14;
}
.toc-item.inactive {
  opacity: 0.2;
  border-color: rgba(208, 13, 20, 0.4);
}
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
.toc-label {
  flex: 1;
  font-size: 22px;
  font-weight: 600;
  color: #333;
  letter-spacing: 2px;
  padding: 10px 16px;
}
</style>

---
layout: default
---

# 2026 年工作计划

- **目标一**：持续推进核心业务优化
- **目标二**：加强团队建设与培训
- **目标三**：拓展新业务方向

---
layout: center
class: text-center
---

# 感谢聆听

期待您的指导与反馈
