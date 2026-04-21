---
layout: none
class: data-slide
---

<div class="content-root">
  <!-- 顶部红色标题 -->
  <h1 class="content-title">{{标题}}</h1>

  <!-- 数据主体：左侧图表 + 右侧关键指标 -->
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

/* ── 数据主体 ── */
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
