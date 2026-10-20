import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { createTemplate } from '../src/domain/template'
import { bindingText, firstSheet, scanBindings } from '../src/domain/bindings'
import { generateReport, validateTemplate } from '../src/domain/reportEngine'
import { dataSourceService } from '../src/services/dataSource'
import { createExcelWorkbook } from '../src/services/excelExport'
import type { DataSource, ReportBinding } from '../src/domain/types'

async function fixture() {
  const sources = await dataSourceService.listSources()
  const source = sources[0]!
  return { template: createTemplate(), source, rows: await dataSourceService.getRows(source.id), sources }
}

describe('报表生成', () => {
  it('展开明细、继承样式、平移页脚与合并区域，同时保留原模板', async () => {
    const { template, source, rows } = await fixture()
    const original = structuredClone(template)
    const report = generateReport(template, source, rows)
    const sheet = firstSheet(report.snapshot)
    expect(sheet.cellData?.[5]?.[1]?.v).toBe(rows[0]!.orderNo)
    expect(sheet.cellData?.[16]?.[1]?.v).toBe(rows[11]!.orderNo)
    expect(sheet.cellData?.[16]?.[6]?.s).toBe('money')
    expect(sheet.rowData?.[16]?.h).toBe(42)
    expect(sheet.cellData?.[17]?.[6]?.v).toBeCloseTo(rows.reduce((sum, row) => sum + Number(row.amount), 0))
    expect(sheet.cellData?.[19]?.[1]?.v).toContain('说明')
    expect(sheet.mergeData).toContainEqual({ startRow: 17, endRow: 17, startColumn: 1, endColumn: 5 })
    expect(scanBindings(report.snapshot)).toHaveLength(0)
    expect(template).toEqual(original)
  })

  it('同一模板切换数据源后使用新的数据和行数', async () => {
    const { template, source, rows, sources } = await fixture()
    const first = generateReport(template, source, rows)
    const secondSource = sources[1]!
    const secondRows = await dataSourceService.getRows(secondSource.id)
    const second = generateReport(template, secondSource, secondRows)
    expect(first.recordCount).toBe(12)
    expect(second.recordCount).toBe(26)
    expect(firstSheet(second.snapshot).cellData?.[5]?.[1]?.v).toBe(secondRows[0]!.orderNo)
    expect(firstSheet(second.snapshot).cellData?.[31]?.[6]?.v).toBeGreaterThan(0)
    expect(scanBindings(template.snapshot)).toHaveLength(7)
  })

  it('空数据保留一条空行，合计为零且页脚不移动', async () => {
    const { template, source } = await fixture()
    const report = generateReport(template, source, [])
    expect(report.recordCount).toBe(0)
    expect(firstSheet(report.snapshot).cellData?.[5]?.[1]?.v).toBe('')
    expect(firstSheet(report.snapshot).cellData?.[6]?.[6]?.v).toBe(0)
    expect(firstSheet(report.snapshot).mergeData).toEqual(firstSheet(template.snapshot).mergeData)
  })

  it('保留零值、前导零和文本，空值留空；十进制合计精确', async () => {
    const { template, source } = await fixture()
    const rows = [
      { orderNo: '00001', product: '=SUM(A1)', category: null, quantity: 0, unitPrice: null, amount: 0.1 },
      { orderNo: '00002', product: '测试', category: '测试', quantity: 1, unitPrice: 0.2, amount: 0.2 },
    ]
    const sheet = firstSheet(generateReport(template, source, rows).snapshot)
    expect(sheet.cellData?.[5]?.[1]?.v).toBe('00001')
    expect(sheet.cellData?.[5]?.[2]?.v).toBe('=SUM(A1)')
    expect(sheet.cellData?.[5]?.[2]?.f).toBeUndefined()
    expect(sheet.cellData?.[5]?.[3]?.v).toBe('')
    expect(sheet.cellData?.[5]?.[4]?.v).toBe(0)
    expect(sheet.cellData?.[7]?.[6]?.v).toBe(0.3)
  })

  it('字段缺失或类型不兼容时拒绝生成', async () => {
    const { template, source } = await fixture()
    const missing: DataSource = { ...source, fields: source.fields.filter(f => f.key !== 'amount') }
    expect(() => generateReport(template, missing, [])).toThrow('缺少字段')
    const incompatible = { ...source, fields: source.fields.map(f => f.key === 'quantity' ? { ...f, type: 'string' as const } : f) }
    expect(() => generateReport(template, incompatible, [])).toThrow('类型不兼容')
    expect(() => generateReport(template, source, [{ amount: '123' }])).toThrow('类型不正确')
    expect(() => generateReport(template, source, [{ amount: Number.NaN }])).toThrow('类型不正确')
  })

  it('阻止多明细行、跨明细纵向合并和手写公式，允许任意合计位置', async () => {
    const { template, source } = await fixture()
    const sheet = firstSheet(template.snapshot)
    const copy = structuredClone(sheet.cellData![5]![1]!)
    sheet.cellData![10] = { 1: copy }
    expect(validateTemplate(template.snapshot, source).join()).toContain('同一行')
    delete sheet.cellData![10]
    sheet.mergeData!.push({ startRow: 4, endRow: 5, startColumn: 1, endColumn: 1 })
    expect(validateTemplate(template.snapshot).join()).toContain('纵向合并')
    sheet.mergeData!.pop()
    sheet.cellData![3] = { 6: structuredClone(sheet.cellData![6]![6]!) }
    expect(validateTemplate(template.snapshot)).toEqual([])
    delete sheet.cellData![3]
    sheet.cellData![10] = { 1: { f: '=SUM(G6:G7)' } }
    expect(validateTemplate(template.snapshot).join()).toContain('手写公式')
  })

  it('根据快照的当前位置扫描绑定，不使用原始模板行号', async () => {
    const { template, source, rows } = await fixture()
    const sheet = firstSheet(template.snapshot)
    const shifted: typeof sheet.cellData = {}
    for (const [row, cells] of Object.entries(sheet.cellData!)) shifted[Number(row) + 2] = cells
    sheet.cellData = shifted
    sheet.mergeData = sheet.mergeData!.map(m => ({ ...m, startRow: m.startRow + 2, endRow: m.endRow + 2 }))
    expect(scanBindings(template.snapshot).find(b => b.kind === 'detail')!.row).toBe(7)
    const report = generateReport(template, source, rows)
    expect(firstSheet(report.snapshot).cellData?.[7]?.[1]?.v).toBe(rows[0]!.orderNo)
    expect(firstSheet(report.snapshot).cellData?.[19]?.[6]?.v).toBeGreaterThan(0)
  })

  it('删除整个明细行后允许剩余合计生成，修改绑定标识仍会拦截', async () => {
    const { template } = await fixture()
    firstSheet(template.snapshot).cellData![5]![1]!.v = '普通文字'
    expect(validateTemplate(template.snapshot).join()).toContain('显示内容与绑定不一致')
    delete firstSheet(template.snapshot).cellData![5]
    expect(validateTemplate(template.snapshot)).toEqual([])
  })

  it('明细行内的横向合并随每条记录复制', async () => {
    const template = createTemplate(false)
    const source: DataSource = { id: 'test', name: '测试', description: '', recordCount: 2, fields: [{ key: 'name', label: '名称', type: 'string' }] }
    const binding: ReportBinding = { fieldKey: 'name', fieldLabel: '名称', fieldType: 'string', kind: 'detail' }
    const sheet = firstSheet(template.snapshot)
    sheet.cellData = { 2: { 1: { v: bindingText(binding), custom: { reportBinding: binding } } } }
    sheet.mergeData = [{ startRow: 2, endRow: 2, startColumn: 1, endColumn: 3 }]
    const result = firstSheet(generateReport(template, source, [{ name: '一' }, { name: '二' }]).snapshot)
    expect(result.mergeData).toEqual([
      { startRow: 2, endRow: 2, startColumn: 1, endColumn: 3 },
      { startRow: 3, endRow: 3, startColumn: 1, endColumn: 3 },
    ])
  })
})

describe('Excel 文件导出', () => {
  it('写出并重新读取 xlsx，保留值、合计、样式、合并和行列尺寸', async () => {
    const { template, source, rows } = await fixture()
    const report = generateReport(template, source, rows)
    const exported = await createExcelWorkbook(report.snapshot)
    const bytes = await exported.xlsx.writeBuffer()
    const loaded = new ExcelJS.Workbook()
    await loaded.xlsx.load(bytes)
    const sheet = loaded.worksheets[0]!
    expect(sheet.getCell('B6').value).toBe(rows[0]!.orderNo)
    expect(sheet.getCell('G18').value).toBe(firstSheet(report.snapshot).cellData?.[17]?.[6]?.v)
    expect(sheet.getCell('B2').font).toMatchObject({ bold: true, size: 23, color: { argb: 'FF203C35' } })
    expect(sheet.getCell('B5').fill).toMatchObject({ type: 'pattern', fgColor: { argb: 'FFE7F2ED' } })
    expect(sheet.getCell('G6').numFmt).toBe('¥#,##0.00')
    expect(sheet.getCell('G6').alignment.horizontal).toBe('right')
    expect(sheet.getCell('G6').border.bottom?.style).toBe('thin')
    expect(sheet.getCell('F18').master.address).toBe('B18')
    expect(sheet.getRow(6).height).toBe(31.5)
    expect(sheet.getColumn('B').width).toBeCloseTo((128 - 5) / 7)
  })

  it('以等号开头的数据导出为字符串，数字和前导零不混淆', async () => {
    const { template, source } = await fixture()
    const report = generateReport(template, source, [{ orderNo: '00001', product: '=1+1', quantity: 0, amount: 0 }])
    const book = await createExcelWorkbook(report.snapshot)
    const loaded = new ExcelJS.Workbook()
    await loaded.xlsx.load(await book.xlsx.writeBuffer())
    expect(loaded.worksheets[0]!.getCell('B6').value).toBe('00001')
    expect(loaded.worksheets[0]!.getCell('C6').value).toBe('=1+1')
    expect(loaded.worksheets[0]!.getCell('E6').value).toBe(0)
  })
})
