import { describe, expect, it } from 'vitest'
import { firstSheet, getBinding, scanBindings } from '../src/domain/bindings'
import { createQuickTemplate } from '../src/domain/quickTemplate'
import { generateReport } from '../src/domain/reportEngine'
import { collectTemplateIssues } from '../src/domain/validation'
import type { DataField, DataSource } from '../src/domain/types'

const fields: DataField[] = [
  { key: 'amount', label: '金额', type: 'number', format: '¥#,##0.00' },
  { key: 'name', label: '名称', type: 'string' },
  { key: 'quantity', label: '数量', type: 'number', format: '#,##0' },
]
const source: DataSource = { id: 'test-source', name: '测试数据', description: '', recordCount: 2, fields }

describe('快速建表', () => {
  it('保留选择顺序、字段类型与格式，生成可直接展开和汇总的模板', () => {
    const template = createQuickTemplate({ name: ' 自定义报表 ', fields, sumFieldKeys: ['amount', 'quantity'], defaultSourceId: source.id })
    const sheet = firstSheet(template.snapshot)
    const details = scanBindings(template.snapshot).filter(binding => binding.kind === 'detail')
    expect(template.name).toBe('自定义报表')
    expect(template.snapshot.name).toBe('自定义报表')
    expect(template.defaultSourceId).toBe(source.id)
    expect(details.map(binding => binding.fieldKey)).toEqual(['amount', 'name', 'quantity'])
    expect(details.map(binding => binding.row)).toEqual([5, 5, 5])
    expect(sheet.cellData?.[4]?.[1]?.v).toBe('金额')
    expect(sheet.cellData?.[6]?.[2]?.v).toBe('合计')
    expect(getBinding(sheet.cellData?.[6]?.[1])?.fieldKey).toBe('amount')
    expect(collectTemplateIssues(template.snapshot, source)).toEqual([])
    const moneyStyle = template.snapshot.styles![sheet.cellData![5]![1]!.s as string]!
    expect(moneyStyle.n?.pattern).toBe('¥#,##0.00')
    const original = structuredClone(template)
    const report = generateReport(template, source, [{ amount: 0.1, name: '甲', quantity: 0 }, { amount: 0.2, name: '乙', quantity: 3 }])
    const generated = firstSheet(report.snapshot)
    expect(generated.cellData?.[5]?.[1]?.v).toBe(0.1)
    expect(generated.cellData?.[6]?.[2]?.v).toBe('乙')
    expect(generated.cellData?.[7]?.[1]?.v).toBe(0.3)
    expect(generated.cellData?.[7]?.[3]?.v).toBe(3)
    expect(generated.cellData?.[9]?.[1]?.v).toContain('说明')
    expect(template).toEqual(original)
  })

  it('全部字段求和时标签单独成行，首列合计不会被覆盖', () => {
    const numericFields = fields.filter(field => field.type === 'number')
    const template = createQuickTemplate({ name: '合计表', fields: numericFields, sumFieldKeys: ['amount', 'quantity'] })
    const sheet = firstSheet(template.snapshot)
    expect(sheet.cellData?.[6]?.[1]?.v).toBe('合计')
    expect(getBinding(sheet.cellData?.[7]?.[1])?.kind).toBe('sum')
    expect(getBinding(sheet.cellData?.[7]?.[2])?.kind).toBe('sum')
    const generated = firstSheet(generateReport(template, source, []).snapshot)
    expect(generated.cellData?.[7]?.[1]?.v).toBe(0)
    expect(generated.cellData?.[7]?.[2]?.v).toBe(0)
    expect(sheet.mergeData).toContainEqual({ startRow: 6, endRow: 6, startColumn: 1, endColumn: 2 })
  })

  it('支持单字段和不选合计，不创建单单元格合并', () => {
    const template = createQuickTemplate({ name: '', fields: [fields[1]!], sumFieldKeys: [] })
    expect(template.name).toBe('未命名报表')
    expect(scanBindings(template.snapshot)).toHaveLength(1)
    expect(firstSheet(template.snapshot).mergeData).toEqual([])
    expect(collectTemplateIssues(template.snapshot)).toEqual([])
  })

  it.each([2, 11])('明细可从第 %i（0 基）行开始，标题、表头和合计自动避让', detailRow => {
    const template = createQuickTemplate({ name: '指定起始行', fields, sumFieldKeys: ['amount'], detailRow })
    const sheet = firstSheet(template.snapshot)
    expect(scanBindings(template.snapshot).filter(binding => binding.kind === 'detail').map(binding => binding.row)).toEqual([detailRow, detailRow, detailRow])
    expect(sheet.cellData?.[detailRow]?.[0]?.custom?.reportDetailAnchor).toBe(true)
    expect(sheet.cellData?.[detailRow]?.[0]?.v).toBeUndefined()
    expect(sheet.cellData?.[detailRow - 1]?.[1]?.v).toBe('金额')
    expect(sheet.cellData?.[detailRow + 1]?.[2]?.v).toBe('合计')
    expect(getBinding(sheet.cellData?.[detailRow + 1]?.[1])?.kind).toBe('sum')
    const titleRow = detailRow >= 4 ? 1 : 0
    expect(sheet.cellData?.[titleRow]?.[1]?.v).toBe('指定起始行')
    expect(titleRow).toBeLessThan(detailRow - 1)
    expect(sheet.mergeData?.every(merge => merge.startRow !== detailRow && merge.startRow !== detailRow - 1)).toBe(true)
    expect(collectTemplateIssues(template.snapshot, source)).toEqual([])
    const generated = firstSheet(generateReport(template, source, [{ amount: 2, name: '甲', quantity: 1 }, { amount: 3, name: '乙', quantity: 2 }]).snapshot)
    expect(generated.cellData?.[detailRow]?.[1]?.v).toBe(2)
    expect(generated.cellData?.[detailRow + 1]?.[2]?.v).toBe('乙')
    expect(generated.cellData?.[detailRow + 2]?.[1]?.v).toBe(5)
    expect(generated.cellData?.[titleRow]?.[1]?.v).toBe('指定起始行')
  })

  it.each([2, 11])('自选明细行且全字段合计时，合计标签独立成行', detailRow => {
    const numeric = fields.filter(field => field.type === 'number')
    const template = createQuickTemplate({ name: '数值明细', fields: numeric, sumFieldKeys: numeric.map(field => field.key), detailRow })
    const sheet = firstSheet(template.snapshot)
    expect(sheet.cellData?.[detailRow + 1]?.[1]?.v).toBe('合计')
    expect(getBinding(sheet.cellData?.[detailRow + 2]?.[1])?.kind).toBe('sum')
    expect(sheet.mergeData).toContainEqual({ startRow: detailRow + 1, endRow: detailRow + 1, startColumn: 1, endColumn: 2 })
    expect(collectTemplateIssues(template.snapshot, source)).toEqual([])
  })

  it('保持默认第 6 行布局，并拒绝无法放置标题和表头的起始行', () => {
    const create = (detailRow?: number) => createQuickTemplate({ name: '默认布局', fields, sumFieldKeys: [], detailRow })
    const sheet = firstSheet(create().snapshot)
    expect(sheet.cellData?.[1]?.[1]?.v).toBe('默认布局')
    expect(sheet.cellData?.[2]?.[1]?.s).toBe('subtitle')
    expect(sheet.cellData?.[4]?.[1]?.v).toBe('金额')
    expect(sheet.cellData?.[5]?.[0]?.custom?.reportDetailAnchor).toBe(true)
    for (const row of [-1, 0, 1, 2.5, NaN, Infinity]) expect(() => create(row)).toThrow('第 3 行')
    expect(firstSheet(create(200).snapshot).rowCount).toBeGreaterThan(203)
  })

  it('拒绝无字段、重复字段、超过上限和错误合计配置', () => {
    const create = (selected: DataField[], sums: string[] = []) => createQuickTemplate({ name: '测试', fields: selected, sumFieldKeys: sums })
    expect(() => create([])).toThrow('至少选择一个字段')
    expect(() => create([fields[0]!, fields[0]!])).toThrow('不能重复')
    const manyFields = Array.from({ length: 25 }, (_, index): DataField => ({ key: `field-${index}`, label: `字段 ${index}`, type: 'string' }))
    expect(() => create(manyFields)).toThrow('最多选择 24 个字段')
    expect(() => create(fields, ['missing'])).toThrow('来自所选字段')
    expect(() => create(fields, ['name'])).toThrow('不是数值字段')
    const boundary = create(manyFields.slice(0, 24))
    expect(scanBindings(boundary.snapshot).at(-1)?.column).toBe(24)
  })
})
