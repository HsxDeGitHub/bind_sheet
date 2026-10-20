import { describe, expect, it } from 'vitest'
import { bindingText, firstSheet } from '../src/domain/bindings'
import { createTemplate } from '../src/domain/template'
import { collectTemplateIssues } from '../src/domain/validation'
import type { DataSource, ReportBinding } from '../src/domain/types'

const source: DataSource = {
  id: 'test', name: '数据', description: '', recordCount: 0,
  fields: [
    { key: 'orderNo', label: '新名称', type: 'string' },
    { key: 'product', label: '商品名称', type: 'string' },
    { key: 'category', label: '商品分类', type: 'string' },
    { key: 'quantity', label: '数量', type: 'number' },
    { key: 'unitPrice', label: '单价', type: 'number' },
    { key: 'amount', label: '金额', type: 'number' },
  ],
}

describe('可定位的模板问题', () => {
  it('以稳定 key 和类型匹配数据源，标签变化不影响有效模板', () => {
    expect(collectTemplateIssues(createTemplate().snapshot, source)).toEqual([])
  })

  it('无绑定时提示选择绑定类型，不固定落点', () => {
    expect(collectTemplateIssues(createTemplate(false).snapshot)).toContainEqual({
      id: 'no-binding', message: '请先将数据字段拖入单元格，设置明细、单值或合计绑定。', action: 'rebind',
    })
  })

  it('跨行明细逐个定位到需要调整的绑定', () => {
    const template = createTemplate()
    const sheet = firstSheet(template.snapshot)
    sheet.cellData![9] = { 2: structuredClone(sheet.cellData![5]![2]!), 3: structuredClone(sheet.cellData![5]![3]!) }
    const issues = collectTemplateIssues(template.snapshot).filter(issue => issue.id.startsWith('detail-row:'))
    expect(issues).toHaveLength(2)
    expect(issues[0]).toMatchObject({ row: 9, column: 2, action: 'rebind' })
    expect(issues[0]!.message).toContain('同一行')
    expect(issues[1]).toMatchObject({ row: 9, column: 3, action: 'rebind' })
  })

  it('显示内容被改动后定位绑定并允许重新绑定', () => {
    const template = createTemplate()
    firstSheet(template.snapshot).cellData![5]![1]!.v = '意外修改'
    expect(collectTemplateIssues(template.snapshot)).toContainEqual(expect.objectContaining({
      id: 'binding-text:5:1', row: 5, column: 1, action: 'rebind', message: expect.stringContaining('显示内容与绑定不一致'),
    }))
  })

  it('缺失字段和类型错误分别定位所有受影响单元格', () => {
    const template = createTemplate()
    const invalidSource: DataSource = {
      ...source,
      fields: source.fields.filter(field => field.key !== 'amount').map(field => field.key === 'quantity' ? { ...field, type: 'string' } : field),
    }
    const issues = collectTemplateIssues(template.snapshot, invalidSource)
    expect(issues.filter(issue => issue.id.startsWith('missing-field:'))).toEqual([
      expect.objectContaining({ row: 5, column: 6, action: 'rebind', message: expect.stringContaining('缺少字段') }),
      expect.objectContaining({ row: 6, column: 6, action: 'rebind', message: expect.stringContaining('缺少字段') }),
    ])
    expect(issues).toContainEqual(expect.objectContaining({ id: 'field-type:5:4', row: 5, column: 4, action: 'rebind', message: expect.stringContaining('类型不兼容') }))
  })

  it('合计可放在明细上方，类型错误仍定位修复', () => {
    const template = createTemplate()
    const sheet = firstSheet(template.snapshot)
    const sum: ReportBinding = { fieldKey: 'product', fieldLabel: '商品名称', fieldType: 'string', kind: 'sum' }
    sheet.cellData![3] = { 2: { v: bindingText(sum), custom: { reportBinding: sum } } }
    const issues = collectTemplateIssues(template.snapshot)
    expect(issues).toContainEqual(expect.objectContaining({ id: 'sum-type:3:2', row: 3, column: 2, action: 'rebind', message: expect.stringContaining('仅能对数值字段求和') }))
    expect(issues.some(issue => issue.id.startsWith('sum-position:'))).toBe(false)
  })

  it('纵向合并定位左上角并提供取消合并操作，横向合并正常', () => {
    const template = createTemplate()
    const sheet = firstSheet(template.snapshot)
    sheet.mergeData!.push({ startRow: 4, endRow: 5, startColumn: 2, endColumn: 2 })
    sheet.mergeData!.push({ startRow: 5, endRow: 5, startColumn: 3, endColumn: 4 })
    const merges = collectTemplateIssues(template.snapshot).filter(issue => issue.action === 'unmerge')
    expect(merges).toHaveLength(1)
    expect(merges[0]).toMatchObject({ row: 4, column: 2, message: expect.stringContaining('纵向合并') })
  })

  it('手写公式定位到具体单元格，问题标识保持稳定', () => {
    const template = createTemplate()
    firstSheet(template.snapshot).cellData![12] = { 4: { f: '=1+2' } }
    const issues = collectTemplateIssues(template.snapshot)
    expect(issues).toContainEqual(expect.objectContaining({ id: 'formula:12:4', row: 12, column: 4, message: expect.stringContaining('手写公式') }))
    expect(collectTemplateIssues(template.snapshot)).toEqual(issues)
  })

  it('缺失工作表时返回结构化错误而不使面板崩溃', () => {
    const template = createTemplate()
    template.snapshot.sheets = {}
    expect(collectTemplateIssues(template.snapshot)).toEqual([{ id: 'missing-sheet', message: '模板缺少工作表，请新建模板。' }])
    template.snapshot.sheetOrder = []
    expect(collectTemplateIssues(template.snapshot).map(issue => issue.id)).toEqual(['sheet-count', 'missing-sheet'])
  })
})
