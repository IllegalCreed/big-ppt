import { afterEach, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  __setMasterKeyGetterForTesting,
  decryptApiKey,
  encryptApiKey,
} from '../src/crypto/apikey.js'

const fixedKey = Buffer.from(
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', // 32 字节 hex（64 字符）
  'hex',
)

describe('crypto/apikey', () => {
  afterEach(() => {
    __setMasterKeyGetterForTesting(null)
    delete process.env.APIKEY_MASTER_KEY
  })

  it('encrypt → decrypt 回环返回原文', () => {
    __setMasterKeyGetterForTesting(() => fixedKey)
    const plain = 'sk-test-1234567890abcdef'
    const cipher = encryptApiKey(plain)
    expect(cipher).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/)
    expect(decryptApiKey(cipher)).toBe(plain)
  })

  it('tamper IV 后 decrypt 抛认证错误', () => {
    __setMasterKeyGetterForTesting(() => fixedKey)
    const cipher = encryptApiKey('hello world')
    const parts = cipher.split(':')
    // 篡改 IV（把最后一位改掉）
    const badIv = Buffer.from(parts[1], 'base64')
    badIv[0] ^= 0xff
    const tampered = `${parts[0]}:${badIv.toString('base64')}:${parts[2]}:${parts[3]}`
    expect(() => decryptApiKey(tampered)).toThrow()
  })

  it('tamper ciphertext 后 decrypt 认证失败', () => {
    __setMasterKeyGetterForTesting(() => fixedKey)
    const cipher = encryptApiKey('secret-api-key-xyz')
    const parts = cipher.split(':')
    const badCt = Buffer.from(parts[2], 'base64')
    badCt[0] ^= 0x01
    const tampered = `${parts[0]}:${parts[1]}:${badCt.toString('base64')}:${parts[3]}`
    expect(() => decryptApiKey(tampered)).toThrow()
  })

  it('版本前缀不是 v1: 时拒绝解密', () => {
    __setMasterKeyGetterForTesting(() => fixedKey)
    const cipher = encryptApiKey('payload')
    const parts = cipher.split(':')
    expect(() => decryptApiKey(`v9:${parts[1]}:${parts[2]}:${parts[3]}`)).toThrow(
      /格式不正确或版本不支持/,
    )
    // 少一段也算格式错
    expect(() => decryptApiKey('v1:onlyone:two')).toThrow(/格式不正确或版本不支持/)
  })

  it('APIKEY_MASTER_KEY 未设置时 encrypt 抛"未设置"', () => {
    __setMasterKeyGetterForTesting(null) // 走 defaultGetMasterKey
    // 确保 env 里没这个值
    expect(() => encryptApiKey('x')).toThrow(/APIKEY_MASTER_KEY 未设置/)
  })

  it('APIKEY_MASTER_KEY 长度错（非 64 字符 hex）时抛"长度不对"', () => {
    __setMasterKeyGetterForTesting(null)
    process.env.APIKEY_MASTER_KEY = randomBytes(16).toString('hex') // 32 字符，明显不够
    expect(() => encryptApiKey('x')).toThrow(/长度不对/)
  })
})
