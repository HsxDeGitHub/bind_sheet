import ExcelJS from 'exceljs'
import { describe, expect, it, vi } from 'vitest'
import { firstSheet } from '../src/domain/bindings'
import { createQuickTemplate } from '../src/domain/quickTemplate'
import { generateReport } from '../src/domain/reportEngine'
import { createTemplate } from '../src/domain/template'
import type { DataRow, DataSource } from '../src/domain/types'
import { createExcelWorkbook } from '../src/services/excelExport'
import { generateFreshReport, prepareDownloadReport } from '../src/services/reportWorkflow'

const source: DataSource = {
  id: 'orders-test', name: '测试订单', description: '', recordCount: 1,
  fields: [{ key: 'name', label: '商品', type: 'string' }, { key: 'amount', label: '金额', type: 'number', format: '¥#,##0.00' }],
}

function template(name = '原始报表') {
  return createQuickTemplate({ name, fields: source.fields, sumFieldKeys: ['amount'], defaultSourceId: source.id })
}

describe('生成与下载流程', () => {
  it('从预览返回设计后，即使旧结果仍在，也等待编辑提交并导出新内容', async () => {
    const original = template('旧标题')
    const oldPreview = generateReport(original, source, [{ name: '旧商品', amount: 10 }])
    let commitEditor!: () => void
    const editingFinished = new Promise<void>(resolve => { commitEditor = resolve })
    let committed = false
    let requests = 0
    const pendingDownload = prepareDownloadReport('design', oldPreview, () => generateFreshReport(
      async () => {
        await editingFinished
        committed = true
        return template('修改后的标题')
      },
      source,
      async id => {
        if (!committed) throw new Error('编辑尚未提交，禁止读取数据。')
        if (id !== source.id) throw new Error('数据源选择丢失。')
        requests++
        return [{ name: '新商品', amount: 25.5 }]
      },
    ))
    await Promise.resolve()
    expect(requests).toBe(0)
    commitEditor()
    const latest = await pendingDownload
    const workbook = await createExcelWorkbook(latest.snapshot)
    const exported = new ExcelJS.Workbook()
    await exported.xlsx.load(await workbook.xlsx.writeBuffer())
    expect(exported.worksheets[0]!.getCell('B2').value).toBe('修改后的标题')
    expect(exported.worksheets[0]!.getCell('B6').value).toBe('新商品')
    expect(exported.worksheets[0]!.getCell('C7').value).toBe(25.5)
    expect(firstSheet(oldPreview.snapshot).cellData?.[1]?.[1]?.v).toBe('旧标题')
    expect(requests).toBe(1)
  })

  it('无有效明细或数据源缺字段时，先返回校验错误而不请求数据', async () => {
    const loadRows = vi.fn(async (): Promise<DataRow[]> => { throw new Error('不应请求数据') })
    await expect(generateFreshReport(async () => createTemplate(false), source, loadRows)).rejects.toThrow('请先将数据字段拖入')
    const incompleteSource = { ...source, fields: source.fields.filter(field => field.key !== 'amount') }
    await expect(generateFreshReport(async () => template(), incompleteSource, loadRows)).rejects.toThrow('缺少字段')
    expect(loadRows).not.toHaveBeenCalled()
  })

  it('编辑提交失败时保留原错误且不取数', async () => {
    const loadRows = vi.fn(async () => [] as DataRow[])
    await expect(generateFreshReport(async () => { throw new Error('编辑器提交失败') }, source, loadRows)).rejects.toThrow('编辑器提交失败')
    expect(loadRows).not.toHaveBeenCalled()
  })

  it('预览下载使用正在显示的结果，不重新获取可能已经变化的数据', async () => {
    const visible = generateReport(template(), source, [{ name: '预览中的商品', amount: 12 }])
    const download = await prepareDownloadReport('preview', visible, async () => { throw new Error('预览下载不应重新取数') })
    expect(download).toBe(visible)
    expect(firstSheet(download.snapshot).cellData?.[5]?.[1]?.v).toBe('预览中的商品')
  })

  it('缺少预览缓存时仍可生成并下载，空数据保留明细和零合计', async () => {
    const report = await prepareDownloadReport('preview', undefined, () => generateFreshReport(async () => template(), source, async () => []))
    expect(report.recordCount).toBe(0)
    expect(firstSheet(report.snapshot).cellData?.[5]?.[1]?.v).toBe('')
    expect(firstSheet(report.snapshot).cellData?.[6]?.[2]?.v).toBe(0)
  })

  it('数据读取失败时直接报告错误，不返回旧缓存', async () => {
    const oldPreview = generateReport(template(), source, [{ name: '旧商品', amount: 1 }])
    await expect(prepareDownloadReport('design', oldPreview, () => generateFreshReport(
      async () => template(), source, async () => { throw new Error('数据读取失败') },
    ))).rejects.toThrow('数据读取失败')
  })
})
