# 公司标准汇报模板 - 设计规范

> 此 DESIGN.md 定义了"公司标准汇报"模板套的全部视觉规范。AI 生成幻灯片时必须严格遵循此文件。

## 1. 视觉风格与氛围

**关键特征：**
- 正式、简洁、品牌感强
- 红白配色，突出公司品牌色
- 留白充足，信息层次分明
- 适用于述职、汇报、总结等正式场合

## 2. 配色方案

### 主色

| 角色 | 颜色 | Hex | 用途 |
|------|------|-----|------|
| 主色 | 红色 | `#d00d14` | 品牌标识、标题区背景、分割线、序号 |
| 渐变深色 | 深红 | `#a8090e` | 红色渐变终点 |
| 背景色 | 白色 | `#ffffff` | 页面背景 |

### 文字色

| 角色 | 颜色 | Hex | 用途 |
|------|------|-----|------|
| 标题（红色区） | 白色 | `#ffffff` | 红色背景上的标题 |
| 正文/标签 | 深灰 | `#333333` | 汇报人信息、目录文字 |

### 透明度

| 场景 | 值 | 用途 |
|------|-----|------|
| 当前章节 | 1.0 | 目录页 active 条目 |
| 非当前章节 | 0.2 | 目录页 inactive 条目 |
| 纹理叠加 | 0.1 | mark 纹理在红色背景上 |

## 3. 字体规范

### 字体族

- **主字体**：Microsoft YaHei（微软雅黑）
- **备选**：sans-serif

### 字号层级

| 角色 | 字号 | 字重 | 用途 |
|------|------|------|------|
| 封面主标题 | 52px | 700 | 封面页 h1 |
| 封面副标题 | 46px | 600 | 封面页 h2 |
| 目录"目录" | 60px | 700 | 目录页左侧中文标题 |
| 目录 CONTENTS | 20px | 600 | 目录页左侧英文 |
| 目录条目 | 22px | 600 | 目录页右侧文字 |
| 序号 | 20px | 700 | 目录页序号方块 |
| 汇报人信息 | 20px | bold | 封面底部 |
| Logo mark | 44px 高 | - | 右上角 logo 图标 |
| Logo text | 44px 高 | - | 右上角 logo 文字 |

## 4. 组件样式

### 红色渐变

```css
background: linear-gradient(180deg, #d00d14 0%, #c00b11 60%, #a8090e 100%);
```

### Logo 滤镜

```css
/* 白色 → 红色 */
filter: invert(87%) sepia(98%) saturate(4811%) hue-rotate(352deg) brightness(82%) contrast(100%);

/* 白色 → 黑色 */
filter: brightness(0);
```

### Mark 纹理

```css
background-image: url('/templates/company-standard/logo-mark.png');
background-repeat: no-repeat;
background-size: 100% 100%;
opacity: 0.1;
mix-blend-mode: screen;
```

### 过渡动画

| 类型 | 值 | 用途 |
|------|-----|------|
| 默认 | `slide-left` | 通用翻页 |

## 5. 布局原则

### 封面布局

- `position: absolute; inset: 0` 撑满幻灯片
- `padding: 36px 48px`
- Flexbox 垂直居中（`flex-direction: column; justify-content: center`）
- 三层结构：logo 行 → 红色标题区 → 汇报人信息行

### 目录布局

- `position: absolute; inset: 0` 撑满幻灯片
- `padding: 40px 48px`
- Flexbox 水平排列（`align-items: center`）
- 三列结构：红色色块(350x350) → 分割线(3px) → 目录列表
- 列间距 `gap: 20px`

## 6. Do's and Don'ts

### Do

- 始终使用微软雅黑字体
- logo 使用 PNG 透明底图 + CSS 滤镜变色
- 红色区域纹理使用 `background-size: 100% 100%` 拉伸充满
- 目录页 active/inactive 仅通过 opacity 区分

### Don't

- 不要使用 JPG logo（黑色背景会导致滤镜异常）
- 不要使用 `background-repeat: repeat` 做纹理
- 不要给序号方块和边框之间加 padding（紧贴）
- 不要给 inactive 目录项加额外的底部线条

## 7. AI Prompt 指南

### 快速颜色参考

```
主色: #d00d14
渐变深色: #a8090e
背景: #ffffff
标题文字: #ffffff（红底上）
正文文字: #333333（白底上）
```

### 示例 Prompt

- "生成一个述职报告封面，标题是2025年总结及2026年工作计划，汇报人张旭，时间2026/1/16"
- "生成目录页，包含三个章节：个人基本情况说明、2025年度工作总结、2026年工作计划，当前高亮第一章"
