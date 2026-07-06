/**
 * readImageDimensions:从图片字节头解析真实像素尺寸。
 * 用途:image-gen worker 落库前校验 OpenAI/中转实际返回的分辨率,
 * 与请求的 size 比对——中转不认尺寸(如把 1280x624 按 16:9 返 1672x941)时能落盘 size-mismatch。
 */
import { describe, expect, it } from 'vitest'
import { readImageDimensions } from '../src/llm/image-dimensions.js'

/** 造一个真实 PNG 头(signature + IHDR),width/height 在 offset 16/20 big-endian */
function pngHeader(w: number, h: number): Buffer {
  const b = Buffer.alloc(33)
  b.writeUInt32BE(0x89504e47, 0) // \x89PNG
  b.writeUInt32BE(0x0d0a1a0a, 4)
  b.writeUInt32BE(13, 8) // IHDR chunk length
  b.write('IHDR', 12, 'ascii')
  b.writeUInt32BE(w, 16)
  b.writeUInt32BE(h, 20)
  return b
}

/** 造一个最小 JPEG:SOI + SOF0(含 height/width @ offset 5/7) */
function jpegHeader(w: number, h: number): Buffer {
  const b = Buffer.alloc(20)
  b[0] = 0xff
  b[1] = 0xd8 // SOI
  b[2] = 0xff
  b[3] = 0xc0 // SOF0
  b.writeUInt16BE(17, 4) // segment length
  b[6] = 8 // precision
  b.writeUInt16BE(h, 7)
  b.writeUInt16BE(w, 9)
  return b
}

describe('readImageDimensions', () => {
  it('解析 PNG 的真实宽高', () => {
    expect(readImageDimensions(pngHeader(1280, 624))).toEqual({
      width: 1280,
      height: 624,
      format: 'png',
    })
  })

  it('解析中转按 16:9 返回的非标准尺寸(1672x941)', () => {
    const d = readImageDimensions(pngHeader(1672, 941))
    expect(d).toEqual({ width: 1672, height: 941, format: 'png' })
  })

  it('解析 JPEG 的真实宽高', () => {
    expect(readImageDimensions(jpegHeader(1024, 768))).toEqual({
      width: 1024,
      height: 768,
      format: 'jpeg',
    })
  })

  it('解析带前置 APP0 段的真实 JPEG(跳过非 SOF marker 后命中 SOF)', () => {
    // SOI + APP0(JFIF, 16B payload) + SOF0(1920x1080)
    const app0 = Buffer.concat([
      Buffer.from([0xff, 0xe0, 0x00, 0x10]), // APP0, length 16
      Buffer.from('JFIF\0', 'ascii'),
      Buffer.alloc(11), // 补齐到 16B payload
    ])
    const sof = Buffer.alloc(11)
    sof[0] = 0xff
    sof[1] = 0xc2 // SOF2(progressive)也算 SOF
    sof.writeUInt16BE(17, 2)
    sof[4] = 8
    sof.writeUInt16BE(1080, 5)
    sof.writeUInt16BE(1920, 7)
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof])
    expect(readImageDimensions(jpeg)).toEqual({ width: 1920, height: 1080, format: 'jpeg' })
  })

  it('JPEG 有 SOI 但无 SOF 段 → 返回 null', () => {
    // SOI + 一个 APP0 段就结束,没有 SOF
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04]),
      Buffer.alloc(2),
    ])
    expect(readImageDimensions(jpeg)).toBeNull()
  })

  it('无法识别的字节返回 null(不抛错)', () => {
    expect(readImageDimensions(Buffer.from('not an image at all'))).toBeNull()
  })

  it('过短的 buffer 返回 null', () => {
    expect(readImageDimensions(Buffer.from([0x89, 0x50]))).toBeNull()
  })
})
