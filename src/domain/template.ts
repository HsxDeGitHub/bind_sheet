import { LocaleType, type ICellData, type IWorkbookData, type IStyleData } from '@univerjs/core'
import { bindingText } from './bindings'
import type { ReportBinding, ReportTemplate } from './types'

const line = { s: 1, cl: { rgb: '#DDE5E2' } }
const styles: Record<string, IStyleData> = {
  title: { fs: 23, bl: 1, cl: { rgb: '#203C35' }, vt: 2 },
  subtitle: { fs: 10, cl: { rgb: '#84918C' }, vt: 2 },
  header: { fs: 11, bl: 1, bg: { rgb: '#E7F2ED' }, cl: { rgb: '#28624F' }, vt: 2, ht: 1, pd: { l: 12 }, bd: { b: line } },
  detail: { fs: 11, cl: { rgb: '#147D64' }, bg: { rgb: '#F5FAF7' }, vt: 2, pd: { l: 12, r: 12 }, bd: { b: line } },
  integer: { fs: 11, cl: { rgb: '#147D64' }, bg: { rgb: '#F5FAF7' }, vt: 2, ht: 3, pd: { r: 12 }, n: { pattern: '#,##0' }, bd: { b: line } },
  money: { fs: 11, cl: { rgb: '#147D64' }, bg: { rgb: '#F5FAF7' }, vt: 2, ht: 3, pd: { r: 12 }, n: { pattern: '¥#,##0.00' }, bd: { b: line } },
  total: { fs: 11, bl: 1, cl: { rgb: '#203C35' }, bg: { rgb: '#EAF3EE' }, vt: 2, pd: { l: 12, r: 12 }, bd: { t: line, b: line } },
  totalMoney: { fs: 11, bl: 1, cl: { rgb: '#147D64' }, bg: { rgb: '#EAF3EE' }, ht: 3, vt: 2, pd: { r: 12 }, n: { pattern: '¥#,##0.00' }, bd: { t: line, b: line } },
  note: { fs: 10, cl: { rgb: '#8A9690' }, vt: 2 },
}

export function createTemplate(example = true): ReportTemplate {
  const sheetId = 'report-sheet'
  const snapshot: IWorkbookData = {
    id: `report-${crypto.randomUUID()}`, name: example ? '商品订单明细表' : '未命名报表',
    appVersion: '1.0.0', locale: LocaleType.ZH_CN,
    styles: structuredClone(styles), sheetOrder: [sheetId],
    sheets: {
      [sheetId]: {
        id: sheetId, name: '报表模板', rowCount: 150, columnCount: 26,
        defaultRowHeight: 28, defaultColumnWidth: 100,
        rowData: {}, columnData: {}, cellData: {}, mergeData: [],
        showGridlines: 1,
      },
    },
  }
  if (example) {
    const sheet = snapshot.sheets[sheetId]!
    sheet.columnData = {
      0: { w: 34 }, 1: { w: 128 }, 2: { w: 168 }, 3: { w: 105 },
      4: { w: 82 }, 5: { w: 114 }, 6: { w: 132 }, 7: { w: 34 },
    }
    sheet.rowData = { 0: { h: 26 }, 1: { h: 48 }, 2: { h: 30 }, 3: { h: 22 }, 4: { h: 38 }, 5: { h: 42 }, 6: { h: 38 }, 7: { h: 20 }, 8: { h: 30 } }
    const detailFields: [string, string, ReportBinding['fieldType'], string][] = [
      ['orderNo', '订单编号', 'string', 'detail'], ['product', '商品名称', 'string', 'detail'],
      ['category', '商品分类', 'string', 'detail'], ['quantity', '数量', 'number', 'integer'],
      ['unitPrice', '单价', 'number', 'money'], ['amount', '订单金额', 'number', 'money'],
    ]
    const detailCells: Record<number, ICellData> = {}
    const headerCells: Record<number, ICellData> = {}
    detailFields.forEach(([fieldKey, fieldLabel, fieldType, style], i) => {
      const binding: ReportBinding = { fieldKey, fieldLabel, fieldType, kind: 'detail' }
      detailCells[i + 1] = { v: bindingText(binding), s: style, custom: { reportBinding: binding } }
      headerCells[i + 1] = { v: fieldLabel, s: 'header' }
    })
    const sum: ReportBinding = { fieldKey: 'amount', fieldLabel: '订单金额', fieldType: 'number', kind: 'sum' }
    detailCells[1]!.custom = { ...detailCells[1]!.custom, reportDetailAnchor: true }
    sheet.cellData = {
      1: { 1: { v: '商品订单明细表', s: 'title' } },
      2: { 1: { v: 'ORDER DETAILS  /  从数据到报表，每一步都清晰', s: 'subtitle' } },
      4: headerCells, 5: detailCells,
      6: { 1: { v: '金额合计', s: 'total' }, 6: { v: bindingText(sum), s: 'totalMoney', custom: { reportBinding: sum } } },
      8: { 1: { v: '说明：本报表由所选数据源自动生成。', s: 'note' } },
    }
    sheet.mergeData = [
      { startRow: 1, endRow: 1, startColumn: 1, endColumn: 6 },
      { startRow: 2, endRow: 2, startColumn: 1, endColumn: 6 },
      { startRow: 6, endRow: 6, startColumn: 1, endColumn: 5 },
      { startRow: 8, endRow: 8, startColumn: 1, endColumn: 6 },
    ]
  }
  return { version: 1, name: snapshot.name, defaultSourceId: 'orders-a', snapshot }
}
