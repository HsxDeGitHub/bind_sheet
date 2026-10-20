import type { ICellData, IColorStyle, IStyleData, IWorkbookData, Nullable } from '@univerjs/core'
import type ExcelJS from 'exceljs'
import { cellEntries, firstSheet } from '../domain/bindings'

function color(value: Nullable<IColorStyle>): Partial<ExcelJS.Color> | undefined {
  const rgb = value?.rgb?.replace('#', '')
  if (!rgb || !/^[\da-f]{6}([\da-f]{2})?$/i.test(rgb)) return undefined
  return { argb: rgb.length === 6 ? `FF${rgb}` : rgb }
}
function resolveStyle(snapshot: IWorkbookData, value?: string | Nullable<IStyleData>): IStyleData {
  return typeof value === 'string' ? snapshot.styles?.[value] ?? {} : value ?? {}
}
function plainValue(cell: ICellData): string | number | boolean | null {
  if (cell.f) throw new Error('首版暂不导出手写公式，请使用字段合计或将公式改为固定值。')
  if (cell.p?.body?.dataStream) return cell.p.body.dataStream.replace(/\r?\n$/, '').replace(/\r$/, '')
  return cell.v ?? null
}
function applyStyle(target: ExcelJS.Cell, style: IStyleData) {
  target.font = {
    name: style.ff ?? '微软雅黑', size: style.fs ?? 11,
    bold: style.bl === 1, italic: style.it === 1,
    underline: style.ul?.s === 1, strike: style.st?.s === 1,
    color: color(style.cl),
  }
  if (color(style.bg)) target.fill = { type: 'pattern', pattern: 'solid', fgColor: color(style.bg) }
  const horizontal: Record<number, ExcelJS.Alignment['horizontal']> = { 1: 'left', 2: 'center', 3: 'right', 4: 'justify' }
  const vertical: Record<number, ExcelJS.Alignment['vertical']> = { 1: 'top', 2: 'middle', 3: 'bottom' }
  target.alignment = {
    horizontal: horizontal[style.ht ?? 0], vertical: vertical[style.vt ?? 0] ?? 'middle',
    wrapText: style.tb === 3,
  }
  if (style.n?.pattern) target.numFmt = style.n.pattern
  if (style.bd) {
    const styles: Record<number, ExcelJS.BorderStyle> = { 1: 'thin', 2: 'hair', 3: 'dotted', 4: 'dashed', 5: 'dashDot', 6: 'dashDotDot', 7: 'double', 8: 'medium', 9: 'mediumDashed', 10: 'mediumDashDot', 11: 'mediumDashDotDot', 12: 'slantDashDot', 13: 'thick' }
    const borders: Partial<ExcelJS.Borders> = {}
    for (const [from, to] of [['t', 'top'], ['b', 'bottom'], ['l', 'left'], ['r', 'right']] as const) {
      const border = style.bd[from]
      if (border?.s) borders[to] = { style: styles[border.s] ?? 'thin', color: color(border.cl) ?? { argb: 'FFDDE5E2' } }
    }
    target.border = borders
  }
}

export async function createExcelWorkbook(snapshot: IWorkbookData) {
  const { default: Excel } = await import('exceljs')
  const book = new Excel.Workbook()
  book.creator = 'bind_sheet'
  book.created = new Date()
  const source = firstSheet(snapshot)
  const sheet = book.addWorksheet((source.name ?? '报表').replace(/[\\/*?:\[\]]/g, '').slice(0, 31))
  sheet.properties.defaultRowHeight = (source.defaultRowHeight ?? 28) * 0.75
  sheet.properties.defaultColWidth = ((source.defaultColumnWidth ?? 100) - 5) / 7
  sheet.views = [{ showGridLines: source.showGridlines !== 0 }]
  for (const [index, col] of Object.entries(source.columnData ?? {})) {
    if (!col) continue
    const target = sheet.getColumn(Number(index) + 1)
    if (col.w != null) target.width = Math.max(1, (col.w - 5) / 7)
    target.hidden = col.hd === 1
  }
  for (const [index, row] of Object.entries(source.rowData ?? {})) {
    if (!row) continue
    const target = sheet.getRow(Number(index) + 1)
    if (row.h != null) target.height = row.h * 0.75
    target.hidden = row.hd === 1
  }
  for (const [row, cells] of Object.entries(source.cellData ?? {})) {
    for (const [col, cell] of cellEntries(cells)) {
      if (!cell) continue
      const target = sheet.getCell(Number(row) + 1, Number(col) + 1)
      target.value = plainValue(cell)
      const style = {
        ...resolveStyle(snapshot, source.defaultStyle),
        ...resolveStyle(snapshot, source.columnData?.[Number(col)]?.s),
        ...resolveStyle(snapshot, source.rowData?.[Number(row)]?.s),
        ...resolveStyle(snapshot, cell.s),
      }
      applyStyle(target, style)
    }
  }
  for (const merge of source.mergeData ?? []) {
    sheet.mergeCells(merge.startRow + 1, merge.startColumn + 1, merge.endRow + 1, merge.endColumn + 1)
  }
  return book
}

export async function downloadExcel(snapshot: IWorkbookData, name: string) {
  const book = await createExcelWorkbook(snapshot)
  const buffer = await book.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${name.replace(/[\\/:*?"<>|]/g, '_') || '报表'}.xlsx`
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
