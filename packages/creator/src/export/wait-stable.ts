/**
 * Phase 14 Task A：截图前等待 DeckRenderer DOM 稳定的工具函数。
 *
 * 屏蔽 Slidev 原 export 的 image-onload race bug —— 截图前必须等 5 条 stable
 * 条件全部满足，否则 html2canvas 会截到「图未加载」「字体未应用」「animation
 * 中间帧」「ResizeObserver scale 还没写 CSS var」等不一致状态。
 *
 * 5 条条件（plan 30 抉择 #6）：
 * 1. 所有 `<img>` 的 `complete && naturalWidth > 0`（防 AI 出图大图加载到一半）
 * 2. `document.fonts.ready`（防字体未应用导致行高 reflow）
 * 3. CSS animation / transition 全部 `.finished`（防截到关键帧中间）
 * 4. 2 × `requestAnimationFrame`（让 ResizeObserver 跑一轮 + scale 写 CSS var）
 * 5. 兜底 `setTimeout 500ms` settle（防上述四条都满足但还有未捕获的 micro-task）
 *
 * 单图最长等 10s，超时仍放行（不阻塞导出，宁可截到占位也比卡死好）。
 */
export async function waitForRenderStable(el: HTMLElement): Promise<void> {
  // 1. 等所有图片 complete
  const imgs = Array.from(el.querySelectorAll<HTMLImageElement>('img'))
  await Promise.all(
    imgs.map((img) =>
      img.complete && img.naturalWidth > 0
        ? null
        : new Promise<void>((res) => {
            img.addEventListener('load', () => res(), { once: true })
            img.addEventListener('error', () => res(), { once: true }) // 失败也放行
            setTimeout(() => res(), 10_000) // 单图 10s 兜底
          }),
    ),
  )

  // 2. 等字体
  if (typeof document !== 'undefined' && document.fonts) {
    await document.fonts.ready
  }

  // 3. 等 animation。jsdom / 老浏览器不实现 Element.getAnimations —— 跳过
  const anims =
    typeof el.getAnimations === 'function' ? el.getAnimations({ subtree: true }) : []
  await Promise.all(anims.map((a) => a.finished.catch(() => null)))

  // 4. 2 × rAF（让 ResizeObserver 跑一轮 + scale 写 CSS var）
  await new Promise<void>((res) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(() => res()))
    } else {
      // jsdom 老版本无 rAF；用 setTimeout 兜底，保持同步语义
      setTimeout(() => res(), 0)
    }
  })

  // 5. 兜底 settle
  await new Promise((res) => setTimeout(res, 500))
}
