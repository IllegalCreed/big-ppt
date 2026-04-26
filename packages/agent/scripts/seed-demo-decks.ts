#!/usr/bin/env tsx
/**
 * Phase 7.5 完成后：在 dev 数据库种 2 个 demo deck，演示完整模板 +
 * 16 个公共组件（栅格 8 + 装饰 2 + 内容块 6 / chart 2）。
 *
 * 用法：
 *   pnpm -F @big-ppt/agent dotenv -e .env.development.local -- tsx scripts/seed-demo-decks.ts
 *
 * 行为：
 *   - 注册 / 复用 demo@lumideck.local 用户
 *   - 删除既有同 title 的旧 demo deck（幂等）
 *   - 创建 beitou-demo + jingyeda-demo 两个 deck，每条用一份精心编排的 markdown
 *   - log 输出 deck id；用户登录后即可看到
 */
import { eq, inArray } from 'drizzle-orm'
import bcrypt from 'bcrypt'
import { getDb, decks, deckVersions, users } from '../src/db/index.js'

const DEMO_EMAIL = 'demo@lumideck.local'
const DEMO_PASSWORD = 'demo123456'

const BEITOU_DEMO_CONTENT = `---
theme: seriph
title: 北投模板演示
transition: slide-left
routerMode: hash
layout: beitou-cover
mainTitle: Lumideck 公共组件库
subtitle: 北投模板演示 deck
reporter: 演示团队
date: 2026/04/26
---

---
layout: beitou-toc
items: ["栅格类组件（8 个）", "装饰类组件（2 种子）", "内容块组件（6 个）"]
---

---
layout: beitou-section-title
chapterNumber: 1
chapterTitle: 栅格类组件
---

---
layout: beitou-content
heading: TwoCol 两栏对比
---

<TwoCol left-title="旧方案" right-title="新方案">
<template #left>

- 静态模板，每套重抄一份内容部件
- 切换模板需 LLM 整页重写
- 字节级一致难保证

</template>
<template #right>

- 公共组件库 + token 自适应
- 切换走 deterministic 字符串替换
- 字节级一致 by construction

</template>
</TwoCol>

---
layout: beitou-content
heading: ThreeCol 三列均分
---

<ThreeCol>
<template #left>

**前期准备**

- 需求确认
- 资源盘点
- 排期对齐

</template>
<template #center>

**执行迭代**

- 3 周节奏
- 双周复盘
- 持续交付

</template>
<template #right>

**后期跟进**

- 发布上线
- 数据回流
- 复盘评估

</template>
</ThreeCol>

---
layout: beitou-content
heading: OneLeftThreeRight 主从布局
---

<OneLeftThreeRight :main-fr="1.5">
<template #main>

**核心目标**

打造 AI 演示文稿生成的"模板生态系统"基线：从硬编码单模板升级为公共组件库 + token 自适应配色。

</template>
<template #item1>
<MetricCard value="3" label="架构层数" variant="outline" />
</template>
<template #item2>
<MetricCard value="100" unit="%" label="字节级一致" variant="outline" />
</template>
<template #item3>
<MetricCard value="5" label="自由度档位" variant="outline" />
</template>
</OneLeftThreeRight>

---
layout: beitou-content
heading: TwoColumnsTwoRows 田字格 + MetricCard
---

<TwoColumnsTwoRows>
<template #slot1>
<MetricCard value="22" label="--ld-* token 总数" variant="fill" />
</template>
<template #slot2>
<MetricCard value="16" label="公共组件首版数" variant="subtle" />
</template>
<template #slot3>
<MetricCard value="473" label="单测覆盖" variant="outline" />
</template>
<template #slot4>
<MetricCard value="100" unit="%" label="字节级一致 (pure deck)" variant="fill" />
</template>
</TwoColumnsTwoRows>

---
layout: beitou-content
heading: NineGrid 九宫格（每格嵌 MetricCard）
---

<NineGrid>
<template #slot1><MetricCard value="22" label="--ld-* token" variant="outline" /></template>
<template #slot2><MetricCard value="16" label="公共组件总数" variant="outline" /></template>
<template #slot3><MetricCard value="473" label="单测覆盖" variant="outline" /></template>
<template #slot4><MetricCard value="5" label="layer-1 layout" variant="outline" /></template>
<template #slot5><MetricCard value="8" label="栅格组件" variant="fill" /></template>
<template #slot6><MetricCard value="2" label="装饰种子" variant="outline" /></template>
<template #slot7><MetricCard value="6" label="内容块" variant="outline" /></template>
<template #slot8><MetricCard value="100" unit="%" label="字节级一致" variant="outline" /></template>
<template #slot9><MetricCard value="13" label="设计抉择" variant="outline" /></template>
</NineGrid>

---
layout: beitou-content
heading: ImageText 图文左右
---

<ImageText image="/templates/beitou-standard/logo.png" alt="北投 logo" direction="image-left">
<template #text>

**北投集团汇报模板**

商务正式风格 · 暖色调

- 品牌主色 #d00d14（红）
- 字体：微软雅黑 + 仿宋
- 适合发布会 / OKR / 业务汇报

</template>
</ImageText>

---
layout: beitou-section-title
chapterNumber: 2
chapterTitle: 装饰类组件
---

---
layout: beitou-content
heading: PetalFour 花瓣 4 区
---

<PetalFour :sections='[{"title":"设计","items":["对网站进行整体改版","支持全局自定义布局"]},{"title":"开发","items":["进行新版门户开发工作","对接集团用户系统","对接业务系统单点登录"]},{"title":"测试","items":["完成三端测试用例设计","完成 300+ 自动化测试脚本"]},{"title":"文档编写","items":["测试报告","用户手册","等保材料","汇报材料"]}]' />

---
layout: beitou-content
heading: ProcessFlow 流程箭头
---

<ProcessFlow :cols="5">
<template #step1>需求确认</template>
<template #step2>方案设计</template>
<template #step3>研发实施</template>
<template #step4>测试验证</template>
<template #step5>发布上线</template>
</ProcessFlow>

---
layout: beitou-section-title
chapterNumber: 3
chapterTitle: 内容块 + 数据组件
---

---
layout: beitou-content
heading: BarChart 柱状图
---

<BarChart :labels='["Q1","Q2","Q3","Q4"]' :values='[120,180,150,210]' label="季度营收（万元）" :height="320" />

---
layout: beitou-content
heading: PieChart 饼图
---

<PieChart :labels='["Chrome","Safari","Edge","Firefox","其他"]' :values='[62,18,12,5,3]' label="浏览器份额" :height="380" />

---
layout: beitou-content
heading: Quote / 代码段
---

<TwoCol left-title="引文" right-title="代码示例">
<template #left>

<Quote author="设计抉择 #2" cite="plan 16">
装饰几何全公共，仅靠 token 切配色——花瓣造型在 jingyeda 用蓝绿色一样好看；几何形状是中性资产，配色才是模板个性。
</Quote>

</template>
<template #right>

\`\`\`ts
// AI 在 markdown body 直接写组件标签
<MetricCard
  value="89"
  unit="%"
  label="留存率"
  variant="fill"
/>
\`\`\`

</template>
</TwoCol>

---
layout: beitou-content
heading: Table 数据表格
---

<Table :headers='["指标","数值","说明"]' :rows='[["--ld-* token 数","22","colors / fonts / shapes / shadows 4 类"],["layer-1 layout","5","cover / toc / section-title / content / back-cover"],["公共组件","16","栅格 8 + 装饰 2 + 内容块 6"],["单测覆盖","473",""],["切模板","deterministic","pure deck 跳 LLM"],["设计抉择","13",""]]' />

---
layout: beitou-back-cover
message: 谢谢观看
date: 2026/04/26
---
`

const JINGYEDA_DEMO_CONTENT = `---
theme: seriph
title: 竞业达模板演示
transition: slide-left
routerMode: hash
layout: jingyeda-cover
mainTitle: Lumideck 公共组件库
subtitle: 竞业达模板演示 deck
reporter: 演示团队
department: 产品研发部
bu: 平台 BU
date: 2026/04/26
---

---
layout: jingyeda-toc
items: ["栅格类组件（8 个）", "装饰类组件（2 种子）", "内容块组件（6 个）"]
---

---
layout: jingyeda-section-title
chapterNumber: 1
chapterTitle: 栅格类组件
---

---
layout: jingyeda-content
heading: TwoCol 两栏对比
---

<TwoCol left-title="旧方案" right-title="新方案">
<template #left>

- 静态模板，每套重抄一份内容部件
- 切换模板需 LLM 整页重写
- 字节级一致难保证

</template>
<template #right>

- 公共组件库 + token 自适应
- 切换走 deterministic 字符串替换
- 字节级一致 by construction

</template>
</TwoCol>

---
layout: jingyeda-content
heading: ThreeCol 三列均分
---

<ThreeCol>
<template #left>

**前期准备**

- 需求确认
- 资源盘点
- 排期对齐

</template>
<template #center>

**执行迭代**

- 3 周节奏
- 双周复盘
- 持续交付

</template>
<template #right>

**后期跟进**

- 发布上线
- 数据回流
- 复盘评估

</template>
</ThreeCol>

---
layout: jingyeda-content
heading: OneRightThreeLeft 右主左从
---

<OneRightThreeLeft :main-fr="1.5">
<template #item1>
<MetricCard value="2" label="主色（蓝/绿）" variant="outline" />
</template>
<template #item2>
<MetricCard value="2" label="字体（仿宋/雅黑）" variant="outline" />
</template>
<template #item3>
<MetricCard value="6" label="layer-1 装饰" variant="outline" />
</template>
<template #main>

**模板核心**

竞业达汇报模板的视觉灵感来自科技公司发布会——蓝色主调 + 绿色辅助，强对比硬切色块。

</template>
</OneRightThreeLeft>

---
layout: jingyeda-content
heading: TwoColumnsTwoRows 田字格 + MetricCard
---

<TwoColumnsTwoRows>
<template #slot1>
<MetricCard value="22" label="--ld-* token 总数" variant="fill" />
</template>
<template #slot2>
<MetricCard value="16" label="公共组件首版数" variant="subtle" />
</template>
<template #slot3>
<MetricCard value="473" label="单测覆盖" variant="outline" />
</template>
<template #slot4>
<MetricCard value="100" unit="%" label="字节级一致 (pure deck)" variant="fill" />
</template>
</TwoColumnsTwoRows>

---
layout: jingyeda-content
heading: NineGrid 九宫格（每格嵌 MetricCard）
---

<NineGrid>
<template #slot1><MetricCard value="22" label="--ld-* token" variant="outline" /></template>
<template #slot2><MetricCard value="16" label="公共组件总数" variant="outline" /></template>
<template #slot3><MetricCard value="473" label="单测覆盖" variant="outline" /></template>
<template #slot4><MetricCard value="5" label="layer-1 layout" variant="outline" /></template>
<template #slot5><MetricCard value="8" label="栅格组件" variant="fill" /></template>
<template #slot6><MetricCard value="2" label="装饰种子" variant="outline" /></template>
<template #slot7><MetricCard value="6" label="内容块" variant="outline" /></template>
<template #slot8><MetricCard value="100" unit="%" label="字节级一致" variant="outline" /></template>
<template #slot9><MetricCard value="13" label="设计抉择" variant="outline" /></template>
</NineGrid>

---
layout: jingyeda-content
heading: ImageText 图文左右
---

<ImageText image="/templates/jingyeda-standard/logo.png" alt="竞业达 logo" direction="image-right">
<template #text>

**竞业达汇报模板**

商务科技 · 深色活力

- 品牌主色 #003da5（蓝）+ 辅 #8fc31f（绿）
- 字体：仿宋 + 微软雅黑双字体策略
- 适合述职 / 发布会 / 产品汇报

</template>
</ImageText>

---
layout: jingyeda-section-title
chapterNumber: 2
chapterTitle: 装饰类组件
---

---
layout: jingyeda-content
heading: PetalFour 花瓣 4 区
---

<PetalFour :sections='[{"title":"设计","items":["对网站进行整体改版","支持全局自定义布局"]},{"title":"开发","items":["进行新版门户开发工作","对接集团用户系统","对接业务系统单点登录"]},{"title":"测试","items":["完成三端测试用例设计","完成 300+ 自动化测试脚本"]},{"title":"文档编写","items":["测试报告","用户手册","等保材料","汇报材料"]}]' />

---
layout: jingyeda-content
heading: ProcessFlow 流程箭头
---

<ProcessFlow :cols="5">
<template #step1>需求确认</template>
<template #step2>方案设计</template>
<template #step3>研发实施</template>
<template #step4>测试验证</template>
<template #step5>发布上线</template>
</ProcessFlow>

---
layout: jingyeda-section-title
chapterNumber: 3
chapterTitle: 内容块 + 数据组件
---

---
layout: jingyeda-content
heading: LineChart 折线图
---

<LineChart :labels='["1月","2月","3月","4月","5月","6月"]' :values='[12,18,28,42,55,68]' label="月活用户（万）" :height="320" />

---
layout: jingyeda-content
heading: PieChart 饼图
---

<PieChart :labels='["研发","产品","设计","运营","支持"]' :values='[42,18,15,15,10]' label="人员构成" :height="380" />

---
layout: jingyeda-content
heading: Quote / 代码段
---

<TwoCol left-title="引文" right-title="代码示例">
<template #left>

<Quote author="设计抉择 #12" cite="plan 16">
AI 自由度 5 档：从纯 markdown 到 chart.js 现写到 script setup 原创组件——切模板时系统按 deck 纯度自动选 deterministic 替换或 LLM 重写。
</Quote>

</template>
<template #right>

\`\`\`vue
<!-- pure deck：仅 layer-1 + 公共组件 -->
<TwoCol left-title="A" right-title="B">
  <template #left>...</template>
  <template #right>
    <MetricCard ... />
  </template>
</TwoCol>
\`\`\`

</template>
</TwoCol>

---
layout: jingyeda-content
heading: Table 数据表格
---

<Table :headers='["指标","数值","说明"]' :rows='[["--ld-* token 数","22","colors / fonts / shapes / shadows 4 类"],["layer-1 layout","5","cover / toc / section-title / content / back-cover"],["公共组件","16","栅格 8 + 装饰 2 + 内容块 6"],["单测覆盖","473",""],["切模板","deterministic","pure deck 跳 LLM"],["双字体","仿宋 + 雅黑",""]]' />

---
layout: jingyeda-back-cover
message: 谢 谢 ！
orgZh: 演 示 团 队
orgEn: Lumideck Demo
---
`

interface DemoSpec {
  title: string
  templateId: string
  content: string
}

const DEMOS: DemoSpec[] = [
  {
    title: '[Demo] 北投模板 · 公共组件库演示',
    templateId: 'beitou-standard',
    content: BEITOU_DEMO_CONTENT,
  },
  {
    title: '[Demo] 竞业达模板 · 公共组件库演示',
    templateId: 'jingyeda-standard',
    content: JINGYEDA_DEMO_CONTENT,
  },
]

async function main() {
  console.log('\n=== Phase 7.5 完整 demo deck 种入 dev DB ===\n')
  const db = getDb()

  // 1. 准备 demo user（注册 / 复用）
  const [existingUser] = await db.select().from(users).where(eq(users.email, DEMO_EMAIL)).limit(1)
  let userId: number
  if (existingUser) {
    userId = existingUser.id
    console.log(`✓ 复用既有 demo user：${DEMO_EMAIL}（id=${userId}）`)
  } else {
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10)
    await db.insert(users).values({
      email: DEMO_EMAIL,
      passwordHash,
    })
    const [created] = await db.select().from(users).where(eq(users.email, DEMO_EMAIL)).limit(1)
    if (!created) throw new Error('user 注册后回查失败')
    userId = created.id
    console.log(`✓ 新建 demo user：${DEMO_EMAIL}（id=${userId}），密码 ${DEMO_PASSWORD}`)
  }

  // 2. 删除旧 demo deck（按 title 匹配，幂等）
  const oldDecks = await db
    .select({ id: decks.id, title: decks.title })
    .from(decks)
    .where(eq(decks.userId, userId))
  const oldDemoDeckIds = oldDecks
    .filter((d) => DEMOS.some((demo) => demo.title === d.title))
    .map((d) => d.id)
  if (oldDemoDeckIds.length > 0) {
    // 先删 versions 再删 decks（FK cascade 应 handle 但显式更稳）
    await db.delete(deckVersions).where(inArray(deckVersions.deckId, oldDemoDeckIds))
    await db.delete(decks).where(inArray(decks.id, oldDemoDeckIds))
    console.log(`✓ 删除 ${oldDemoDeckIds.length} 个旧 demo deck（id=${oldDemoDeckIds.join(', ')}）`)
  }

  // 3. 插入 2 个新 demo deck
  for (const demo of DEMOS) {
    await db.insert(decks).values({
      userId,
      title: demo.title,
      templateId: demo.templateId,
    })
    const [createdDeck] = await db
      .select()
      .from(decks)
      .where(eq(decks.userId, userId))
      .orderBy(decks.id)
    // 取最新插入的（按 id desc）
    const allUserDecks = await db
      .select({ id: decks.id, title: decks.title })
      .from(decks)
      .where(eq(decks.userId, userId))
    const ourDeck = allUserDecks.find((d) => d.title === demo.title)
    if (!ourDeck) throw new Error(`deck 创建后回查失败：${demo.title}`)
    void createdDeck

    await db.insert(deckVersions).values({
      deckId: ourDeck.id,
      content: demo.content,
      message: 'Phase 7.5 demo seed',
      authorId: userId,
      templateId: demo.templateId,
    })
    const versions = await db
      .select({ id: deckVersions.id })
      .from(deckVersions)
      .where(eq(deckVersions.deckId, ourDeck.id))
    const versionId = Math.max(...versions.map((v) => v.id))
    await db.update(decks).set({ currentVersionId: versionId }).where(eq(decks.id, ourDeck.id))

    console.log(`✓ 创建 deck #${ourDeck.id}（${demo.templateId}）"${demo.title}"`)
  }

  console.log('\n✅ 完成。\n')
  console.log('登录信息：')
  console.log(`  email：    ${DEMO_EMAIL}`)
  console.log(`  password： ${DEMO_PASSWORD}`)
  console.log('\n启动 dev：')
  console.log('  pnpm dev   # creator :3030 + agent :4000 + slidev :3031')
  console.log('\n用浏览器访问 http://localhost:3030 登录后即可在 deck 列表看到两个 demo。\n')
}

main()
  .catch((err) => {
    console.error('seed 失败：', err)
    process.exit(1)
  })
  .then(() => process.exit(0))
