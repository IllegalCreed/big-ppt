# `--ld-*` 设计 Token 规范

> Phase 7.5A 落定。这是 Lumideck 模板系统**第二层公共组件库**对模板的契约接口——所有公共组件（栅格 / 装饰 / 内容块）只读 `--ld-*` token，**不**读模板私有的 `--bt-*` / `--jyd-*`。模板通过在自己的 `tokens.css` 中给 `--ld-*` 赋值来配置外观。
>
> 模板私有 token（`--bt-*` / `--jyd-*`）保留，**仅供模板自己的 layer-1 layout（cover / end / toc / section-title / content）的独有装饰**使用，不对外暴露。

## 心智模型

```
┌─ Layer 2 公共组件（跨模板共用） ─┐  只读 --ld-*
│  栅格 / 装饰 / 内容块            │
└──────────────────────────────────┘
              ↑ 配色
┌─ 模板 tokens.css ───────────────┐
│  --ld-color-brand-primary:       │
│      var(--bt-brand);            │  把模板内部值映射到 --ld-* 契约
│  --ld-font-family-brand:         │
│      var(--bt-ff-brand);         │
│  ...                             │
└──────────────────────────────────┘
              ↑ 模板私有
┌─ Layer 1 模板独有 layout ────────┐  读 --bt-* / --jyd-* 也读 --ld-*
│  beitou-cover / beitou-toc / ... │
└──────────────────────────────────┘
```

## 4 大类 26 项 token

### Colors（13 项）

| Token                          | 语义                                               | 默认值参考                                                       | 谁在用                                 |
| ------------------------------ | -------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------- |
| `--ld-color-brand-primary`     | 品牌主色（标题 / 边框 / 强调）                     | beitou: `#d00d14` / jingyeda: `#003da5`                          | 栅格分隔线 / 装饰几何描边 / 内容块强调 |
| `--ld-color-brand-primary-deep`| 主色深色变体（hover / 阴影 / 强对比）              | beitou: `#a8090e` / jingyeda: `#002a78`                          | 装饰组件深色描边、二级强调             |
| `--ld-color-brand-accent`      | 辅色（双主色品牌的第二色；单主色品牌可同 primary） | beitou: 同 primary / jingyeda: `#8fc31f`                         | 装饰组件辅色块 / 第二品牌色装饰        |
| `--ld-color-fg-primary`        | 主文字色                                           | beitou: `#333333` / jingyeda: `#1a1a1a`                          | 正文 / 标题文字                        |
| `--ld-color-fg-muted`          | 次要文字色（注释 / 标签 / 辅助说明）               | `#666666`                                                        | Table plain 边框 / 图表轴标签          |
| `--ld-color-bg-page`           | 页面背景                                           | `#ffffff`                                                        | layout 容器底色                        |
| `--ld-color-bg-subtle`         | 浅灰填充背景（卡片 subtle 模式 / 区块底）          | `#f5f5f5`                                                        | MetricCard subtle / Table 斑马条       |
| `--ld-color-chart-1`           | 图表色板 1（单系列默认 / Pie 第 1 片）             | beitou: `#d00d14` / jingyeda: `#003da5`                          | BarChart / LineChart 主色 + Pie 第 1 片 |
| `--ld-color-chart-1-fill`      | chart-1 的 alpha 填充版                            | beitou: `rgba(208,13,20,0.85)` / jingyeda: `rgba(0,61,165,0.85)` | BarChart 柱填充 / LineChart 区域填充   |
| `--ld-color-chart-2`           | 图表色板 2                                         | beitou: `#f59e0b` / jingyeda: `#8fc31f`                          | Pie 第 2 片                            |
| `--ld-color-chart-3`           | 图表色板 3                                         | beitou: `#2a9d8f` / jingyeda: `#f59e0b`                          | Pie 第 3 片                            |
| `--ld-color-chart-4`           | 图表色板 4                                         | beitou: `#6366f1` / jingyeda: `#e76f51`                          | Pie 第 4 片                            |
| `--ld-color-chart-5`           | 图表色板 5（中性兜底）                             | `#94a3b8`                                                        | Pie 第 5+ 片                           |

> **图表色板设计原则**：第 1 色锚定品牌主色让单系列图保持品牌识别；第 2-4 色错峰异色（warm/cool 互补）保证多分片区分度；第 5 色固定中性灰兜底超出预设色阶的分片。模板可在 `tokens.css` 自定义五色组合，公共组件不感知差异。

### Fonts（7 项）

| Token                      | 语义                                           | 默认值参考                                   | 谁在用                                     |
| -------------------------- | ---------------------------------------------- | -------------------------------------------- | ------------------------------------------ |
| `--ld-font-family-brand`   | 品牌字体（标题 / 正文）                        | beitou: 雅黑系 / jingyeda: 仿宋系            | 标题 / 正文                                |
| `--ld-font-family-ui`      | UI 字体（信息栏 / 标签 / chart 文字 / 小字号） | 雅黑系（jingyeda 显式区分；beitou 同 brand） | chart 轴文字 / Quote footer / 代码字体     |
| `--ld-font-size-h1`        | 一级标题字号                                   | `40px`                                       | layer-1 layout 标题 / MetricCard.value     |
| `--ld-font-size-h2`        | 二级标题字号                                   | `26px`                                       | layer-1 layout 副标题 / 装饰组件中央编号   |
| `--ld-font-size-body`      | 正文字号                                       | `20px`                                       | 正文 / 列表项 / MetricCard.label           |
| `--ld-font-weight-bold`    | 粗体字重                                       | `700`                                        | 标题 / 强调（jingyeda 仿宋系实测可降 500） |
| `--ld-font-weight-regular` | 常规字重                                       | `400`                                        | 正文                                       |

### Shapes（4 项）

| Token                     | 语义                            | 默认值参考 | 谁在用                                   |
| ------------------------- | ------------------------------- | ---------- | ---------------------------------------- |
| `--ld-radius-sm`          | 小圆角（按钮 / 标签 / 小卡片）  | `4px`      | 内容块边角 / 内联标签                    |
| `--ld-radius-md`          | 中圆角（大卡片 / panel）        | `8px`      | 大卡片 / Modal                           |
| `--ld-border-width-thin`  | 细线（描边 / 分割线）           | `1px`      | Table 行分隔线 / 弱边框                  |
| `--ld-border-width-thick` | 强调粗线（品牌色描边 / 主分隔） | `2px`      | 栅格分隔条 / 装饰组件描边 / 引文左侧粗线 |

### Shadows（2 项）

| Token            | 语义                          | 默认值参考                    | 谁在用           |
| ---------------- | ----------------------------- | ----------------------------- | ---------------- |
| `--ld-shadow-sm` | 浅阴影（卡片 hover / 轻浮层） | `0 1px 3px rgba(0,0,0,0.08)`  | MetricCard hover |
| `--ld-shadow-md` | 中阴影（modal / 强浮层）      | `0 4px 12px rgba(0,0,0,0.12)` | Modal / 强提示卡 |

## 模板实现要求

每套模板的 `tokens.css` **必须**给上述 26 项 token 都赋值（不能缺）；多余的 `--ld-*` token（不在本规范）触发 warning 但不阻断。

实现方式：可以引用模板私有 token（如 `--ld-color-brand-primary: var(--bt-brand);`）也可以直接给字面值。

校验：

```bash
pnpm validate:tokens packages/slidev/templates/<template-id>
```

校验输出：

- ✅ 所有 22 项都定义 → exit 0
- ❌ 缺任何一项 → 列缺失项 + exit 1
- ⚠️ 存在不在 spec 的 `--ld-*` token → warning（不阻断）

## 变更日志

> 增删 token 是**接口变更**，影响所有公共组件 + 所有模板；走"提案 + 评审"流程，不要随手加。

| 日期       | 变更                                                                                                              | 触发       |
| ---------- | ----------------------------------------------------------------------------------------------------------------- | ---------- |
| 2026-04-26 | 初版定稿 22 项                                                                                                    | Phase 7.5A |
| 2026-04-26 | 替换 chart-primary 双 token 为 chart-1..5 五色色板（含 chart-1-fill），共 +4 token；总数 22 → 26（colors 9 → 13） | Phase 7.5E |
