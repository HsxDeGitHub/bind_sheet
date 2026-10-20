import type { IWorkbookData } from '@univerjs/core'
import { address, bindingText, cellEntries, firstSheet, scanBindings } from './bindings'
import { getDetailAnchorCells, getDetailRow } from './detailRegion'
import type { DataSource } from './types'

export interface ReportIssue {
  id: string
  message: string
  row?: number
  column?: number
  action?: 'rebind' | 'unmerge' | 'select-detail'
}

/** 结构化校验结果用于定位及修复，也作为生成前校验的唯一规则来源。 */
export function collectTemplateIssues(snapshot: IWorkbookData, source?: DataSource): ReportIssue[] {
  const issues: ReportIssue[] = []
  if (snapshot.sheetOrder.length !== 1) issues.push({ id: 'sheet-count', message: '首版仅支持一张工作表。' })
  if (!snapshot.sheets[snapshot.sheetOrder[0]!]) {
    issues.push({ id: 'missing-sheet', message: '模板缺少工作表，请新建模板。' })
    return issues
  }
  const sheet = firstSheet(snapshot)
  const bindings = scanBindings(snapshot)
  const details = bindings.filter(binding => binding.kind === 'detail')
  const anchors = getDetailAnchorCells(snapshot)
  const detailRow = getDetailRow(snapshot)
  for (const [key, cells] of Object.entries(sheet.cellData ?? {})) {
    const row = Number(key)
    for (const [col, cell] of cellEntries(cells)) {
      const column = Number(col)
      if (cell.f) issues.push({
        id: `formula:${row}:${column}`, row, column,
        message: `${address(row, column)} 使用了手写公式；首版请使用字段合计或固定值。`,
      })
    }
  }
  if (anchors.length > 1) issues.push({
    id: 'detail-anchor-count', ...anchors[1], action: 'select-detail',
    message: '模板存在多个明细区域标记，请重新设置一个明细区域。',
  })
  if (anchors.length && !details.length) issues.push({
    id: 'no-detail', ...anchors[0], action: 'select-detail',
    message: `请为第 ${detailRow! + 1} 行明细区域添加明细字段，或取消明细区域。`,
  })
  else if (!bindings.length) issues.push({
    id: 'no-binding', action: 'rebind',
    message: '请先将数据字段拖入单元格，设置明细、单值或合计绑定。',
  })
  for (const binding of details) {
    if (binding.row !== detailRow) issues.push({
      id: `detail-row:${binding.row}:${binding.column}`, row: binding.row, column: binding.column, action: 'rebind',
      message: `${address(binding.row, binding.column)} 的明细字段必须位于同一行；请移动明细区域，或将该绑定改为单值。`,
    })
  }
  for (const binding of bindings) {
    const { row, column } = binding
    const at = address(row, column)
    const problem = (rule: string, message: string) => issues.push({ id: `${rule}:${row}:${column}`, row, column, action: 'rebind', message })
    const cell = sheet.cellData?.[row]?.[column]
    if (cell?.v !== bindingText(binding)) problem('binding-text', `${at} 的显示内容与绑定不一致，请重新绑定。`)
    if (binding.kind === 'sum' && binding.fieldType !== 'number') problem('sum-type', `${at} 仅能对数值字段求和。`)
    if (binding.kind === 'single' && (!Number.isInteger(binding.recordIndex ?? 0) || (binding.recordIndex ?? 0) < 0)) {
      problem('single-record-index', `${at} 的单值记录序号必须为大于或等于 1 的整数，请重新选择记录。`)
    }
    if (source) {
      const field = source.fields.find(candidate => candidate.key === binding.fieldKey)
      if (!field) problem('missing-field', `${at} 数据源缺少字段「${binding.fieldLabel}」。`)
      else if (field.type !== binding.fieldType) problem('field-type', `${at} 字段「${binding.fieldLabel}」类型不兼容。`)
    }
  }
  const detailRows = new Set([...details.map(binding => binding.row), ...anchors.map(anchor => anchor.row)])
  for (const merge of sheet.mergeData ?? []) {
    if (merge.startRow !== merge.endRow && [...detailRows].some(row => merge.startRow <= row && merge.endRow >= row)) {
      issues.push({
        id: `vertical-merge:${merge.startRow}:${merge.startColumn}:${merge.endRow}:${merge.endColumn}`,
        row: merge.startRow, column: merge.startColumn, action: 'unmerge',
        message: `${address(merge.startRow, merge.startColumn)} 的明细行不能与上下行纵向合并，请先取消该合并。`,
      })
    }
  }
  return issues
}
