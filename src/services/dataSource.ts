import type { DataField, DataRow, DataSource, DataSourceService } from '../domain/types'

const fields: DataField[] = [
  { key: 'orderNo', label: '订单编号', type: 'string' },
  { key: 'product', label: '商品名称', type: 'string' },
  { key: 'category', label: '商品分类', type: 'string' },
  { key: 'quantity', label: '数量', type: 'number', format: '#,##0' },
  { key: 'unitPrice', label: '单价', type: 'number', format: '¥#,##0.00' },
  { key: 'amount', label: '订单金额', type: 'number', format: '¥#,##0.00' },
  { key: 'customer', label: '客户名称', type: 'string' },
  { key: 'createdAt', label: '下单日期', type: 'date' },
]
const products = [
  ['无线机械键盘', '数码配件', 329], ['人体工学鼠标', '数码配件', 159],
  ['桌面收纳套装', '办公用品', 89.9], ['便携显示器', '数码配件', 899],
  ['设计师笔记本', '办公用品', 48.5], ['USB-C 扩展坞', '数码配件', 219],
  ['护眼台灯', '家居生活', 199], ['保温随行杯', '家居生活', 129],
] as const
function makeRows(count: number, offset: number): DataRow[] {
  return Array.from({ length: count }, (_, i) => {
    const [product, category, unitPrice] = products[(i + offset) % products.length]!
    const quantity = ((i * 3 + offset) % 8) + 1
    return {
      orderNo: `SO-${String(offset + i + 1).padStart(5, '0')}`, product, category, quantity,
      unitPrice, amount: Number((quantity * unitPrice).toFixed(2)),
      customer: ['青禾设计', '云端科技', '木白工作室', '远山文化'][(i + offset) % 4]!,
      createdAt: `2026-10-${String((i % 19) + 1).padStart(2, '0')}`,
    }
  })
}
const records: Record<string, DataRow[]> = {
  'orders-a': makeRows(12, 0),
  'orders-b': makeRows(26, 30),
  'orders-empty': [],
}
const sources: DataSource[] = [
  { id: 'orders-a', name: '订单数据 · 示例 A', description: '标准订单样本，适合开始设计', recordCount: 12, fields },
  { id: 'orders-b', name: '订单数据 · 示例 B', description: '相同字段，不同内容与记录数', recordCount: 26, fields },
  { id: 'orders-empty', name: '订单数据 · 空数据', description: '检查无记录时的报表表现', recordCount: 0, fields },
]

// 后端接入点：用 fetch 实现同一接口即可；页面及报表引擎无需修改。
export const dataSourceService: DataSourceService = {
  async listSources() {
    await new Promise(resolve => setTimeout(resolve, 180))
    return structuredClone(sources)
  },
  async getRows(sourceId) {
    await new Promise(resolve => setTimeout(resolve, 280))
    if (!(sourceId in records)) throw new Error('数据源不存在，请重新选择。')
    return structuredClone(records[sourceId]!)
  },
}
