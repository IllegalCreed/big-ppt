import { describe, expect, it } from 'vitest'
import { isPrivateOrSpecialIp, validatePublicHttpUrl } from '../src/utils/url-safety.js'

describe('url-safety', () => {
  it('blocks private/special IP ranges', () => {
    expect(isPrivateOrSpecialIp('127.0.0.1')).toBe(true)
    expect(isPrivateOrSpecialIp('10.0.0.1')).toBe(true)
    expect(isPrivateOrSpecialIp('172.16.0.1')).toBe(true)
    expect(isPrivateOrSpecialIp('192.168.1.1')).toBe(true)
    expect(isPrivateOrSpecialIp('169.254.169.254')).toBe(true)
    expect(isPrivateOrSpecialIp('::1')).toBe(true)
    expect(isPrivateOrSpecialIp('fd00::1')).toBe(true)
    expect(isPrivateOrSpecialIp('8.8.8.8')).toBe(false)
  })

  it('validates public http urls without DNS in non-production paths', async () => {
    await expect(validatePublicHttpUrl('https://example.com/mcp')).resolves.toEqual({
      ok: true,
      url: 'https://example.com/mcp',
    })
    await expect(validatePublicHttpUrl('http://example.com/mcp')).resolves.toEqual({
      ok: true,
      url: 'http://example.com/mcp',
    })
    await expect(validatePublicHttpUrl('file:///etc/passwd')).resolves.toMatchObject({ ok: false })
    await expect(validatePublicHttpUrl('https://localhost:4000')).resolves.toMatchObject({
      ok: false,
    })
    await expect(validatePublicHttpUrl('https://127.0.0.1:4000')).resolves.toMatchObject({
      ok: false,
    })
    await expect(validatePublicHttpUrl('https://[::1]:4000')).resolves.toMatchObject({ ok: false })
    await expect(validatePublicHttpUrl('https://169.254.169.254/latest')).resolves.toMatchObject({
      ok: false,
    })
  })

  it('can enforce production-style https and DNS checks', async () => {
    await expect(
      validatePublicHttpUrl('http://example.com', { allowHttp: false }),
    ).resolves.toMatchObject({
      ok: false,
    })
    await expect(
      validatePublicHttpUrl('https://nonexistent.invalid', { resolveDns: true }),
    ).resolves.toMatchObject({ ok: false })
  })
})
