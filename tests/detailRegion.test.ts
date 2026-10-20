import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { bindingText, firstSheet, getBinding, scanBindings } from '../src/domain/bindings'
import { getDetailAnchorCells, getDetailRow } from '../src/domain/detailRegion'
import { generateReport, validateTemplate } from '../src/domain/reportEngine'
import { createTemplate } from '../src/domain/template'
import { collectTemplateIssues } from '../src/domain/validation'
import { useDesignerStore } from '../src/stores/designer'
import type { DataSource, ReportBinding } from '../src/domain/types'

const source: DataSource = {
  id: 'test', name: '测试数据', description: '', recordCount: 3,
  fields: [{ key: 'name', label: '名称', type: 'string' }, { key: 'amount', label: '金额', type: 'number' }],
}
const rows = [{ name: '甲', amount: 0.1 }, { name: '乙', amount: 0.2 }, { name: '丙', amount: 0 }]
const detail: ReportBinding = { fieldKey: 'name', fieldLabel: '名称', fieldType: 'string', kind: 'detail' }
const single: ReportBinding = { ...detail, kind: 'single', recordIndex: 1 }
const sum: ReportBinding = { fieldKey: 'amount', fieldLabel: '金额', fieldType: 'number', kind: 'sum' }
const boundCell = (binding: ReportBinding, anchor = false) => ({
  v: bindingText(binding), s: 'detail', custom: { reportBinding: binding, ...(anchor ? { reportDetailAnchor: true } : {}) },
})

function fixture(row = 11) {
  const template = createTemplate(false)
  const sheet = firstSheet(template.snapshot)
  sheet.cellData = { [row]: { 1: boundCell(detail, true) } }
  return { template, sheet }
}

describe('明细区域定位与兼容', () => {
  it('示例有唯一锚点；空白模板没有预设明细行', () => {
    expect(getDetailAnchorCells(createTemplate().snapshot)).toEqual([{ row: 5, column: 1 }])
    expect(getDetailRow(createTemplate(false).snapshot)).toBeUndefined()
  })

  it('显式锚点优先；无锚点的旧模板按当前绑定推导', () => {
    const { template, sheet } = fixture(12)
    delete sheet.cellData![12]![1]!.custom!.reportDetailAnchor
    expect(getDetailAnchorCells(template.snapshot)).toEqual([])
    expect(getDetailRow(template.snapshot)).toBe(12)
    sheet.cellData![2] = { 4: { custom: { reportDetailAnchor: true } } }
    expect(getDetailRow(template.snapshot)).toBe(2)
    expect(collectTemplateIssues(template.snapshot)).toContainEqual(expect.objectContaining({ id: 'detail-row:12:1' }))
  })

  it('插入删除行列后锚点跟随快照单元格，存储不依赖旧坐标', () => {
    const { template, sheet } = fixture(3)
    sheet.cellData = { 7: { 6: sheet.cellData![3]![1]! } }
    expect(getDetailAnchorCells(template.snapshot)).toEqual([{ row: 7, column: 6 }])
    const result = firstSheet(generateReport(template, source, rows).snapshot)
    expect(result.cellData?.[7]?.[6]?.v).toBe('甲')
    expect(result.cellData?.[9]?.[6]?.v).toBe('丙')
    delete sheet.cellData![7]
    expect(getDetailRow(template.snapshot)).toBeUndefined()
    expect(validateTemplate(template.snapshot).join()).toContain('拖入单元格')
  })

  it('多锚点和已设但没有明细字段的区域均有可定位错误', () => {
    const { template, sheet } = fixture(9)
    sheet.cellData![9]![2] = { custom: { reportDetailAnchor: true } }
    expect(collectTemplateIssues(template.snapshot)).toContainEqual(expect.objectContaining({ id: 'detail-anchor-count', row: 9, column: 2 }))
    delete sheet.cellData![9]![2]
    sheet.cellData![9]![1] = { custom: { reportDetailAnchor: true } }
    expect(collectTemplateIssues(template.snapshot)).toEqual([expect.objectContaining({ id: 'no-detail', row: 9, column: 1, message: expect.stringContaining('第 10 行') })])
  })

  it('Store 明细行同步显式区域，不需要先绑定字段', () => {
    setActivePinia(createPinia())
    const store = useDesignerStore()
    const template = createTemplate(false)
    firstSheet(template.snapshot).cellData = { 20: { 3: { custom: { reportDetailAnchor: true } } } }
    store.template = template
    expect(store.detailRow).toBe(20)
    store.template = createTemplate(false)
    expect(store.detailRow).toBeUndefined()
  })
})

describe('自由位置单值与合计生成', () => {
  it.each([0, 2, 11, 24])('明细可从第 %i 行开始，前后的单值与合计保持语义', row => {
    const { template, sheet } = fixture(row)
    if (row > 0) sheet.cellData![row - 1] = { 1: boundCell(single), 2: boundCell(sum) }
    sheet.cellData![row + 1] = { 1: boundCell({ ...single, recordIndex: 2 }), 2: boundCell(sum) }
    sheet.rowData = { [row]: { h: 37 }, [row + 1]: { h: 51 } }
    sheet.mergeData = [{ startRow: row + 1, endRow: row + 1, startColumn: 1, endColumn: 1 }]
    const original = structuredClone(template)
    const result = firstSheet(generateReport(template, source, rows).snapshot)
    expect(result.cellData?.[row]?.[1]?.v).toBe('甲')
    expect(result.cellData?.[row + 2]?.[1]?.v).toBe('丙')
    expect(result.cellData?.[row + 3]?.[1]?.v).toBe('丙')
    expect(result.cellData?.[row + 3]?.[2]?.v).toBe(0.3)
    expect(result.rowData?.[row + 2]?.h).toBe(37)
    expect(result.rowData?.[row + 3]?.h).toBe(51)
    expect(result.mergeData?.[0]?.startRow).toBe(row + 3)
    if (row > 0) {
      expect(result.cellData?.[row - 1]?.[1]?.v).toBe('乙')
      expect(result.cellData?.[row - 1]?.[2]?.v).toBe(0.3)
    }
    expect(template).toEqual(original)
    expect(scanBindings({ ...template.snapshot, sheets: { [template.snapshot.sheetOrder[0]!]: result } })).toEqual([])
    expect(getDetailAnchorCells({ ...template.snapshot, sheets: { [template.snapshot.sheetOrder[0]!]: result } })).toEqual([])
  })

  it('明细行上的单值与合计随行重复，仍取固定记录或全量合计', () => {
    const { template, sheet } = fixture(2)
    sheet.cellData![2]![2] = boundCell(single)
    sheet.cellData![2]![3] = boundCell(sum)
    const result = firstSheet(generateReport(template, source, rows).snapshot)
    for (const row of [2, 3, 4]) {
      expect(result.cellData?.[row]?.[2]?.v).toBe('乙')
      expect(result.cellData?.[row]?.[3]?.v).toBe(0.3)
    }
  })

  it('无明细的单值及合计模板不展开，允许纵向合并及自定义元数据', () => {
    const template = createTemplate(false)
    const sheet = firstSheet(template.snapshot)
    sheet.cellData = {
      0: { 0: { ...boundCell(single), custom: { reportBinding: single, businessTag: 'keep' } } },
      8: { 4: boundCell(sum) },
    }
    sheet.rowData = { 8: { h: 50 } }
    sheet.mergeData = [{ startRow: 0, endRow: 2, startColumn: 0, endColumn: 2 }]
    const original = structuredClone(template)
    const result = firstSheet(generateReport(template, source, rows).snapshot)
    expect(result.cellData?.[0]?.[0]?.v).toBe('乙')
    expect(result.cellData?.[0]?.[0]?.custom).toEqual({ businessTag: 'keep' })
    expect(result.cellData?.[8]?.[4]?.v).toBe(0.3)
    expect(result.rowCount).toBe(sheet.rowCount)
    expect(result.rowData).toEqual(sheet.rowData)
    expect(result.mergeData).toEqual(sheet.mergeData)
    expect(template).toEqual(original)
  })

  it.each(['single', 'sum'] as const)('仅 %s 绑定也可生成', kind => {
    const template = createTemplate(false)
    firstSheet(template.snapshot).cellData = { 14: { 9: boundCell(kind === 'single' ? single : sum) } }
    expect(validateTemplate(template.snapshot, source)).toEqual([])
    expect(firstSheet(generateReport(template, source, rows).snapshot).cellData?.[14]?.[9]?.v).toBe(kind === 'single' ? '乙' : 0.3)
  })

  it('单值默认取首条，空数据及越界留空；空合计为 0', () => {
    const template = createTemplate(false)
    firstSheet(template.snapshot).cellData = { 1: {
      1: boundCell({ ...single, recordIndex: undefined }),
      2: boundCell({ ...single, recordIndex: 100 }),
      3: boundCell(sum),
    } }
    const result = firstSheet(generateReport(template, source, rows).snapshot)
    expect(result.cellData?.[1]?.[1]?.v).toBe('甲')
    expect(result.cellData?.[1]?.[2]?.v).toBe('')
    const empty = firstSheet(generateReport(template, source, []).snapshot)
    expect(empty.cellData?.[1]?.[1]?.v).toBe('')
    expect(empty.cellData?.[1]?.[2]?.v).toBe('')
    expect(empty.cellData?.[1]?.[3]?.v).toBe(0)
  })

  it('单值保留 null/零/布尔值语义，仅校验被引用记录', () => {
    const template = createTemplate(false)
    const selected: ReportBinding = { ...sum, kind: 'single', recordIndex: 1 }
    firstSheet(template.snapshot).cellData = { 0: { 0: boundCell(selected) } }
    expect(firstSheet(generateReport(template, source, [{ amount: '未被引用' }, { amount: 0 }]).snapshot).cellData?.[0]?.[0]?.v).toBe(0)
    expect(firstSheet(generateReport(template, source, [{ amount: 8 }, { amount: null }]).snapshot).cellData?.[0]?.[0]?.v).toBe('')
    expect(() => generateReport(template, source, [{ amount: 8 }, { amount: '非法值' }])).toThrow('第 2 条记录')
    const booleanSource: DataSource = { ...source, fields: [{ key: 'enabled', label: '启用', type: 'boolean' }] }
    firstSheet(template.snapshot).cellData = { 0: { 0: boundCell({ fieldKey: 'enabled', fieldLabel: '启用', fieldType: 'boolean', kind: 'single' }) } }
    expect(firstSheet(generateReport(template, booleanSource, [{ enabled: false }]).snapshot).cellData?.[0]?.[0]?.v).toBe(false)
  })

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])('单值非法记录下标 %s 会定位错误', recordIndex => {
    const template = createTemplate(false)
    firstSheet(template.snapshot).cellData = { 3: { 2: boundCell({ ...single, recordIndex }) } }
    expect(collectTemplateIssues(template.snapshot)).toContainEqual(expect.objectContaining({ id: 'single-record-index:3:2', row: 3, column: 2 }))
    expect(() => generateReport(template, source, rows)).toThrow('记录序号')
  })

  it('单值标识明确显示取值记录，跨明细纵向合并仍拦截', () => {
    expect(bindingText(single)).toContain('第 2 条')
    expect(getBinding(boundCell(single))).toEqual(single)
    const { template, sheet } = fixture(7)
    sheet.cellData![1] = { 1: boundCell(single) }
    sheet.mergeData = [{ startRow: 1, endRow: 3, startColumn: 1, endColumn: 1 }]
    expect(validateTemplate(template.snapshot)).toEqual([])
    sheet.mergeData.push({ startRow: 6, endRow: 7, startColumn: 4, endColumn: 4 })
    expect(validateTemplate(template.snapshot).join()).toContain('纵向合并')
  })
})
