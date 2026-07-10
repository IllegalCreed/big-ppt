import { lookup } from 'node:dns/promises'
import net from 'node:net'

export interface PublicHttpUrlCheckOptions {
  allowHttp?: boolean
  resolveDns?: boolean
  label?: string
}

export type PublicHttpUrlCheck = { ok: true; url: string } | { ok: false; error: string }

export async function validatePublicHttpUrl(
  raw: string,
  options: PublicHttpUrlCheckOptions = {},
): Promise<PublicHttpUrlCheck> {
  const label = options.label ?? 'URL'
  const value = raw.trim()
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { ok: false, error: `${label} 必须是合法 URL` }
  }

  const allowHttp = options.allowHttp ?? process.env.NODE_ENV !== 'production'
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    return { ok: false, error: `${label} 仅允许 https${allowHttp ? ' 或 http' : ''}` }
  }
  if (url.username || url.password) {
    return { ok: false, error: `${label} 不允许携带用户名或密码` }
  }

  const host = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1')
  if (!host || isBlockedHostname(host)) {
    return { ok: false, error: `${label} 不允许指向本机或内网地址` }
  }
  if (net.isIP(host) && isPrivateOrSpecialIp(host)) {
    return { ok: false, error: `${label} 不允许指向本机或内网地址` }
  }

  const shouldResolve = options.resolveDns ?? process.env.NODE_ENV === 'production'
  if (shouldResolve && !net.isIP(host)) {
    let addresses: { address: string; family: number }[]
    try {
      addresses = await lookup(host, { all: true, verbatim: true })
    } catch {
      return { ok: false, error: `${label} 域名解析失败` }
    }
    if (addresses.some((a) => isPrivateOrSpecialIp(a.address))) {
      return { ok: false, error: `${label} 不允许解析到本机或内网地址` }
    }
  }

  return { ok: true, url: value }
}

function isBlockedHostname(host: string): boolean {
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0' ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  )
}

export function isPrivateOrSpecialIp(ip: string): boolean {
  const mappedV4 = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1]
  if (mappedV4) return isPrivateOrSpecialIpv4(mappedV4)

  const family = net.isIP(ip)
  if (family === 4) return isPrivateOrSpecialIpv4(ip)
  if (family === 6) return isPrivateOrSpecialIpv6(ip)
  return false
}

function isPrivateOrSpecialIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p))
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return true
  }
  const [a, b] = parts as [number, number, number, number]
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

function isPrivateOrSpecialIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase()
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb') ||
    normalized.startsWith('ff')
  )
}
