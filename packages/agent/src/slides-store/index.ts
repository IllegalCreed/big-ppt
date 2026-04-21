import fs from 'node:fs'
import { getPaths } from '../workspace.js'
import { similarity } from '../utils/similarity.js'

/** 每次 write/edit 前备份当前 slides.md 到 .bak，供 /undo 恢复 */
export function backupSlides(): void {
  const { slidesPath, slidesBak } = getPaths()
  if (fs.existsSync(slidesPath)) {
    fs.copyFileSync(slidesPath, slidesBak)
  }
}

export function readSlides(): string {
  const { slidesPath } = getPaths()
  return fs.readFileSync(slidesPath, 'utf-8')
}

export function writeSlides(content: string): void {
  const { slidesPath } = getPaths()
  backupSlides()
  fs.writeFileSync(slidesPath, content, 'utf-8')
}

export interface EditResult {
  success: boolean
  error?: string
}

/** 精确替换：old_string 在文件中必须唯一匹配 */
export function editSlides(oldString: string, newString: string): EditResult {
  if (!oldString) return { success: false, error: 'old_string 不能为空' }
  const { slidesPath } = getPaths()
  const content = fs.readFileSync(slidesPath, 'utf-8')
  const count = content.split(oldString).length - 1

  if (count === 0) {
    const lines = content.split('\n')
    const suggestions = lines
      .filter((l) => similarity(l.trim(), oldString.trim()) > 0.3)
      .slice(0, 3)
      .map((l) => l.trim())
    return {
      success: false,
      error: `未找到指定内容。相似内容：\n${suggestions.join('\n')}`,
    }
  }

  if (count > 1) {
    const positions: number[] = []
    const lines = content.split('\n')
    const firstLine = oldString.split('\n')[0] ?? ''
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.includes(firstLine)) positions.push(i + 1)
    }
    return {
      success: false,
      error: `找到 ${count} 处匹配，请提供更长的上下文以唯一定位。匹配位置：第 ${positions.join(', ')} 行附近`,
    }
  }

  const newContent = content.replace(oldString, newString)
  backupSlides()
  fs.writeFileSync(slidesPath, newContent, 'utf-8')
  return { success: true }
}

export interface RestoreResult {
  success: boolean
  message?: string
  error?: string
}

export function restoreSlides(): RestoreResult {
  const { slidesPath, slidesBak } = getPaths()
  if (!fs.existsSync(slidesBak)) {
    return { success: false, error: '没有可撤销的备份（slides.md.bak 不存在）' }
  }
  fs.copyFileSync(slidesBak, slidesPath)
  return { success: true, message: '已恢复到上一次修改前的版本' }
}
