/**
 * Phase 14 Task B：PNG Buffer[] → 单个 zip blob（每页一个独立 PNG）。
 *
 * 文件命名：`slide-01.png ... slide-NN.png`（2 位 zero-pad，按序排序文件管理器
 * 顺序跟页序一致；超 99 页时 pad 不够但概率极低，未来 N>99 再扩到 3 位）
 *
 * 压缩策略：每个 entry compression = 'STORE'（不二次 deflate），原因：PNG 本身
 * 已 deflate 过，对它再 deflate 收益接近 0（实测压缩比 1.001~1.01）但 CPU 多
 * 跑一遍 deflate；STORE 直接拷贝 byte 流到 zip，CPU + 时间都省。
 *
 * jszip 3.x API（index.d.ts L100 + L141 核实）：
 * - `zip.file(path, data, { compression: 'STORE' })`：data 接 Buffer / Uint8Array / string
 * - `zip.generateAsync({ type: 'blob' })`：浏览器 / jsdom 下返 Blob
 */
import JSZip from 'jszip'
import type { Buffer } from 'buffer'

export async function pngsToZip(pngs: Buffer[]): Promise<Blob> {
  const zip = new JSZip()
  pngs.forEach((png, i) => {
    // 2 位 zero-pad：1 → '01' ... 99 → '99'（>99 仍能 pad 但宽度变 3，文件管理器
    // 排序行为可能错位；当前 deck 单页数远低于 100）
    const name = `slide-${String(i + 1).padStart(2, '0')}.png`
    zip.file(name, png, { compression: 'STORE' })
  })
  return zip.generateAsync({ type: 'blob' })
}
