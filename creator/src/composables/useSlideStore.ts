import { ref, computed } from 'vue'

export function useSlideStore() {
  const content = ref('')
  const currentPage = ref(1)

  const pages = computed(() => {
    if (!content.value) return []
    // 按 --- 分页，跳过空段
    return content.value
      .split(/\n---\n/)
      .map(p => p.trim())
      .filter(Boolean)
  })

  const totalPages = computed(() => pages.value.length)

  function update(newContent: string) {
    content.value = newContent
    if (currentPage.value > totalPages.value) {
      currentPage.value = Math.max(1, totalPages.value)
    }
  }

  function setPage(page: number) {
    if (page >= 1 && page <= totalPages.value) {
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
    try {
      const res = await fetch('/api/read-slides')
      const text = await res.text()
      update(text)
    } catch {}
  }

  return {
    content,
    pages,
    currentPage,
    totalPages,
    setPage,
    update,
    exportMarkdown,
    refresh,
  }
}
