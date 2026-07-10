export type ContentDispositionType = 'inline' | 'attachment'

export function contentDisposition(type: ContentDispositionType, filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7E]/g, '_').replace(/[\\"]/g, '_')
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}
