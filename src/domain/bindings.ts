import type { ICellData, IWorkbookData, IWorksheetData } from '@univerjs/core'
import type { LocatedBinding, ReportBinding } from './types'

export function getBinding(cell?: unknown): ReportBinding | undefined {
  const value = (cell as ICellData | undefined)?.custom?.reportBinding as Partial<ReportBinding> | undefined
  if (!value || typeof value.fieldKey !== 'string' || typeof value.fieldLabel !== 'string' ||
    !['string', 'number', 'date', 'boolean'].includes(value.fieldType ?? '') ||
    !['detail', 'single', 'sum'].includes(value.kind ?? '')) return undefined
  return value as ReportBinding
}
export function cellEntries(cells: unknown): [string, ICellData][] {
  if (!cells || typeof cells !== 'object') return []
  return Object.entries(cells).filter((entry): entry is [string, ICellData] => !!entry[1] && typeof entry[1] === 'object')
}
export function bindingText(binding: ReportBinding) {
  if (binding.kind === 'sum') return `Σ ${binding.fieldLabel}`
  if (binding.kind === 'single') return `单值 · ${binding.fieldLabel} · 第 ${(binding.recordIndex ?? 0) + 1} 条`
  return `{{${binding.fieldLabel}}}`
}
export function firstSheet(snapshot: IWorkbookData): Partial<IWorksheetData> {
  const sheet = snapshot.sheets[snapshot.sheetOrder[0]!]
  if (!sheet) throw new Error('模板缺少工作表，请新建模板。')
  return sheet
}
export function scanBindings(snapshot: IWorkbookData): LocatedBinding[] {
  const result: LocatedBinding[] = []
  for (const [row, cells] of Object.entries(firstSheet(snapshot).cellData ?? {})) {
    for (const [column, cell] of cellEntries(cells)) {
      const binding = getBinding(cell)
      if (binding) result.push({ ...binding, row: Number(row), column: Number(column) })
    }
  }
  return result.sort((a, b) => a.row - b.row || a.column - b.column)
}
export function columnName(index: number): string {
  let label = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + ((n - 1) % 26)) + label
  return label
}
export function address(row: number, column: number) {
  return `${columnName(column)}${row + 1}`
}
