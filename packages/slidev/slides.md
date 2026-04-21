---
theme: seriph
title: 2026年Q1技术团队OKR共识会
transition: slide-left
layout: none
class: cover-slide
---

<div class="cover-root">
  <div class="logo-area">
    <img src="/templates/company-standard/logo-mark.png" class="logo-mark" />
    <img src="/templates/company-standard/logo-text.png" class="logo-text" />
  </div>
  <div class="title-block">
    <div class="title-texture"></div>
    <div class="title-content">
      <h1>2026 年 Q1 技术团队</h1>
      <h2>OKR 共识会</h2>
    </div>
  </div>
  <div class="info-area">
    <p class="info-line">汇报人：技术部</p>
    <p class="info-line">时&emsp;间：2026/01/15</p>
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
.title-block {
  position: relative;
  padding: 32px 0;
  background: linear-gradient(180deg, #d00d14 0%, #c00b11 60%, #a8090e 100%);
  overflow: hidden;
}
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

---
layout: none
class: toc-slide
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
    <div class="toc-item active">
      <span class="toc-num">1</span>
      <span class="toc-label">Q1 关键目标</span>
    </div>
    <div class="toc-item active">
      <span class="toc-num">2</span>
      <span class="toc-label">数据背景</span>
    </div>
    <div class="toc-item active">
      <span class="toc-num">3</span>
      <span class="toc-label">重点项目</span>
    </div>
    <div class="toc-item active">
      <span class="toc-num">4</span>
      <span class="toc-label">风险与依赖</span>
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
class: toc-slide
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
    <div class="toc-item active">
      <span class="toc-num">1</span>
      <span class="toc-label">Q1 关键目标</span>
    </div>
    <div class="toc-item inactive">
      <span class="toc-num">2</span>
      <span class="toc-label">数据背景</span>
    </div>
    <div class="toc-item inactive">
      <span class="toc-num">3</span>
      <span class="toc-label">重点项目</span>
    </div>
    <div class="toc-item inactive">
      <span class="toc-num">4</span>
      <span class="toc-label">风险与依赖</span>
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
class: two-col-slide
---

<div class="content-root">
  <h1 class="content-title">Q1 关键目标</h1>
  <div class="two-col-body">
    <div class="col col-left">
      <h2 class="col-title">业务目标</h2>
      <div class="col-content">
        <p>● 营收增长 20%</p>
        <p>● 客户留存率 ≥ 92%</p>
        <p>● 新签企业客户 50 家</p>
      </div>
    </div>
    <div class="col-divider"></div>
    <div class="col col-right">
      <h2 class="col-title">技术目标</h2>
      <div class="col-content">
        <p>● P99 延迟 &lt; 200ms</p>
        <p>● 系统可用性 ≥ 99.95%</p>
        <p>● 日均部署 ≥ 2 次</p>
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
.col-content p {
  margin: 4px 0;
}
</style>

---
layout: none
class: data-slide
---

<div class="content-root">
  <h1 class="content-title">数据背景</h1>
  <div class="data-body">
    <div class="chart-wrap">
      <BarChart
        :labels="['2025 Q1', '2025 Q2', '2025 Q3', '2025 Q4']"
        :values="[120, 145, 168, 196]"
        label="季度交付故事点"
      />
    </div>
    <div class="metrics-wrap">
      <div class="metric-card">
        <div class="metric-value">629<span class="metric-unit">点</span></div>
        <div class="metric-label">年度交付总量</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">+63<span class="metric-unit">%</span></div>
        <div class="metric-label">Q4 较 Q1 增幅</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">99.97<span class="metric-unit">%</span></div>
        <div class="metric-label">年度系统可用性</div>
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
class: image-content-slide
---

<div class="content-root">
  <h1 class="content-title">重点项目介绍</h1>
  <div class="image-content-body">
    <div class="image-wrap">
      <img src="https://placehold.co/800x600/d00d14/ffffff?text=网关架构图" class="content-image" />
    </div>
    <div class="text-wrap">
      <h2 class="text-title">统一网关升级</h2>
      <div class="text-body">
        <p>将现有 API 网关从自研方案迁移至云原生架构，支撑 Q2 起 3 倍流量增长预期。</p>
        <p>一期完成核心路由切换；二期接入限流与可观测能力。</p>
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
  border: 4px solid #d00d14;
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
.text-body p {
  margin: 6px 0;
}
</style>

---
layout: none
class: content-slide
---

<div class="content-root">
  <h1 class="content-title">风险与依赖</h1>
  <div class="content-body">
    <p><strong>风险</strong></p>
    <p>● 核心服务迁移期间可能出现性能波动</p>
    <p>● 第三方供应商 API 变更可能影响交付节奏</p>
    <p style="margin-top: 24px;"><strong>依赖</strong></p>
    <p>● 基础设施团队需 2 月底前完成 K8s 集群升级</p>
    <p>● 产品侧需 1 月底前确认网关路由规则</p>
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
.content-body p {
  margin: 4px 0;
}
</style>

---
layout: none
class: back-cover-slide
---

<div class="back-cover-root">
  <div class="ending-block">
    <div class="ending-texture"></div>
    <div class="ending-content">
      <h1>汇报完毕，谢谢！</h1>
    </div>
  </div>
  <div class="footer-area">
    <div class="footer-logo">
      <img src="/templates/company-standard/logo-mark.png" class="footer-mark" />
      <img src="/templates/company-standard/logo-text.png" class="footer-text" />
    </div>
    <p class="footer-date">2026/01/15</p>
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