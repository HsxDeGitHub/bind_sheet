import type { ICellData, IStyleData } from '@univerjs/core'
import { bindingText, firstSheet } from './bindings'
import { createTemplate } from './template'
import type { DataField, ReportBinding, ReportTemplate } from './types'

export interface QuickTemplateOptions {
  name: string
  fields: DataField[]
  sumFieldKeys: string[]
  defaultSourceId?: string
  /** 明细模板行，0 基；至少为 2，为标题和表头预留空间。 */
  detailRow?: number
}

/** 生成一条可展开的明细模板，字段顺序与用户选择保持一致。 */
export function createQuickTemplate(options: QuickTemplateOptions): ReportTemplate {
  const { fields, sumFieldKeys } = options
  const detailRow = options.detailRow ?? 5
  if (!Number.isSafeInteger(detailRow) || detailRow < 2) throw new Error('明细行必须是第 3 行或之后的整数行。')
  if (!fields.length) throw new Error('请至少选择一个字段。')
  if (fields.length > 24) throw new Error('一次最多选择 24 个字段。')
  const fieldKeys = new Set(fields.map(field => field.key))
  if (fieldKeys.size !== fields.length) throw new Error('所选字段不能重复。')
  const sumKeys = new Set(sumFieldKeys)
  for (const key of sumKeys) {
    const field = fields.find(candidate => candidate.key === key)
    if (!field) throw new Error('合计字段必须来自所选字段。')
    if (field.type !== 'number') throw new Error(`「${field.label}」不是数值字段，不能求和。`)
  }

  const template = createTemplate(false)
  const name = options.name.trim() || '未命名报表'
  template.name = name
  template.snapshot.name = name
  if (options.defaultSourceId !== undefined) template.defaultSourceId = options.defaultSourceId
  const sheet = firstSheet(template.snapshot)
  const styles = template.snapshot.styles!
  const lastColumn = fields.length
  const headerRow = detailRow - 1
  const titleRow = detailRow >= 4 ? 1 : 0
  const subtitleRow = titleRow + 1 < headerRow ? titleRow + 1 : undefined
  const allSummed = fields.every(field => sumKeys.has(field.key))
  const sumLabelRow = detailRow + 1
  const sumRow = detailRow + (allSummed ? 2 : 1)
  const noteRow = sumKeys.size ? sumRow + 2 : detailRow + 3
  const cells: NonNullable<typeof sheet.cellData> = {
    [titleRow]: { 1: { v: name, s: 'title' } },
    [headerRow]: {},
    [detailRow]: { 0: { custom: { reportDetailAnchor: true } } },
    [noteRow]: { 1: { v: '说明：本报表由所选数据源自动生成。', s: 'note' } },
  }
  if (subtitleRow !== undefined) cells[subtitleRow] = { 1: { v: '自定义明细报表  /  拖拽字段，轻松生成', s: 'subtitle' } }
  sheet.rowCount = Math.max(sheet.rowCount ?? 150, noteRow + 10)
  sheet.columnData = { 0: { w: 34 }, [lastColumn + 1]: { w: 34 } }
  sheet.rowData = {
    0: { h: 26 }, 3: { h: 22 }, [titleRow]: { h: 48 },
    [headerRow]: { h: 38 }, [detailRow]: { h: 42 }, [noteRow]: { h: 30 },
  }
  if (subtitleRow !== undefined) sheet.rowData[subtitleRow] = { h: 30 }
  sheet.mergeData = []
  const mergeLine = (row: number) => {
    if (lastColumn > 1) sheet.mergeData!.push({ startRow: row, endRow: row, startColumn: 1, endColumn: lastColumn })
  }
  mergeLine(titleRow)
  if (subtitleRow !== undefined) mergeLine(subtitleRow)
  mergeLine(noteRow)

  if (sumKeys.size) {
    cells[sumRow] = {}
    sheet.rowData[sumRow] = { h: 38 }
    if (allSummed) {
      cells[sumLabelRow] = { 1: { v: '合计', s: 'total' } }
      sheet.rowData[sumLabelRow] = { h: 30 }
      mergeLine(sumLabelRow)
    }
  }

  fields.forEach((field, index) => {
    const column = index + 1
    const detailStyleId = `quick-detail-${index}`
    const totalStyleId = `quick-total-${index}`
    const format = field.format || (field.type === 'number' ? '#,##0.00' : undefined)
    const formatStyle: IStyleData = {
      ...(field.type === 'number' ? { ht: 3 } : {}),
      ...(format ? { n: { pattern: format } } : {}),
    }
    styles[detailStyleId] = { ...structuredClone(styles.detail!), ...formatStyle }
    styles[totalStyleId] = { ...structuredClone(styles.total!), ...formatStyle }
    sheet.columnData![column] = { w: Math.min(220, Math.max(120, field.label.length * 18, field.type === 'number' ? 132 : 0)) }
    cells[headerRow]![column] = { v: field.label, s: 'header' }
    const binding: ReportBinding = { fieldKey: field.key, fieldLabel: field.label, fieldType: field.type, kind: 'detail' }
    cells[detailRow]![column] = boundCell(binding, detailStyleId)
    if (sumKeys.size) {
      cells[sumRow]![column] = sumKeys.has(field.key)
        ? boundCell({ ...binding, kind: 'sum' }, totalStyleId)
        : { v: '', s: 'total' }
    }
  })
  if (sumKeys.size && !allSummed) {
    const labelColumn = fields.findIndex(field => !sumKeys.has(field.key)) + 1
    cells[sumRow]![labelColumn] = { v: '合计', s: 'total' }
  }
  sheet.cellData = cells
  return template
}

function boundCell(binding: ReportBinding, style: string): ICellData {
  return { v: bindingText(binding), s: style, custom: { reportBinding: binding } }
}
