/**
 * 从图片字节头解析真实像素尺寸(不解码整图,只读文件头)。
 *
 * 用途:image-gen worker 落库前校验 OpenAI / 中转**实际返回**的分辨率。
 * 出图工具请求的 size(如 1280x624 = 2.051:1,贴合 *-image-content layout 的 body 区)
 * 有些中转不认——2026-07 dogfood 实测生产把请求按 16:9 返回 1672x941(1.777:1),
 * 塞进 2.051 的 body 区 object-fit:cover 上下各裁 ~6.7%。校验命中即 logServerEvent
 * 落 size-mismatch,事后 grep 就能定位是哪家 provider / 哪个 baseUrl 忽略了尺寸。
 *
 * 支持 PNG / JPEG(OpenAI image API 返回 PNG;中转偶有 JPEG)。识别不了返 null,绝不抛错。
 */

export interface ImageDimensions {
  width: number
  height: number
  format: 'png' | 'jpeg'
}

/**
 * 返回图宽高比相对请求 size 的容差(2%)。超过即视为「provider 没按尺寸返图」。
 * 同比高分辨率(如请求 1280x624 返 2560x1248)AR 一致不触发;
 * 中转把 1280x624(2.051) 按 16:9 返 1672x941(1.777) 时 AR 差 ~13% → 触发。
 * image-gen worker(落 size-mismatch 日志)与 mood-board(锚图不符则重抽)共用此阈值。
 */
export const SIZE_AR_TOLERANCE = 0.02

/** PNG:signature(8B) + IHDR chunk,width/height 在 offset 16/20 big-endian */
function parsePng(buf: Buffer): ImageDimensions | null {
  if (buf.length < 24) return null
  // \x89 P N G \r \n \x1a \n
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) {
    return null
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), format: 'png' }
}

/** JPEG:扫描到第一个 SOF marker,height/width 在其 payload offset 5/7 big-endian */
function parseJpeg(buf: Buffer): ImageDimensions | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null
  let offset = 2
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset++
      continue
    }
    const marker = buf[offset + 1]!
    // SOF0..SOF15 承载尺寸,排除非 SOF 的 DHT(c4) / JPG(c8) / DAC(cc)
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      return {
        height: buf.readUInt16BE(offset + 5),
        width: buf.readUInt16BE(offset + 7),
        format: 'jpeg',
      }
    }
    // 跳过本段:marker(2B) + length(2B, 含自身)
    const segLen = buf.readUInt16BE(offset + 2)
    if (segLen < 2) return null // 防御坏数据死循环
    offset += 2 + segLen
  }
  return null
}

/**
 * 解析图片字节的真实宽高。识别 PNG / JPEG;其它格式或坏数据返 null。
 */
export function readImageDimensions(buf: Buffer): ImageDimensions | null {
  return parsePng(buf) ?? parseJpeg(buf)
}
