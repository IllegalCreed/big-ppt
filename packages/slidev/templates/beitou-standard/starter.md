---
theme: seriph
title: 新建幻灯片
transition: slide-left
routerMode: hash
layout: beitou-cover
mainTitle: 请填写标题
subtitle: 请填写副标题
reporter: 请填写部门
date: YYYY/MM/DD
---

---
layout: beitou-toc
items: ["背景介绍", "数据概览", "对比分析"]
---

---
layout: beitou-section-title
chapterNumber: 1
chapterTitle: 数据概览
---

---
layout: beitou-content
heading: 请填写页标题
---

在左侧对话框告诉 AI 想要什么内容，AI 会基于模板和公共组件帮你生成。

<EqualSplit :count="2">
<template #slot1>

**使用示例**

- "做一份 Q1 业务汇报，4 页"
- "加一页两栏对比研发与市场"
- "把第 3 页的标题改成 OKR 回顾"

</template>
<template #slot2>

**可用组件**

- 栅格类：EqualSplit / OneVsThree / NineGrid / 田字格
- 装饰类：PetalFour / ProcessFlow
- 内容块：MetricCard / Quote / BarChart / LineChart

</template>
</EqualSplit>

---
layout: beitou-back-cover
message: 谢谢观看
---
