---
theme: seriph
title: 2026年Q1技术团队OKR共识会
transition: slide-left
layout: cover
mainTitle: 2026 年 Q1 工程组汇报
subtitle: OKR 共识会
reporter: 技术部
date: 2025/07/18
---

---
layout: toc
items: ["Q1 关键目标","数据背景","重点项目","风险与依赖"]
---

---
layout: two-col
items: ["Q1 关键目标","数据背景","重点项目","风险与依赖"]
active: 1
heading: Q1 关键目标
leftTitle: 业务目标
rightTitle: 技术目标
---

::left::

● 营收增长 20%

● 客户留存率 ≥ 92%

● 新签企业客户 50 家

::right::

● P99 延迟 &lt; 200ms

● 系统可用性 ≥ 99.95%

● 日均部署 ≥ 2 次

---
layout: two-col
heading: 方法论
leftTitle: OKR 制定原则
rightTitle: 执行节奏
---

::left::

● 目标可衡量，关键结果可量化

● 自上而下分解，自下而上对齐

● 季度复盘，动态调整优先级

::right::

● 周站会追踪进展

● 双周 Review 识别阻塞

● 季末打分并沉淀改进项

---
layout: data
heading: 数据背景
metrics: [{"value":"629","unit":"点","label":"年度交付总量"},{"value":"+63","unit":"%","label":"Q4 较 Q1 增幅"},{"value":"99.97","unit":"%","label":"年度系统可用性"}]
---

<BarChart
  :labels="['2025 Q1', '2025 Q2', '2025 Q3', '2025 Q4']"
  :values="[120, 145, 168, 196]"
  label="季度交付故事点"
/>

---
layout: image-content
heading: 重点项目介绍
image: "https://placehold.co/800x600/d00d14/ffffff?text=网关架构图"
textTitle: 统一网关升级
---

将现有 API 网关从自研方案迁移至云原生架构，支撑 Q2 起 3 倍流量增长预期。

一期完成核心路由切换；二期接入限流与可观测能力。

---
layout: back-cover
message: 汇报完毕，谢谢！
date: 2026/01/15
---

---
layout: content
heading: 风险与依赖
---

**风险**

● 核心服务迁移期间可能出现性能波动

● 第三方供应商 API 变更可能影响交付节奏

**依赖**

● 基础设施团队需 2 月底前完成 K8s 集群升级

● 产品侧需 1 月底前确认网关路由规则
