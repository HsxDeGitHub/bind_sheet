import { afterEach, describe, expect, it } from 'vitest'
import { LocaleType, Univer, type IWorkbookData } from '@univerjs/core'
import { FUniver } from '@univerjs/core/facade'
import { UniverSheetsPlugin } from '@univerjs/sheets'
import zhCN from '@univerjs/sheets/locale/zh-CN'
import '@univerjs/sheets/facade'
import { firstSheet, getBinding, scanBindings } from '../src/domain/bindings'
import { getDetailAnchorCells, getDetailRow } from '../src/domain/detailRegion'
import { createTemplate } from '../src/domain/template'

const instances: Univer[] = []
afterEach(() => { instances.splice(0).forEach(instance => instance.dispose()) })
function editor(snapshot: IWorkbookData) {
  const instance = new Univer({ locale: LocaleType.ZH_CN, locales: { [LocaleType.ZH_CN]: zhCN } })
  instances.push(instance)
  instance.registerPlugin(UniverSheetsPlugin)
  const api = FUniver.newAPI(instance)
  return api.createWorkbook(structuredClone(snapshot))
}

/** Exercise the installed Univer row move and undo stack rather than a mock grid. */
describe('真实编辑器明细整行移动', () => {
  it.each([0, 11])('从第 6 行移到最终第 %i 行索引，保留元数据、行高、样式、页脚和合并，支持撤销重做', row => {
    const template = createTemplate().snapshot
    const before = firstSheet(template)
    before.cellData![5]![8] = { v: '行内备注', s: 'detail' }
    before.mergeData!.push({ startRow: 5, endRow: 5, startColumn: 8, endColumn: 9 })
    const workbook = editor(template)
    const sheet = workbook.getActiveSheet()
    const original = workbook.save()
    sheet.moveRows(sheet.getRange(5, 0, 1, 26), row > 5 ? row + 1 : row)
    const moved = workbook.save()
    const movedSheet = firstSheet(moved)
    expect(getDetailRow(moved)).toBe(row)
    expect(getDetailAnchorCells(moved)).toEqual([{ row, column: 1 }])
    expect(scanBindings(moved).filter(binding => binding.kind === 'detail')).toHaveLength(6)
    expect(movedSheet.rowData?.[row]?.h).toBe(42)
    expect(movedSheet.cellData?.[row]?.[1]?.s).toEqual(firstSheet(original).cellData?.[5]?.[1]?.s)
    expect(movedSheet.cellData?.[row]?.[8]?.v).toBe('行内备注')
    expect(movedSheet.mergeData).toContainEqual(expect.objectContaining({ startRow: row, endRow: row, startColumn: 8, endColumn: 9 }))
    const footerRow = row > 5 ? 5 : 6
    expect(movedSheet.cellData?.[footerRow]?.[1]?.v).toBe('金额合计')
    expect(getBinding(movedSheet.cellData?.[footerRow]?.[6])?.kind).toBe('sum')
    expect(movedSheet.mergeData).toContainEqual(expect.objectContaining({ startRow: footerRow, endRow: footerRow, startColumn: 1, endColumn: 5 }))
    workbook.undo()
    expect(getDetailRow(workbook.save())).toBe(5)
    expect(firstSheet(workbook.save()).cellData).toEqual(firstSheet(original).cellData)
    expect(firstSheet(workbook.save()).rowData?.[5]?.h).toBe(42)
    expect(firstSheet(workbook.save()).mergeData).toContainEqual(expect.objectContaining({ startRow: 6, endRow: 6, startColumn: 1, endColumn: 5 }))
    workbook.redo()
    expect(getDetailRow(workbook.save())).toBe(row)
  })

  it('无字段的明细锚点跟随插入、整行移动和删除，撤销后恢复', () => {
    const snapshot = createTemplate(false).snapshot
    firstSheet(snapshot).cellData = { 11: { 0: { custom: { reportDetailAnchor: true } } } }
    const workbook = editor(snapshot)
    const sheet = workbook.getActiveSheet()
    sheet.insertRowsBefore(3, 1)
    expect(getDetailRow(workbook.save())).toBe(12)
    sheet.moveRows(sheet.getRange(12, 0, 1, 26), 0)
    expect(getDetailRow(workbook.save())).toBe(0)
    sheet.deleteRows(0, 1)
    expect(getDetailRow(workbook.save())).toBeUndefined()
    workbook.undo()
    expect(getDetailRow(workbook.save())).toBe(0)
    workbook.undo()
    expect(getDetailRow(workbook.save())).toBe(12)
    workbook.undo()
    expect(getDetailRow(workbook.save())).toBe(11)
  })

  it('同一批稀疏单元格元数据清理可撤销，区域外单值、合计和明细行内样式保留', () => {
    const snapshot = createTemplate().snapshot
    const data = firstSheet(snapshot)
    const single = { fieldKey: 'product', fieldLabel: '商品名称', fieldType: 'string' as const, kind: 'single' as const, recordIndex: 1 }
    data.cellData![0] = { 1: { v: '单值：商品名称', custom: { reportBinding: single } } }
    data.cellData![5]![8] = { v: '行内说明', s: 'detail' }
    const workbook = editor(snapshot)
    const sheet = workbook.getActiveSheet()
    const original = workbook.save()
    const updates = Object.fromEntries([1, 2, 3, 4, 5, 6].map(column => [column, { v: '', p: null, f: null, custom: {} }]))
    sheet.getRange(5, 1, 1, 6).setValues({ 5: updates })
    expect(getDetailRow(workbook.save())).toBeUndefined()
    expect(getDetailAnchorCells(workbook.save())).toHaveLength(0)
    expect(scanBindings(workbook.save()).map(binding => binding.kind)).toEqual(['single', 'sum'])
    expect(getBinding(firstSheet(workbook.save()).cellData?.[0]?.[1])?.recordIndex).toBe(1)
    expect(firstSheet(workbook.save()).cellData?.[5]?.[1]?.s).toEqual(firstSheet(original).cellData?.[5]?.[1]?.s)
    expect(firstSheet(workbook.save()).cellData?.[5]?.[8]?.v).toBe('行内说明')
    workbook.undo()
    expect(getDetailRow(workbook.save())).toBe(5)
    expect(scanBindings(workbook.save()).filter(binding => binding.kind === 'detail')).toHaveLength(6)
    expect(getDetailAnchorCells(workbook.save())).toEqual([{ row: 5, column: 1 }])
  })

  it('旧模板无锚点时可直接整行移动，并按随行的明细绑定推导位置', () => {
    const snapshot = createTemplate().snapshot
    delete firstSheet(snapshot).cellData![5]![1]!.custom!.reportDetailAnchor
    const workbook = editor(snapshot)
    const sheet = workbook.getActiveSheet()
    sheet.moveRows(sheet.getRange(5, 0, 1, 26), 12)
    expect(getDetailAnchorCells(workbook.save())).toHaveLength(0)
    expect(getDetailRow(workbook.save())).toBe(11)
    workbook.undo()
    expect(getDetailRow(workbook.save())).toBe(5)
  })
})
