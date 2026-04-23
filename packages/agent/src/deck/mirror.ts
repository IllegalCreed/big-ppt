/** 把 deck 当前版本内容落地到 packages/slidev/slides.md，供 Slidev 热重载。 */
import fs from 'node:fs'
import { getPaths } from '../workspace.js'

export function mirrorSlidesContent(content: string): void {
  const { slidesPath } = getPaths()
  fs.writeFileSync(slidesPath, content, 'utf-8')
}
