import { ref, computed } from 'vue'

// Module-scope 单例：ChatPanel（useAIChat）触发的 setPage 需要让 SlidePreview 响应，
// 两个消费者必须共享同一套 refs，故把状态提升到模块作用域。
const content = ref('')
const currentPage = ref(1)
/**
 * LLM 工作中标记。useAIChat 在 status 变化时同步；下游目前只有一些 UI
 * 灰显需要（不再用于 iframe-era 的「重启 Slidev」按钮）。
 */
const aiBusy = ref(false)

export function useSlideStore() {
  const pages = computed(() => {
    if (!content.value) return []
    return content.value
      .split(/\n---\n/)
      .map((p) => p.trim())
      .filter(Boolean)
  })

  const totalPages = computed(() => pages.value.length)

  function update(newContent: string) {
    content.value = newContent
    if (totalPages.value > 0 && currentPage.value > totalPages.value) {
      currentPage.value = Math.max(1, totalPages.value)
    }
  }

  /**
   * 跳到指定页。**不做 upper bound check** —— AI 刚 create_slide 时 content 可能还是旧的
   * （refresh 还没跑），totalPages 滞后；DeckRenderer 内部对越界 page 自然渲染空，不崩。
   */
  function setPage(page: number) {
    if (Number.isInteger(page) && page >= 1) {
      currentPage.value = page
    }
  }

  function exportMarkdown() {
    const blob = new Blob([content.value], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'slides.md'
    a.click()
    URL.revokeObjectURL(url)
  }

  /**
   * 从 server 拉最新 slides.md → 写 content。
   *
   * 触发点：
   * - SlidePreview onMounted：进入编辑器拉初始内容
   * - useAIChat session-end：LLM 跑完后同步 server 端写过的 slides.md
   *   （DeckRenderer 时代不再有 HMR 缓存错位，但 server→client content 同步仍需）
   * - useSwitchTemplateJob 完成：切模板后拉新内容
   * - VersionTimeline restore：回滚版本后拉新内容
   */
  async function refresh() {
    try {
      const res = await fetch('/api/read-slides')
      const text = await res.text()
      update(text)
    } catch {
      /* 网络失败不阻塞 UI，下次 refresh 会再试 */
    }
  }

  function setAIBusy(busy: boolean) {
    aiBusy.value = busy
  }

  return {
    content,
    pages,
    currentPage,
    totalPages,
    aiBusy,
    setPage,
    update,
    exportMarkdown,
    refresh,
    setAIBusy,
  }
}
