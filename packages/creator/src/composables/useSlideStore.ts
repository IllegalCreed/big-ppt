import { ref, computed } from 'vue'
import { api } from '../api/client'
import { parseDeck } from '../deck-renderer/parse-deck'

// Module-scope 单例：ChatPanel（useAIChat）触发的 setPage 需要让 SlidePreview 响应，
// 两个消费者必须共享同一套 refs，故把状态提升到模块作用域。
const content = ref('')
const currentPage = ref(1)
/** 当前编辑器活动的 deckId；refresh() 用它走 deck-scoped 路径拉 DB 当前版本内容。 */
const activeDeckId = ref<number | null>(null)
/**
 * LLM 工作中标记。useAIChat 在 status 变化时同步，供下游 UI 灰显使用。
 */
const aiBusy = ref(false)

export function useSlideStore() {
  /**
   * Phase 10.5：复用 DeckRenderer 同款 parseDeck，跟视觉层渲染口径完全一致。
   * 早期用过的「按 \n---\n split」naive 切法会把 frontmatter
   * 的 `---` 也当 slide 分隔符 → totalPages 虚高。
   */
  const parsed = computed(() => parseDeck(content.value))
  const pages = computed(() => parsed.value.slides.map((s) => s.body))

  const totalPages = computed(() => parsed.value.slides.length)

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

/**
   * Phase 10.5：进入编辑器时由 SlidePreview / DeckEditorPage 调用，绑定当前 deckId
   * 并把初始内容塞进 content。后续 refresh() 用此 deckId 走 deck-scoped 路径拉新。
   */
  function initDeck(deckId: number, initialContent: string): void {
    activeDeckId.value = deckId
    update(initialContent)
  }

  /**
   * 从 server 拉最新 deck 内容 → 写 content。
   *
   * 走 deck-scoped 端点 `GET /api/decks/:id`，读取数据库中的当前版本。
   *
   * 触发点：
   * - useAIChat session-end：LLM 跑完后同步 server 写入的最终态
   * - useSwitchTemplateJob 完成：切模板后拉新内容
   * - useGenerateImageJob 完成：image-gen 成功后拉新 imageSrc
   * - VersionTimeline restore：回滚版本后拉新内容
   */
  async function refresh(): Promise<void> {
    const id = activeDeckId.value
    if (!id) return // 编辑器外（如 deck 列表页）调用无意义
    try {
      const res = await api.get<{ currentVersion: { content: string } | null }>(`/api/decks/${id}`)
      if (res.currentVersion) update(res.currentVersion.content)
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
    activeDeckId,
    setPage,
    update,
    initDeck,
    refresh,
    setAIBusy,
  }
}
