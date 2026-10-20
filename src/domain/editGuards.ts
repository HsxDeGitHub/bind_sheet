import type { IRange, IWorkbookData } from '@univerjs/core'
import { address, firstSheet, scanBindings } from './bindings'
import { getDetailAnchorCells, getDetailRow } from './detailRegion'
import type { CellPosition, DataField, LocatedBinding, ReportBinding } from './types'

type BindingPosition = Pick<LocatedBinding, 'row' | 'column'>
export interface DiscreteCellRange { rows: number[]; cols: number[] }

/** Region markers require the same move/copy protection as field metadata. */
export function protectedReportCells(snapshot: IWorkbookData): BindingPosition[] {
  return [...scanBindings(snapshot), ...getDetailAnchorCells(snapshot)]
}

/** Check the real operation footprint, rather than blocking a whole bound workbook. */
export function intersectsBindings(bindings: BindingPosition[], ranges: Array<IRange | undefined | null>) {
  return ranges.some(range => range && bindings.some(binding =>
    binding.row >= range.startRow && binding.row <= range.endRow &&
    binding.column >= range.startColumn && binding.column <= range.endColumn))
}

/** Univer resolves paste size, merged cells and hidden rows before calling the paste hook. */
export function intersectsDiscreteBindings(bindings: BindingPosition[], range: DiscreteCellRange) {
  return bindings.some(binding => range.rows.includes(binding.row) && range.cols.includes(binding.column))
}

export interface BindingTargetAssessment {
  valid: boolean
  message: string
  position: CellPosition
  kind: ReportBinding['kind']
}

/** A drop outside the detail row opens a binding choice instead of rejecting it. */
export function assessBindingTarget(
  snapshot: IWorkbookData, position: CellPosition, field: DataField, requestedKind?: ReportBinding['kind'],
): BindingTargetAssessment {
  const sheet = firstSheet(snapshot)
  const merged = sheet.mergeData?.find(range => position.row >= range.startRow && position.row <= range.endRow &&
    position.column >= range.startColumn && position.column <= range.endColumn)
  const row = merged?.startRow ?? position.row, column = merged?.startColumn ?? position.column
  const normalized = { row, column, address: address(row, column) }
  const detailRow = getDetailRow(snapshot)
  const kind = requestedKind ?? (detailRow === row ? 'detail' : 'single')
  const result = (valid: boolean, message: string): BindingTargetAssessment => ({ valid, message, position: normalized, kind })
  if (row < 0 || column < 0 || row >= (sheet.rowCount ?? 0) || column >= (sheet.columnCount ?? 0)) {
    return result(false, '请将字段拖到工作表内。')
  }
  if (kind === 'detail' && detailRow !== undefined && detailRow !== row) {
    return result(false, `当前明细区域在第 ${detailRow + 1} 行，请先移动明细区域，或将此字段设置为单值。`)
  }
  const effectiveDetailRow = kind === 'detail' ? row : detailRow
  if (merged && merged.startRow !== merged.endRow && effectiveDetailRow !== undefined &&
    effectiveDetailRow >= merged.startRow && effectiveDetailRow <= merged.endRow) {
    return result(false, '纵向合并不能跨越明细区域，请先取消合并，或选择区域外的单元格。')
  }
  if (kind === 'detail' && sheet.mergeData?.some(range => range.startRow !== range.endRow &&
    row >= range.startRow && row <= range.endRow)) {
    return result(false, '此行包含纵向合并，不能作为明细区域；请先取消合并或选择其他行。')
  }
  if (kind === 'sum' && field.type !== 'number') return result(false, '只有数值字段可以设置合计。')
  if (kind === 'sum') return result(true, `${normalized.address} · 所有记录的「${field.label}」求和`)
  if (kind === 'detail') return result(true, `${normalized.address} · 松开后绑定「${field.label}」明细`)
  return result(true, `${normalized.address} · 松开后选择单值、明细${field.type === 'number' ? '或合计' : ''}绑定`)
}
