# 公共组件目录

> Phase 7.5 起在此登记：跨模板共享的 Vue 组件库。所有组件**只读 `--ld-*` token**（[TOKENS.md](./TOKENS.md)），不直读模板私有的 `--bt-*` / `--jyd-*`，因此切换模板时配色自动适配。
>
> 组件分三类：
>
> - **栅格类**（`grid/*.vue`）—— 决定整页区域分布；通常作为 layer-1 `content` layout 默认 slot 的根元素
> - **装饰类**（`decoration/*.vue`，7.5C-2 引入）—— 提供"美化几何骨架 + 多 slot"，配色读 token
> - **内容块类**（顶层 `*.vue`，7.5C-3 引入）—— 决定单个区域内的渲染（指标卡 / 图表 / 引文 等）

每页 frontmatter `layout:` 字段**只能**填模板独有的 5 个 layer-1 layout（cover / back-cover / toc / section-title / content）；公共组件以 Vue 标签写在 body 内，不进 frontmatter。

---

## 栅格类组件（grid）

> Phase 7.5C-1 引入。8 个种子组件覆盖最常见的页内分块需求；未来按需扩展。

### `<TwoCol>` 两栏对比

左右 50/50；中间可选分隔条。

| Prop / Slot        | 类型 / 说明                                          |
| ------------------ | ---------------------------------------------------- |
| `leftTitle?`       | string，左栏顶部标题                                 |
| `rightTitle?`      | string，右栏顶部标题                                 |
| `divider?`         | `'on' \| 'off'`，默认 `'on'`；`off` 时隐藏中间分隔条 |
| `#left` / `#right` | named slot，分别填左右内容                           |

```md
<TwoCol left-title="旧方案" right-title="新方案">
  <template #left>

- 优势 A
- 优势 B

  </template>
  <template #right>
    <MetricCard value="89" unit="%" label="留存率" />
  </template>
</TwoCol>
```

### `<ThreeCol>` 三列均分

左 / 中 / 右三段并列。中间常用于装饰组件（如 `<PetalFour>`），左右放文字 / 子组件。

| Prop / Slot                    | 类型 / 说明                                                  |
| ------------------------------ | ------------------------------------------------------------ |
| `cols?`                        | string，CSS `grid-template-columns` 值；默认 `'1fr 1fr 1fr'` |
| `#left` / `#center` / `#right` | named slot                                                   |

### `<OneLeftThreeRight>` 左主右从

左侧 1 个主元素，右侧 3 个次级元素纵向排列。适合"主标题 + 3 要点 / 主图 + 3 注解"。

| Prop / Slot                              | 类型 / 说明                                      |
| ---------------------------------------- | ------------------------------------------------ |
| `mainFr?`                                | number，主区宽度 fr 单位；默认 `1`（与右栏等宽） |
| `#main` / `#item1` / `#item2` / `#item3` | named slot                                       |

### `<OneRightThreeLeft>` 右主左从

`OneLeftThreeRight` 的镜像版（主元素在右侧）。slot 名一致：`#main` / `#item1` / `#item2` / `#item3`。

### `<OneTopThreeBottom>` 上主下从

主元素在顶部一行，下方 3 个次级元素水平排列。适合"主标题 / 引言句 + 3 阶段"。

| Prop / Slot                              | 类型 / 说明                   |
| ---------------------------------------- | ----------------------------- |
| `mainFr?`                                | number，主区行高 fr；默认 `1` |
| `#main` / `#item1` / `#item2` / `#item3` | named slot                    |

### `<TwoColumnsTwoRows>` 田字格 2×2

4 个等大 slot 排成 2 行 2 列。适合"4 维度对比 / 4 季度数据"。**注意**：装饰类组件 `<PetalFour>` 自带 4 区花瓣造型，不需要外套此栅格。

slot：`#slot1..#slot4`。

### `<NineGrid>` 九宫格 3×3

9 个等大 slot，3 行 3 列。**约束**：1080p 视口下每格约 280×180px，slot 内**仅放短文字 / 单 metric / 单图标**，避免 chart 撑爆（AI prompt 决策树会明示）。

slot：`#slot1..#slot9`。

### `<ImageText>` 图文左右

图片在一侧（默认左），文字在另一侧；图片占 45%，文字占 55%。

| Prop / Slot    | 类型 / 说明                                                                   |
| -------------- | ----------------------------------------------------------------------------- |
| `image`        | string，图片 src（必填）                                                      |
| `alt?`         | string，图片描述                                                              |
| `imageBorder?` | `'none' \| 'thin' \| 'thick'`，默认 `'thick'`；读 `--ld-border-width-*` token |
| `direction?`   | `'image-left' \| 'image-right'`，默认 `'image-left'`                          |
| `#text`        | named slot，文字内容                                                          |

```md
<ImageText image="/templates/beitou-standard/hero.png" alt="架构图" direction="image-right">
  <template #text>

## 系统架构

上层是 ...

  </template>
</ImageText>
```

---

## 装饰类组件（decoration）

> Phase 7.5C-2 引入。装饰类组件提供"美化几何骨架 + 多 slot"，**几何形状跨模板共用，配色仅靠 `--ld-*` token 自动适配**——花瓣 / 流程箭头等装饰元素在 beitou 是红色、在 jingyeda 是蓝色，几何不变。
>
> 装饰类首版 2 个种子；其他形态（CircleFour / HexThree / TimelineHorizontal / PyramidLevels / VennTwo / FlowCircular / RadialSix 等）按需扩展。每加一个新装饰：放 `decoration/<Name>.vue` + `<Name>.test.ts`；只读 `--ld-*` token；几何用 SVG `viewBox` + `preserveAspectRatio="xMidYMid meet"` 防缩放走形。

### `<PetalFour>` 花瓣 4 区

4 个椭圆花瓣中央对称排列，每片中央放 1 个 slot。常用于"4 小节方阵"——设计 / 开发 / 测试 / 文档 这种平等对比。

| Prop / Slot                               | 类型 / 说明                              |
| ----------------------------------------- | ---------------------------------------- |
| `borderWidth?`                            | `'thin' \| 'thick'`，默认 `'thick'`      |
| `#slot1` / `#slot2` / `#slot3` / `#slot4` | named slot；上 / 右 / 下 / 左 四花瓣中央 |

```vue
<PetalFour>
  <template #slot1>1</template>
  <template #slot2>2</template>
  <template #slot3>3</template>
  <template #slot4>4</template>
</PetalFour>
```

slot 内默认放编号 / 短标签；如需要长文字描述，建议外套 `<ThreeCol>`：左右两栏写说明文字，中间放 PetalFour（参考 plan 16 概念辨析示例）。

### `<ProcessFlow>` 流程箭头

N 个步骤水平排列，相邻步骤间用三角箭头连接。适合"阶段流程 / 工作流"展示。

| Prop / Slot                          | 类型 / 说明                                 |
| ------------------------------------ | ------------------------------------------- |
| `cols?`                              | number，渲染步骤数；默认 `3`，钳到 `[1, 6]` |
| `#step1` / `#step2` / ... / `#step6` | named slot；按 cols 决定渲染几个            |

```vue
<ProcessFlow :cols="4">
  <template #step1>需求确认</template>
  <template #step2>设计方案</template>
  <template #step3>开发实施</template>
  <template #step4>测试上线</template>
</ProcessFlow>
```

每个 step 是带描边的圆角矩形，slot 内可以放纯文字、`<MetricCard>`、自由 markdown 等任意内容。

---

## 内容块类组件（block）

> Phase 7.5C-3 引入。决定单个区域内的渲染（指标卡 / 图表 / 引文 / 高亮块）。配色读 `--ld-*` token。

### `<MetricCard>` 单指标卡

展示"数字 + 单位 + 标签"标准三段（如"89% 留存率"）。

| Prop       | 类型 / 说明                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| `value`    | string \| number，数值（必填）                                                                       |
| `unit?`    | string，单位                                                                                         |
| `label`    | string，标签描述（必填）                                                                             |
| `variant?` | `'fill' \| 'subtle' \| 'outline'`，默认 `'fill'`；fill 主色填充白字 / subtle 浅灰底 / outline 仅边框 |

### `<Table>` 表格

二维结构化数据展示（项目清单 / 对比矩阵 / 资源表）。表头主色填充白字 + 斑马条。

| Prop       | 类型 / 说明                                         |
| ---------- | --------------------------------------------------- |
| `headers`  | `string[]`，表头数组，必填                          |
| `rows`     | `(string \| number)[][]`，每行长度应与 headers 一致 |
| `variant?` | `'striped' \| 'plain'`，默认 `'striped'`            |

### `<Quote>` 引文

默认 slot 是引文文字；author / cite 标注来源。左侧粗竖线 + 主文字色。

| Prop / Slot | 类型 / 说明  |
| ----------- | ------------ |
| `author?`   | string，作者 |
| `cite?`     | string，来源 |
| default     | 引文文字     |

### `<BarChart>` 柱状图

数据可视化基础组件；接收 `labels` + `values` 两个数组。单系列色用 `--ld-color-chart-1` + `--ld-color-chart-1-fill`（色板第 1 色），文字读 `--ld-color-fg-*` + `--ld-font-family-ui`，无 token 注入时 fallback 中性灰。

| Prop      | 类型 / 说明                      |
| --------- | -------------------------------- |
| `labels`  | `string[]` 必填，X 轴标签        |
| `values`  | `number[]` 必填，柱状值          |
| `label?`  | string，dataset 显示名           |
| `height?` | number，容器高度（px），默认 340 |

### `<LineChart>` 折线图

接口同 `<BarChart>`；折线 / 点用 `--ld-color-chart-1`，区域填充用 `--ld-color-chart-1-fill`。

### `<PieChart>` 饼图

多分片直接消费 `--ld-color-chart-1..5` 五色色板，分片 i 取 `chart-((i % 5) + 1)`。色板由模板 tokens.css 设计，跨模板自适配。

| Prop      | 类型 / 说明                                           |
| --------- | ----------------------------------------------------- |
| `labels`  | `string[]` 必填，分片标签                             |
| `values`  | `number[]` 必填，每片数值（占比由 chart.js 自动归一） |
| `label?`  | string，dataset 显示名                                |
| `height?` | number，容器高度（px），默认 340                      |

---

## AI 使用决策树（7.5D 同步注入 system prompt）

- frontmatter `layout:` 字段：每页必填，且**只能**从 5 个 layer-1 layout 中选
- 整页要并列 / 主从 / 网格分块 → **必须**用栅格类组件包整 body（不要在 content 默认 slot 用 div 硬拆）
- 4 小节方阵 / 阶段流程等需要美化骨架 → **优先**装饰类组件（`<PetalFour>` / `<ProcessFlow>`）
- 数字 + 单位 + 标签标准结构 → **优先** `<MetricCard>`
- 图表 → **必须** `<BarChart>` / `<LineChart>`
- 引文 / 关键摘要 → **优先** `<Quote>`
- 代码块 → markdown 围栏（` ```ts ``` `），Slidev 自带 Shiki 高亮，不需要专用组件
- 段落自由叙述 / 简单列表 → **自由 markdown**，不硬塞组件
- 切模板任务时（system 调用）：仅替换 frontmatter `layout:` 前缀，不要重写公共组件 props 或 slot 内容
