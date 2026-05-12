/**
 * Phase 10.5 落地 Task 25-A-2：body markdown + Vue 标签运行时编译。
 *
 * 链路：
 *   marked → 把标准 markdown 转 HTML（标题/列表/段落/inline 代码）
 *   保留嵌入的大写 Vue 自定义标签（marked 默认 inline HTML 透传）
 *   Vue.compile(html) 出 render
 *   defineComponent({ render }) 包成动态组件
 *
 * 缓存：相同 body 字符串 → 同一组件实例。避免每次响应式 trigger 都重编译。
 *
 * 不在范围：deck-level frontmatter / `<v-clicks>` / Slidev 演讲特殊指令 ——
 * 这些上下文 Slidev SPA 跑得到，DeckRenderer 编辑视图不渲染。
 */

import { compile, defineComponent, type Component } from 'vue'
import { marked } from 'marked'

const cache = new Map<string, Component>()

export function compileBody(body: string): Component {
  const cached = cache.get(body)
  if (cached) return cached
  // breaks: false 跟 Slidev 默认对齐；async: false 走同步路径
  const html = marked.parse(body, { async: false, breaks: false }) as string
  const render = compile(html)
  const comp = defineComponent({ render })
  cache.set(body, comp)
  return comp
}

/** 测试场景重置缓存 */
export function _resetBodyCache(): void {
  cache.clear()
}
