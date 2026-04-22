import { ref, computed } from 'vue'

// Module-scope 单例：ChatPanel（useAIChat）触发的 setPage 需要让 SlidePreview 响应，
// 两个消费者必须共享同一套 refs，故把状态提升到模块作用域。
const content = ref('')
const currentPage = ref(1)
/** iframe src 带此 token 作为 query；bump 后强制 iframe 重新加载（手动刷新按钮用） */
const refreshToken = ref(0)

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
   * （refresh 还没跑），totalPages 滞后；Slidev 自己会把无效页 clamp 到最后一页。
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

  async function refresh() {
    refreshToken.value++
    try {
      const res = await fetch('/api/read-slides')
      const text = await res.text()
      update(text)
    } catch {
      /* 网络失败不阻塞 UI，下次 refresh 会再试 */
    }
  }

  return {
    content,
    pages,
    currentPage,
    totalPages,
    refreshToken,
    setPage,
    update,
    exportMarkdown,
    refresh,
  }
}
