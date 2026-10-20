import { generateReport, validateTemplate } from '../domain/reportEngine'
import type { DataRow, DataSource, GeneratedReport, ReportTemplate } from '../domain/types'

/** 等待编辑器提交后再校验和取数，确保生成结果使用当前模板。 */
export async function generateFreshReport(
  captureTemplate: () => Promise<ReportTemplate>,
  source: DataSource,
  loadRows: (sourceId: string) => Promise<DataRow[]>,
): Promise<GeneratedReport> {
  const template = await captureTemplate()
  const issues = validateTemplate(template.snapshot, source)
  if (issues.length) throw new Error(issues.join('\n'))
  const rows = await loadRows(source.id)
  return generateReport(template, source, rows)
}

/** 设计状态始终重新生成；预览状态下载当前可见结果。 */
export async function prepareDownloadReport(
  mode: 'design' | 'preview',
  cached: GeneratedReport | undefined,
  createFresh: () => Promise<GeneratedReport>,
): Promise<GeneratedReport> {
  return mode === 'preview' && cached ? cached : await createFresh()
}
