/**
 * LLM API Key 服务端加密。
 *
 * AES-256-GCM：32B master key（APIKEY_MASTER_KEY，hex）+ 12B 随机 IV + 16B 认证 tag。
 * 存储格式：`v1:<base64(iv)>:<base64(ciphertext)>:<base64(tag)>`，版本前缀便于未来轮换。
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALG = 'aes-256-gcm'
const IV_LEN = 12
const KEY_LEN = 32
const VERSION = 'v1'

function defaultGetMasterKey(): Buffer {
  const hex = process.env.APIKEY_MASTER_KEY
  if (!hex) {
    throw new Error(
      '[crypto/apikey] APIKEY_MASTER_KEY 未设置。请在 packages/agent/.env.local 中填入（32 字节 hex，64 字符）。',
    )
  }
  if (hex.length !== KEY_LEN * 2) {
    throw new Error(
      `[crypto/apikey] APIKEY_MASTER_KEY 长度不对：期望 ${KEY_LEN * 2} 位 hex，实际 ${hex.length}。`,
    )
  }
  return Buffer.from(hex, 'hex')
}

// 测试用注入点：默认走环境变量；单测可通过 __setMasterKeyGetterForTesting
// 传入固定 Buffer，避免污染 process.env
let _keyGetter: () => Buffer = defaultGetMasterKey
const getMasterKey = (): Buffer => _keyGetter()

/** @internal 仅供测试使用。传 null 恢复默认 env 读取策略 */
export function __setMasterKeyGetterForTesting(fn: (() => Buffer) | null): void {
  _keyGetter = fn ?? defaultGetMasterKey
}

export function encryptApiKey(plaintext: string): string {
  const key = getMasterKey()
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALG, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${VERSION}:${iv.toString('base64')}:${ciphertext.toString('base64')}:${tag.toString('base64')}`
}

export function decryptApiKey(blob: string): string {
  const parts = blob.split(':')
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('[crypto/apikey] 密文格式不正确或版本不支持')
  }
  const [, ivB64, ctB64, tagB64] = parts
  const key = getMasterKey()
  const iv = Buffer.from(ivB64!, 'base64')
  const ciphertext = Buffer.from(ctB64!, 'base64')
  const tag = Buffer.from(tagB64!, 'base64')
  const decipher = createDecipheriv(ALG, key, iv)
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return plaintext.toString('utf8')
}

/**
 * 判断某字符串是否是本模块生成的 `v1:iv:ct:tag` 密文格式。
 * 用于向后兼容：老版本的 mcp.json 里 headers value 是明文，迁移时能区分。
 */
export function isEncryptedBlob(s: unknown): boolean {
  return typeof s === 'string' && /^v1:[^:]+:[^:]+:[^:]+$/.test(s)
}
