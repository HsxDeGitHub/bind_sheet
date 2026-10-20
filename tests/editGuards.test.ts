import { describe, expect, it } from 'vitest'
import { assessBindingTarget, intersectsBindings, intersectsDiscreteBindings, protectedReportCells } from '../src/domain/editGuards'
import { address, firstSheet } from '../src/domain/bindings'
import { createTemplate } from '../src/domain/template'
import type { DataField } from '../src/domain/types'

const text: DataField = { key: 'orderNo', label: '订单编号', type: 'string' }
const number: DataField = { key: 'amount', label: '订单金额', type: 'number' }
const position = (row: number, column: number) => ({ row, column, address: address(row, column) })

describe('绑定区域操作保护', () => {
  const bindings = [{ row: 5, column: 2 }, { row: 8, column: 6 }]
  const range = (startRow: number, endRow: number, startColumn: number, endColumn: number) => ({ startRow, endRow, startColumn, endColumn })

  it('含绑定的模板允许对普通区进行剪切、移动与填充', () => {
    expect(intersectsBindings(bindings, [range(0, 1, 0, 1), range(10, 11, 3, 4)])).toBe(false)
  })
  it('实际源或目标碰到任意绑定时保护操作，包含边界单元格', () => {
    expect(intersectsBindings(bindings, [range(0, 0, 0, 0), range(4, 5, 0, 2)])).toBe(true)
    expect(intersectsBindings(bindings, [range(8, 10, 6, 8), range(0, 0, 0, 0)])).toBe(true)
    expect(intersectsBindings(bindings, [undefined, null])).toBe(false)
  })
  it('粘贴按解析后的扩展目标判断，不局限于当前选中的起点', () => {
    expect(intersectsDiscreteBindings(bindings, { rows: [4], cols: [1] })).toBe(false)
    expect(intersectsDiscreteBindings(bindings, { rows: [4, 5], cols: [1, 2, 3] })).toBe(true)
  })
  it('粘贴隐藏行列构成的离散目标不误伤未覆盖的绑定', () => {
    expect(intersectsDiscreteBindings(bindings, { rows: [4, 6, 7], cols: [1, 2, 6] })).toBe(false)
    expect(intersectsDiscreteBindings(bindings, { rows: [4, 8], cols: [1, 6] })).toBe(true)
  })
})

describe('拖拽落点反馈', () => {
  it('空白模板任意落点可选择用途，显式选择明细可建立区域', () => {
    const blank = createTemplate(false).snapshot
    expect(assessBindingTarget(blank, position(3, 1), text)).toMatchObject({ valid: true, kind: 'single' })
    expect(assessBindingTarget(blank, position(3, 1), text, 'detail')).toMatchObject({ valid: true, kind: 'detail' })
    expect(assessBindingTarget(createTemplate().snapshot, position(5, 2), text)).toMatchObject({ valid: true, kind: 'detail' })
  })
  it('文字和数值字段在明细以外任意行都可放置，不自动推断合计', () => {
    const snapshot = createTemplate().snapshot
    for (const row of [0, 3, 9, 11]) {
      expect(assessBindingTarget(snapshot, position(row, 2), text)).toMatchObject({ valid: true, kind: 'single' })
      expect(assessBindingTarget(snapshot, position(row, 3), number)).toMatchObject({ valid: true, kind: 'single' })
    }
  })
  it('明确选择另一行明细时提示先移动区域，不误建第二条明细行', () => {
    const result = assessBindingTarget(createTemplate().snapshot, position(11, 2), text, 'detail')
    expect(result.valid).toBe(false)
    expect(result.message).toContain('移动明细区域')
    expect(assessBindingTarget(createTemplate().snapshot, position(11, 2), text).valid).toBe(true)
  })
  it('横向合并归一化到左上角，区域外纵向合并允许单值和合计', () => {
    const snapshot = createTemplate().snapshot
    expect(assessBindingTarget(snapshot, position(6, 4), number)).toMatchObject({ valid: true, kind: 'single', position: position(6, 1) })
    firstSheet(snapshot).mergeData!.push({ startRow: 9, endRow: 10, startColumn: 1, endColumn: 2 })
    expect(assessBindingTarget(snapshot, position(10, 2), text, 'single')).toMatchObject({ valid: true, position: position(9, 1) })
    expect(assessBindingTarget(snapshot, position(10, 2), number, 'sum')).toMatchObject({ valid: true })
  })
  it('纵向合并覆盖明细区域时禁止绑定，包括明细行其他列的合并', () => {
    const snapshot = createTemplate().snapshot
    firstSheet(snapshot).mergeData!.push({ startRow: 4, endRow: 6, startColumn: 10, endColumn: 11 })
    expect(assessBindingTarget(snapshot, position(4, 10), number, 'single').valid).toBe(false)
    expect(assessBindingTarget(snapshot, position(6, 10), number, 'sum').valid).toBe(false)
    expect(assessBindingTarget(snapshot, position(5, 2), text, 'detail').valid).toBe(false)
    const blank = createTemplate(false).snapshot
    firstSheet(blank).mergeData!.push({ startRow: 9, endRow: 10, startColumn: 1, endColumn: 2 })
    expect(assessBindingTarget(blank, position(10, 2), text, 'detail').valid).toBe(false)
  })
  it('数值合计无须存在明细区域，且可以放在区域上方和同行', () => {
    const blank = createTemplate(false).snapshot
    expect(assessBindingTarget(blank, position(0, 1), number, 'sum').valid).toBe(true)
    expect(assessBindingTarget(blank, position(6, 1), text, 'sum').valid).toBe(false)
    const snapshot = createTemplate().snapshot
    expect(assessBindingTarget(snapshot, position(3, 1), number, 'sum').valid).toBe(true)
    expect(assessBindingTarget(snapshot, position(5, 1), number, 'sum').valid).toBe(true)
    expect(assessBindingTarget(snapshot, position(5, 1), text, 'single').valid).toBe(true)
  })
  it('空锚点仍定义明细区域，并受到粘贴、剪切和填充保护', () => {
    const snapshot = createTemplate(false).snapshot
    firstSheet(snapshot).cellData = { 11: { 0: { custom: { reportDetailAnchor: true } } } }
    expect(assessBindingTarget(snapshot, position(11, 2), text)).toMatchObject({ valid: true, kind: 'detail' })
    expect(assessBindingTarget(snapshot, position(5, 2), text)).toMatchObject({ valid: true, kind: 'single' })
    const protectedCells = protectedReportCells(snapshot)
    expect(intersectsBindings(protectedCells, [{ startRow: 11, endRow: 11, startColumn: 0, endColumn: 3 }])).toBe(true)
    expect(intersectsDiscreteBindings(protectedCells, { rows: [11], cols: [0] })).toBe(true)
    expect(intersectsDiscreteBindings(protectedCells, { rows: [10], cols: [0] })).toBe(false)
  })
  it('落在工作表外时阻止绑定', () => {
    const snapshot = createTemplate(false).snapshot
    expect(assessBindingTarget(snapshot, position(-1, 2), text).valid).toBe(false)
    expect(assessBindingTarget(snapshot, position(150, 2), text).valid).toBe(false)
    expect(assessBindingTarget(snapshot, position(0, 26), text).valid).toBe(false)
  })
})
