import type { IWorkbookData } from '@univerjs/core'
import { cellEntries, firstSheet, scanBindings } from './bindings'

/** 锚点随单元格插入、删除及移动，不另外保存明细行坐标。 */
export function getDetailAnchorCells(snapshot: IWorkbookData): { row: number; column: number }[] {
  const anchors: { row: number; column: number }[] = []
  for (const [row, cells] of Object.entries(firstSheet(snapshot).cellData ?? {})) {
    for (const [column, cell] of cellEntries(cells)) {
      if (cell.custom?.reportDetailAnchor === true) anchors.push({ row: Number(row), column: Number(column) })
    }
  }
  return anchors.sort((a, b) => a.row - b.row || a.column - b.column)
}

/** 旧模板没有锚点时，按当前明细绑定推导，兼容已有本地模板。 */
export function getDetailRow(snapshot: IWorkbookData): number | undefined {
  return getDetailAnchorCells(snapshot)[0]?.row ?? scanBindings(snapshot).find(binding => binding.kind === 'detail')?.row
}
