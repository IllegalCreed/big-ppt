# 竞业达汇报模板 - 设计规范

> 本 DESIGN.md 定义「竞业达汇报模板」的全部视觉规范。AI 生成幻灯片时必须严格遵循；layout Vue 内部实现也以此为准。

## 1. 视觉风格与氛围

**关键特征：**

- 商务正式 + 科技感
- 蓝 + 绿**双主色硬切**（非渐变）：靠色块几何切割建立识别
- 版式偏企业汇报（与 `beitou-standard` 的 editorial / warm 风格形成对照）
- 适用于业务汇报、述职述责、产品发布、年度总结

## 2. 配色方案

### 主色

| 角色     | 颜色 | Hex       | CSS 变量                   | 用途                                            |
| -------- | ---- | --------- | -------------------------- | ----------------------------------------------- |
| 主蓝     | 蓝色 | `#003DA5` | `--jyd-brand-primary`      | logo J/D · 内容页标题栏 · 封底左大块 · chart 主色 |
| 深蓝     | 深蓝 | `#002A78` | `--jyd-brand-primary-deep` | hover / 对比 / 阴影                             |
| 辅绿     | 绿色 | `#8FC31F` | `--jyd-brand-accent`       | logo Y · 标题栏装饰条 · 封底右块 · chart 辅色     |

### 前景 / 背景

| 角色   | 颜色 | Hex       | CSS 变量            | 用途           |
| ------ | ---- | --------- | ------------------- | -------------- |
| 主前景 | 近黑 | `#1A1A1A` | `--jyd-fg-primary`  | 正文 / 封面标题 |
| 弱前景 | 中灰 | `#666666` | `--jyd-fg-muted`    | 副标题 / 说明  |
| 主背景 | 白色 | `#FFFFFF` | `--jyd-bg-page`     | 页面底色       |
| 次背景 | 浅灰 | `#F5F5F5` | `--jyd-bg-subtle`   | 图片占位 / 分隔 |

### 色块使用原则

- **不使用渐变**（与 beitou 的 `linear-gradient(180deg, ...)` 形成对照）
- 蓝色块为主体（标题栏 / 封底左块），绿色块作为辅助和装饰（标题栏左侧 56px 色条 / 封底右块 / 指标卡底条）
- 白缝宽度 10-24px 作为蓝绿块之间的呼吸

## 3. 字体规范

### 字体族

- **主字体**：`Microsoft YaHei`（微软雅黑）
- **备选**：sans-serif
- CSS 变量：`--jyd-ff-brand`

### 字号层级

| 角色              | 字号 | 字重 | 用途                       |
| ----------------- | ---- | ---- | -------------------------- |
| 封面主标题        | 48px | 700  | `jingyeda-cover` mainTitle |
| 封面副标题        | 22px | 500  | `jingyeda-cover` subtitle  |
| 封底结束语        | 56px | 400  | `jingyeda-back-cover` 白字 |
| 内容页标题栏      | 28px | 600  | 各 layout 顶部蓝色栏白字   |
| 目录项            | 22px | 500  | `jingyeda-toc` label       |
| 目录序号          | 20px | 700  | `jingyeda-toc` num（圆形） |
| 两栏小标题        | 20px | 600  | `jingyeda-two-col` col-title |
| 正文              | 20px | -    | `jingyeda-content` body    |
| 指标卡 value      | 38px | 700  | `jingyeda-data` metric     |
| 指标卡 label      | 14px | -    | `jingyeda-data` metric     |
| Logo 封面尺寸     | 40px 高 | - | 右上角                    |
| Logo 水印尺寸     | 24px 高 | - | 右下角（opacity 0.85）    |

## 4. 组件样式约定

### 顶部标题栏（content / toc / two-col / data / image-content 共用）

```css
.header {
  background: var(--jyd-brand-primary);  /* 主蓝底 */
  padding: 18px 48px;
  min-height: 66px;
}
.header-accent {  /* 左侧绿色竖条 */
  position: absolute;
  top: 0; left: 0;
  width: 56px; height: 100%;
  background: var(--jyd-brand-accent);
}
.header-title {
  color: #ffffff;
  font-size: 28px;
  font-weight: 600;
  padding-left: 72px;  /* 避开绿色竖条 */
}
```

### 封底三段式色块

```
┌──────────────────────────────┐
│   白条 30% 高 (logo 右上角)   │
├──────┬────┬──────────────────┤
│      │    │                  │
│ 蓝   │白缝│  绿                │
│ 60%  │12% │  28%              │
│      │    │                  │
└──────┴────┴──────────────────┘
```

### Logo 使用

- 合并版 logo (JYD 图标 + 竞业达中文)：`/templates/jingyeda-standard/logo.png`
- **不做滤镜染色**（与 beitou 的 `--logo-red-filter` 不同）：竞业达 logo 本身是蓝+绿双色印刷色，直接使用原图
- 封面：40px 高，右上角
- 水印：24px 高，右下角，opacity 0.85

## 5. 布局原则

### 封面（`jingyeda-cover`）

三段式纵向布局：
- 上段 48px：右对齐 logo
- 中段：满宽 banner.png（自带"客户至上 科技领先"白字）
- 下段：居中大字标题 + 副标题 + 底部 2×2 字段信息栏
- 右下装饰：蓝条 (60×6) + 绿方块 (10×10) + www.jyd.com.cn 小字

### 目录（`jingyeda-toc`）

- 顶部蓝色标题栏（同 content）
- 主体：纵向列表，每项圆形编号（蓝底白字）+ 绿色竖条装饰（6×32）+ 文字
- active：编号圆外发光 4px 绿色；文字加粗变蓝
- inactive：整项 opacity 0.35

### 两栏（`jingyeda-two-col`）

- 左栏小标题 **蓝底白字**、右栏小标题 **绿底白字**（利用双主色天然做 A/B 对照语义）
- 中间绿色 2px 分隔线
- 左右内容区语义任选

### 数据（`jingyeda-data`）

- 左 chart 区（BarChart / LineChart，数据色轮 `--jyd-brand-primary` → `--jyd-brand-accent`）
- 右指标卡列：蓝底白字 value (38px) + 绿色 32×4 小条 + 灰字 label (14px)

## 6. Do's and Don'ts

### Do

- 所有视觉值走 `var(--jyd-*)`，不要硬编码 hex
- 顶栏标题统一 28px 600，左侧绿色 56px 竖条装饰
- 封底使用纯色块硬切，**不要**用渐变
- 文字/元素层级靠色彩 + 字重表达（蓝=重、绿=辅、灰=弱）

### Don't

- 不要给蓝色块加 `linear-gradient`（留给 beitou）
- 不要给 logo 加 CSS 滤镜染色（竞业达 logo 本身是品牌印刷色）
- 不要在内容页正文里手写 `<style>` 或硬编码颜色
- 不要把绿色用在大面积背景（仅作装饰、收边、辅助对照）

## 7. AI Prompt 指南

### 快速颜色参考

```
主蓝: #003DA5
辅绿: #8FC31F
主背景: #ffffff
正文: #1a1a1a
标题文字: #ffffff（蓝底上）
```

### 示例 Prompt

- "生成一个竞业达 2026 Q1 述职报告封面，汇报人张三，部门信息科技软件研发部，BU 创新与发展"
- "生成目录页，三个章节：业务现状 / 核心进展 / 2026 规划，当前高亮第二章"
- "加一页两栏对比 -- 左栏 '研发体系'、右栏 '市场反馈'"
- "加一页数据页，左侧柱状图展示 Q1-Q4 营收，右侧三张指标卡：年度总营收 / 同比增长 / 新签客户数"
