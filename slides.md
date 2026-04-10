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
layout: none
---

<div class="content-root">
  <h1 class="content-title">一、个人基本情况说明</h1>
  <div class="content-body">
    <ul>
      <li><strong>姓名</strong>：张旭</li>
      <li><strong>部门</strong>：XX部门</li>
      <li><strong>岗位</strong>：XX岗位</li>
      <li><strong>入职时间</strong>：20XX年X月</li>
    </ul>
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
.content-title {
  color: #d00d14;
  font-size: 40px;
  font-weight: 900;
  letter-spacing: 4px;
  margin: 0;
  line-height: 1.2;
}
.content-body {
  margin-top: 48px;
  color: #ffffff;
  font-size: 22px;
  line-height: 1.8;
}
</style>

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
layout: none
---

<div class="content-root">
  <h1 class="content-title">二、2025 年度工作总结</h1>
  <div class="content-body">
    <p>本年度围绕业务目标，重点推进了以下几个方面：</p>
    <ul>
      <li><strong>产品迭代</strong>：完成 3 个核心功能模块上线</li>
      <li><strong>团队协作</strong>：主导 2 次跨部门项目</li>
      <li><strong>技术沉淀</strong>：输出 5 篇技术文档</li>
    </ul>
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
.content-title {
  color: #d00d14;
  font-size: 40px;
  font-weight: 900;
  letter-spacing: 4px;
  margin: 0;
  line-height: 1.2;
}
.content-body {
  margin-top: 48px;
  color: #333333;
  font-size: 22px;
  line-height: 1.8;
}
</style>

---
layout: none
---

<div class="two-col-root">
  <h1 class="content-title">亮点回顾 · 对比分析</h1>
  <div class="two-col-body">
    <div class="col">
      <h2 class="col-title">年初目标</h2>
      <div class="col-content">
        <ul>
          <li>核心模块上线 2 个</li>
          <li>跨部门协作 1 次</li>
          <li>技术文档 3 篇</li>
          <li>GMV 同比增长 20%</li>
        </ul>
      </div>
    </div>
    <div class="col-divider"></div>
    <div class="col">
      <h2 class="col-title">实际达成</h2>
      <div class="col-content">
        <ul>
          <li>核心模块上线 <strong>3 个</strong></li>
          <li>跨部门协作 <strong>2 次</strong></li>
          <li>技术文档 <strong>5 篇</strong></li>
          <li>GMV 同比增长 <strong>32%</strong></li>
        </ul>
      </div>
    </div>
  </div>
</div>

<style>
.two-col-root {
  position: absolute;
  inset: 0;
  background: #ffffff;
  overflow: hidden;
  padding: 48px 60px;
  box-sizing: border-box;
  font-family: "Microsoft YaHei", "微软雅黑", sans-serif;
}
.content-title {
  color: #d00d14;
  font-size: 40px;
  font-weight: 900;
  letter-spacing: 4px;
  margin: 0;
  line-height: 1.2;
}
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
  background: #d00d14;
  opacity: 0.5;
  align-self: stretch;
}
.col-title {
  color: #d00d14;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 2px;
  margin: 0 0 18px 0;
  padding-bottom: 10px;
  border-bottom: 2px solid #d00d14;
}
.col-content {
  color: #333333;
  font-size: 20px;
  line-height: 1.8;
}
.col-content ul {
  margin: 0;
  padding-left: 20px;
}
</style>

---
layout: none
---

<div class="img-content-root">
  <h1 class="content-title">核心项目 · 产品 A 上线</h1>
  <div class="img-content-body">
    <div class="image-wrap">
      <img src="/templates/company-standard/logo-mark.png" class="content-image" />
    </div>
    <div class="text-wrap">
      <h2 class="text-title">重点项目介绍</h2>
      <div class="text-body">
        <p>产品 A 是本年心的交付成果，历时 6 个月完成从立项到上线。</p>
        <ul>
          <li>覆盖 <strong>12 个</strong> 业务线</li>
          <li>日均调用量 <strong>50 万+</strong></li>
          <li>用户满意度 <strong>95%</strong></li>
        </ul>
      </div>
    </div>
  </div>
</div>

<style>
.img-content-root {
  position: absolute;
  inset: 0;
  background: #ffffff;
  overflow: hidden;
  padding: 48px 60px;
  box-sizing: border-box;
  font-family: "Microsoft YaHei", "微软雅黑", sans-serif;
}
.content-title {
  color: #d00d14;
  font-size: 40px;
  font-weight: 900;
  letter-spacing: 4px;
  margin: 0;
  line-height: 1.2;
}
.img-content-body {
  margin-top: 48px;
  display: flex;
  align-items: center;
  gap: 48px;
}
.image-wrap {
  flex: 0 0 45%;
  aspect-ratio: 4 / 3;
  background: #f5f5f5;
  border: 4px solid #d00d14;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.content-image {
  width: 60%;
  height: 60%;
  object-fit: contain;
  filter: invert(87%) sepia(98%) saturate(4811%) hue-rotate(352deg) brightness(82%) contrast(100%);
}
.text-wrap {
  flex: 1;
  min-width: 0;
}
.text-title {
  color: #d00d14;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: 2px;
  margin: 0 0 20px 0;
  padding-bottom: 12px;
  border-bottom: 2px solid #d00d14;
}
.text-body {
  color: #333333;
  font-size: 20px;
  line-height: 1.8;
}
.text-body ul {
  margin: 10px 0 0 0;
  padding-left: 20px;
}
</style>

---
layout: none
---

<div class="data-root">
  <h1 class="content-title">业绩数据 · 同比增长</h1>
  <div class="data-body">
    <div class="chart-wrap">
      <BarChart
        :labels="['Q1', 'Q2', 'Q3', 'Q4']"
        :values="[120, 180, 240, 310]"
        label="季度业绩（万元）"
      />
    </div>
    <div class="metrics-wrap">
      <div class="metric-card">
        <div class="metric-value">850<span class="metric-unit">万</span></div>
        <div class="metric-label">年度总业绩</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">+32<span class="metric-unit">%</span></div>
        <div class="metric-label">同比增长</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">12<span class="metric-unit">个</span></div>
        <div class="metric-label">核心项目</div>
      </div>
    </div>
  </div>
</div>

<style>
.data-root {
  position: absolute;
  inset: 0;
  background: #ffffff;
  overflow: hidden;
  padding: 48px 60px;
  box-sizing: border-box;
  font-family: "Microsoft YaHei", "微软雅黑", sans-serif;
}
.content-title {
  color: #d00d14;
  font-size: 40px;
  font-weight: 900;
  letter-spacing: 4px;
  margin: 0;
  line-height: 1.2;
}
.data-body {
  margin-top: 40px;
  display: flex;
  align-items: center;
  gap: 40px;
}
.chart-wrap {
  flex: 1;
  min-width: 0;
}
.metrics-wrap {
  flex: 0 0 240px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.metric-card {
  padding: 18px 20px;
  background: linear-gradient(180deg, #d00d14 0%, #c00b11 60%, #a8090e 100%);
  color: #ffffff;
  text-align: center;
}
.metric-value {
  font-size: 42px;
  font-weight: 900;
  line-height: 1.1;
  letter-spacing: 1px;
}
.metric-unit {
  font-size: 20px;
  font-weight: 600;
  margin-left: 4px;
}
.metric-label {
  margin-top: 6px;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 2px;
  opacity: 0.95;
}
</style>

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
layout: none
---

<div class="content-root">
  <h1 class="content-title">三、2026 年工作计划</h1>
  <div class="content-body">
    <ul>
      <li><strong>目标一</strong>：持续推进核心业务优化</li>
      <li><strong>目标二</strong>：加强团队建设与培训</li>
      <li><strong>目标三</strong>：拓展新业务方向</li>
    </ul>
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
.content-title {
  color: #d00d14;
  font-size: 40px;
  font-weight: 900;
  letter-spacing: 4px;
  margin: 0;
  line-height: 1.2;
}
.content-body {
  margin-top: 48px;
  color: #333333;
  font-size: 22px;
  line-height: 1.8;
}
</style>

---
layout: none
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
    <p class="footer-date">2026年1月</p>
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
