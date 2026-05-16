/** Phase 13 Task C: XLSX 多 sheet → JSON.stringify(限 200 行 50 列)。 */
import * as XLSX from 'xlsx'

const MAX_ROWS_PER_SHEET = 200
const MAX_COLS_PER_ROW = 50
const MAX_CHARS = 50_000

export async function parseXlsx(buffer: Buffer): Promise<string> {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const out: Record<string, unknown[][]> = {}
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null }) as unknown[][]
    const truncated = rows.slice(0, MAX_ROWS_PER_SHEET).map((r) => r.slice(0, MAX_COLS_PER_ROW))
    out[sheetName] = truncated
  }
  let text = JSON.stringify(out, null, 2)
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + '\n\n... (truncated)'
  return text
}
