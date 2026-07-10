import type { Buffer } from 'buffer'
import type { CapturePagesOptions } from './capture-pages'

export async function capturePagesLazy(opts: CapturePagesOptions): Promise<Buffer[]> {
  const { capturePages } = await import('./capture-pages')
  return capturePages(opts)
}

export async function pngsToPdfLazy(pngs: Buffer[]): Promise<Blob> {
  const { pngsToPdf } = await import('./to-pdf')
  return pngsToPdf(pngs)
}

export async function pngsToPptxLazy(pngs: Buffer[]): Promise<Blob> {
  const { pngsToPptx } = await import('./to-pptx')
  return pngsToPptx(pngs)
}

export async function pngsToZipLazy(pngs: Buffer[]): Promise<Blob> {
  const { pngsToZip } = await import('./to-png-zip')
  return pngsToZip(pngs)
}
