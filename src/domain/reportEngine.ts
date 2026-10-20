import { CellValueType, type ICellData, type IWorkbookData } from '@univerjs/core'
import Decimal from 'decimal.js'
import { cellEntries, firstSheet, getBinding, scanBindings } from './bindings'
import { getDetailRow } from './detailRegion'
import { collectTemplateIssues } from './validation'
import type { DataRow, DataSource, GeneratedReport, ReportTemplate } from './types'

export function validateTemplate(snapshot: IWorkbookData, source?: DataSource): string[] {
  return [...new Set(collectTemplateIssues(snapshot, source).map(issue => issue.message))]
}

function filledCell(cell: ICellData, detail: DataRow, rows: DataRow[], totals: Record<string, number>): ICellData {
  const next = structuredClone(cell)
  const binding = getBinding(cell)
  // 结果不再携带设计器标记，其余业务自定义元数据保持不变。
  if (next.custom) {
    delete next.custom.reportBinding
    delete next.custom.reportDetailAnchor
    if (!Object.keys(next.custom).length) delete next.custom
  }
  if (!binding) return next
  const value = binding.kind === 'sum' ? totals[binding.fieldKey]!
    : binding.kind === 'single' ? rows[binding.recordIndex ?? 0]?.[binding.fieldKey]
      : detail[binding.fieldKey]
  delete next.f
  delete next.p
  next.v = value ?? ''
  // 显式设置类型，避免把以 = 开头的数据字符串解释成公式。
  next.t = typeof value === 'number' ? CellValueType.NUMBER : typeof value === 'boolean' ? CellValueType.BOOLEAN : CellValueType.STRING
  return next
}

export function generateReport(template: ReportTemplate, source: DataSource, rows: DataRow[]): GeneratedReport {
  const errors = validateTemplate(template.snapshot, source)
  if (errors.length) throw new Error(errors.join('\n'))
  const bindings = scanBindings(template.snapshot)
  for (const binding of bindings) {
    const entries = binding.kind === 'single'
      ? rows[binding.recordIndex ?? 0] ? [[binding.recordIndex ?? 0, rows[binding.recordIndex ?? 0]!] as const] : []
      : Array.from(rows.entries())
    for (const [index, row] of entries) {
      const value = row[binding.fieldKey]
      if (value == null) continue
      const expected = binding.fieldType === 'number' ? 'number' : binding.fieldType === 'boolean' ? 'boolean' : 'string'
      if (typeof value !== expected || (typeof value === 'number' && !Number.isFinite(value))) {
        throw new Error(`第 ${index + 1} 条记录的「${binding.fieldLabel}」类型不正确。`)
      }
    }
  }
  const snapshot = structuredClone(template.snapshot)
  snapshot.id = `preview-${crypto.randomUUID()}`
  snapshot.name = template.name
  const sheet = firstSheet(snapshot)
  sheet.name = '报表数据'
  const detailRow = getDetailRow(template.snapshot)
  const count = detailRow === undefined ? 1 : Math.max(1, rows.length)
  const shift = count - 1
  const totals: Record<string, number> = {}
  for (const binding of bindings.filter(b => b.kind === 'sum')) {
    totals[binding.fieldKey] = rows.reduce((sum, row) => sum.plus((row[binding.fieldKey] as number | null) ?? 0), new Decimal(0)).toNumber()
  }
  const originalCells = sheet.cellData ?? {}
  const output: NonNullable<typeof sheet.cellData> = {}
  for (const [key, cells] of Object.entries(originalCells)) {
    const rowIndex = Number(key)
    if (rowIndex === detailRow) {
      for (let i = 0; i < count; i++) {
        output[detailRow + i] = Object.fromEntries(cellEntries(cells).map(([col, cell]) => [col, filledCell(cell, rows[i] ?? {}, rows, totals)]))
      }
    } else {
      const targetRow = detailRow !== undefined && rowIndex > detailRow ? rowIndex + shift : rowIndex
      output[targetRow] = Object.fromEntries(cellEntries(cells).map(([col, cell]) => [col, filledCell(cell, {}, rows, totals)]))
    }
  }
  sheet.cellData = output
  const rowData: NonNullable<typeof sheet.rowData> = {}
  for (const [key, value] of Object.entries(sheet.rowData ?? {})) {
    const row = Number(key)
    if (row === detailRow) for (let i = 0; i < count; i++) rowData[row + i] = structuredClone(value)
    else rowData[detailRow !== undefined && row > detailRow ? row + shift : row] = value
  }
  sheet.rowData = rowData
  sheet.mergeData = (sheet.mergeData ?? []).flatMap(merge => {
    if (merge.startRow === detailRow && merge.endRow === detailRow) {
      return Array.from({ length: count }, (_, i) => ({ ...merge, startRow: detailRow + i, endRow: detailRow + i }))
    }
    return [{ ...merge,
      startRow: detailRow !== undefined && merge.startRow > detailRow ? merge.startRow + shift : merge.startRow,
      endRow: detailRow !== undefined && merge.endRow > detailRow ? merge.endRow + shift : merge.endRow,
    }]
  })
  if (detailRow !== undefined) sheet.rowCount = Math.max((sheet.rowCount ?? 150) + shift, detailRow + count + 10)
  return { snapshot, recordCount: rows.length, sourceName: source.name, generatedAt: new Date().toISOString() }
}
