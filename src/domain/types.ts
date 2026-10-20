import type { IWorkbookData } from '@univerjs/core'

export type FieldType = 'string' | 'number' | 'date' | 'boolean'
export interface DataField {
  key: string
  label: string
  type: FieldType
  format?: string
}
export interface DataSource {
  id: string
  name: string
  description: string
  recordCount: number
  fields: DataField[]
}
export type DataValue = string | number | boolean | null
export type DataRow = Record<string, DataValue>
export interface DataSourceService {
  listSources(): Promise<DataSource[]>
  getRows(sourceId: string): Promise<DataRow[]>
}
export interface ReportBinding {
  fieldKey: string
  fieldLabel: string
  fieldType: FieldType
  kind: 'detail' | 'single' | 'sum'
  /** 单值绑定选取的记录下标；省略时取第一条。 */
  recordIndex?: number
}
export interface LocatedBinding extends ReportBinding {
  row: number
  column: number
}
export interface ReportTemplate {
  version: 1
  id?: string
  name: string
  savedAt?: string
  defaultSourceId?: string
  snapshot: IWorkbookData
}
export interface GeneratedReport {
  snapshot: IWorkbookData
  recordCount: number
  sourceName: string
  generatedAt: string
}
export interface CellPosition {
  row: number
  column: number
  address: string
}
