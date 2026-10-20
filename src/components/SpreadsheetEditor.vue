<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets'
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core'
import UniverPresetSheetsCoreZhCN from '@univerjs/preset-sheets-core/locales/zh-CN'
import { CanceledError, CommandType, type IWorkbookData, type IRange, type ICellData } from '@univerjs/core'
import { IAutoFillService } from '@univerjs/sheets'
import { ISheetClipboardService } from '@univerjs/sheets-ui'
import { CutCommand } from '@univerjs/ui'
import '@univerjs/preset-sheets-core/lib/index.css'
import { address, bindingText, firstSheet, getBinding, scanBindings } from '../domain/bindings'
import { getDetailAnchorCells, getDetailRow } from '../domain/detailRegion'
import { assessBindingTarget, intersectsBindings, intersectsDiscreteBindings, protectedReportCells } from '../domain/editGuards'
import type { CellPosition, DataField, ReportBinding } from '../domain/types'

const props = defineProps<{ snapshot: IWorkbookData; readOnly: boolean }>()
const emit = defineEmits<{
  ready: []
  change: [snapshot: IWorkbookData]
  select: [position: CellPosition, binding?: ReportBinding]
  drop: [position: CellPosition, field: DataField, kind: ReportBinding['kind']]
  dragHint: [message: string, valid: boolean]
  notice: [message: string]
  failure: [message: string]
}>()
const container = ref<HTMLDivElement>()
let instance: ReturnType<typeof createUniver> | undefined
const subscriptions: { dispose(): void }[] = []
let timer: ReturnType<typeof setTimeout> | undefined
let ready = false
let draggedField: DataField | undefined
let suspended = false
let editing = false
let detailHighlight: { dispose(): void } | undefined
let dropHighlight: { dispose(): void } | undefined
let detailHighlightKey = ''
let dropHighlightKey = ''
let bindingSnapshot = props.snapshot
let disposed = false

function clearDropHint() {
  dropHighlight?.dispose()
  dropHighlight = undefined
  dropHighlightKey = ''
  emit('dragHint', '', true)
}
function updateDetailHighlight(value: IWorkbookData) {
  bindingSnapshot = value
  if (props.readOnly) return
  const sheet = firstSheet(value)
  const row = getDetailRow(value)
  const key = row !== undefined ? `${row}:${sheet.columnCount}` : ''
  if (key === detailHighlightKey) return
  detailHighlight?.dispose()
  detailHighlight = undefined
  detailHighlightKey = key
  if (!key) return
  detailHighlight = instance?.univerAPI.getActiveWorkbook()?.getActiveSheet()
    .getRange(row!, 0, 1, sheet.columnCount ?? 26).highlight({
      stroke: '#59a88a', strokeWidth: 1, strokeDash: 4, fill: 'rgba(30, 141, 107, 0.035)',
      widgets: {}, widgetSize: 0, autofillSize: 0,
      rowHeaderFill: 'rgba(30, 141, 107, 0.14)', rowHeaderStroke: '#59a88a',
    })
}
function showDropHint(row: number, column: number, dataTransfer: DataTransfer) {
  if (props.readOnly || suspended || !draggedField) return
  const assessment = assessBindingTarget(bindingSnapshot, { row, column, address: address(row, column) }, draggedField)
  dataTransfer.dropEffect = assessment.valid ? 'copy' : 'none'
  emit('dragHint', assessment.message, assessment.valid)
  const position = assessment.position
  if (position.row < 0 || position.column < 0) {
    dropHighlight?.dispose()
    dropHighlight = undefined
    dropHighlightKey = ''
    return
  }
  const key = `${position.row}:${position.column}:${assessment.valid}`
  if (key === dropHighlightKey) return
  dropHighlight?.dispose()
  dropHighlightKey = key
  const sheet = firstSheet(bindingSnapshot)
  const merged = sheet.mergeData?.find(range => range.startRow === position.row && range.startColumn === position.column)
  dropHighlight = instance?.univerAPI.getActiveWorkbook()?.getActiveSheet()
    .getRange(position.row, position.column, (merged?.endRow ?? position.row) - position.row + 1, (merged?.endColumn ?? position.column) - position.column + 1)
    .highlight({ stroke: assessment.valid ? '#19876b' : '#d95656', strokeWidth: 2,
      fill: assessment.valid ? 'rgba(25, 135, 107, 0.16)' : 'rgba(217, 86, 86, 0.12)',
      widgets: {}, widgetSize: 0, autofillSize: 0 })
}

function selectCurrent() {
  const range = instance?.univerAPI.getActiveWorkbook()?.getActiveSheet().getSelection()?.getActiveRange()
  if (!range) return
  const row = range.getRow(), column = range.getColumn()
  emit('select', { row, column, address: address(row, column) }, getBinding(range.getCellData()))
}
async function snapshot() {
  const workbook = instance?.univerAPI.getActiveWorkbook()
  if (!workbook) throw new Error('表格尚未准备好，请稍后重试。')
  await workbook.endEditingAsync(true)
  const pending = timer !== undefined
  clearTimeout(timer)
  timer = undefined
  const value = workbook.save()
  updateDetailHighlight(value)
  // 保存/生成会提前结束防抖，仍须同步这次修改，否则会漏标草稿状态。
  if (pending && ready && !props.readOnly && !suspended) emit('change', value)
  return value
}
function peekSnapshot() { return instance?.univerAPI.getActiveWorkbook()?.save() }
function hasPendingChanges() { return timer !== undefined }
function isEditing() { return editing }
function change() {
  if (!ready || props.readOnly || suspended) return
  clearTimeout(timer)
  timer = setTimeout(() => {
    timer = undefined
    const value = peekSnapshot()
    if (value) {
      updateDetailHighlight(value)
      emit('change', value)
    }
    selectCurrent()
  }, 70)
}
async function bind(position: CellPosition, field: DataField, kind: ReportBinding['kind'] = 'single', recordIndex = 0) {
  if (props.readOnly || suspended || !instance) return
  const value = await snapshot()
  const assessment = assessBindingTarget(value, position, field, kind)
  if (!assessment.valid) throw new Error(assessment.message)
  const { row, column } = assessment.position
  const range = instance.univerAPI.getActiveWorkbook()!.getActiveSheet().getRange(row, column)
  const cell = range.getCellData() ?? {}
  const binding: ReportBinding = { fieldKey: field.key, fieldLabel: field.label, fieldType: field.type, kind,
    ...(kind === 'single' ? { recordIndex } : {}) }
  const custom = { ...cell.custom, reportBinding: binding,
    ...(kind === 'detail' && !getDetailAnchorCells(value).length ? { reportDetailAnchor: true } : {}) }
  // 内容和元数据一次写入同一个可撤销命令。
  const currentStyle = typeof cell.s === 'string' ? value.styles?.[cell.s] ?? {} : cell.s ?? {}
  range.setValue({ ...cell, v: bindingText(binding), t: 1, f: null, p: null,
    s: field.format ? { ...currentStyle, n: { pattern: field.format } } : cell.s,
    custom })
  range.activate()
  change()
  selectCurrent()
}
async function unbind(position: CellPosition) {
  if (props.readOnly || suspended || !instance) return
  const value = await snapshot()
  const range = instance.univerAPI.getActiveWorkbook()!.getActiveSheet().getRange(position.row, position.column)
  const cell = range.getCellData() ?? {}
  const custom: Record<string, unknown> = { ...cell.custom }
  // Keep a legacy template's region when its final detail binding is removed.
  if (getBinding(cell)?.kind === 'detail' && !getDetailAnchorCells(value).length) custom.reportDetailAnchor = true
  delete custom.reportBinding
  range.setValue({ ...cell, v: '', p: null, f: null, custom })
  change()
  selectCurrent()
}
async function setDetailRow(row: number) {
  if (props.readOnly || suspended || !instance) return
  const value = await snapshot()
  const data = firstSheet(value)
  if (!Number.isInteger(row) || row < 0 || row >= (data.rowCount ?? 0)) throw new Error('请选择工作表内有效的行。')
  const currentRow = getDetailRow(value)
  const sheet = instance.univerAPI.getActiveWorkbook()!.getActiveSheet()
  if (currentRow === row) {
    if (!getDetailAnchorCells(value).length) {
      const cell = sheet.getRange(row, 0).getCellData() ?? {}
      sheet.getRange(row, 0).setValue({ ...cell, custom: { ...cell.custom, reportDetailAnchor: true } })
    }
  } else if (currentRow === undefined) {
    if (data.mergeData?.some(range => range.startRow !== range.endRow && row >= range.startRow && row <= range.endRow)) {
      throw new Error('此行包含纵向合并，请先取消合并或选择其他行作为明细区域。')
    }
    const cell = sheet.getRange(row, 0).getCellData() ?? {}
    sheet.getRange(row, 0).setValue({ ...cell, custom: { ...cell.custom, reportDetailAnchor: true } })
  } else {
    // Univer uses insertion coordinates before removal. Moving down one row
    // therefore needs destination + 1 to reach the user's final row number.
    const destination = row > currentRow ? row + 1 : row
    if (data.mergeData?.some(range => range.startRow !== range.endRow &&
      ((currentRow >= range.startRow && currentRow <= range.endRow) ||
        (destination > range.startRow && destination <= range.endRow)))) {
      throw new Error('移动位置跨越纵向合并，请先取消相关合并，或选择合并区域的边界行。')
    }
    sheet.moveRows(sheet.getRange(currentRow, 0, 1, data.columnCount ?? 26), destination)
    if (getDetailRow(instance.univerAPI.getActiveWorkbook()!.save()) !== row) {
      throw new Error('明细区域未能移动，请检查合并单元格或工作表权限后重试。')
    }
  }
  change()
  selectAt(row, 0)
}
async function clearDetailRegion() {
  if (props.readOnly || suspended || !instance) return
  const value = await snapshot()
  const sheet = firstSheet(value)
  const positions = [...scanBindings(value).filter(binding => binding.kind === 'detail'), ...getDetailAnchorCells(value)]
  if (!positions.length) return
  const updates: Record<number, Record<number, ICellData>> = {}
  for (const { row, column } of positions) {
    if (updates[row]?.[column]) continue
    const cell = sheet.cellData?.[row]?.[column] ?? {}
    const custom: Record<string, unknown> = { ...cell.custom }
    delete custom.reportDetailAnchor
    const detail = getBinding(cell)?.kind === 'detail'
    if (detail) delete custom.reportBinding
    ;(updates[row] ??= {})[column] = { ...cell, ...(detail ? { v: '', p: null, f: null } : {}), custom }
  }
  const rows = positions.map(position => position.row), columns = positions.map(position => position.column)
  instance.univerAPI.getActiveWorkbook()!.getActiveSheet()
    .getRange(Math.min(...rows), Math.min(...columns), Math.max(...rows) - Math.min(...rows) + 1, Math.max(...columns) - Math.min(...columns) + 1)
    .setValues(updates)
  change()
  selectCurrent()
}
function selectAt(row: number, column: number) {
  instance?.univerAPI.getActiveWorkbook()?.getActiveSheet().getRange(row, column).activate()
  selectCurrent()
}
function setDraggedField(field?: DataField) {
  draggedField = field
  if (!field) clearDropHint()
}
function onDragLeave(event: DragEvent) {
  if (!container.value?.contains(event.relatedTarget as Node | null)) clearDropHint()
}
async function suspend() {
  if (props.readOnly || !instance) return
  await snapshot()
  suspended = true
  setDraggedField()
  await instance.univerAPI.getActiveWorkbook()?.getWorkbookPermission().setReadOnly()
}
async function resume() {
  if (!instance) return
  if (!props.readOnly && suspended) await instance.univerAPI.getActiveWorkbook()?.getWorkbookPermission().setEditable()
  suspended = false
  instance.univerAPI.getActiveWorkbook()?.getActiveSheet().refreshCanvas()
  selectCurrent()
}
async function unmergeAt(row: number, column: number) {
  if (props.readOnly || suspended || !instance) return
  const value = await snapshot()
  const merged = firstSheet(value).mergeData?.find(range => row >= range.startRow && row <= range.endRow &&
    column >= range.startColumn && column <= range.endColumn)
  if (!merged) return
  instance.univerAPI.getActiveWorkbook()!.getActiveSheet().getRange(merged).breakApart()
  change()
  selectAt(row, column)
}

onMounted(async () => {
  try {
    instance = createUniver({
      locale: LocaleType.ZH_CN,
      locales: { [LocaleType.ZH_CN]: mergeLocales(UniverPresetSheetsCoreZhCN) },
      presets: [UniverSheetsCorePreset({
        container: container.value!,
        header: !props.readOnly,
        toolbar: !props.readOnly,
        footer: { addSheetButtonConfig: { show: false } },
        contextMenu: !props.readOnly,
      })],
    })
    const api = instance.univerAPI
    const workbook = api.createWorkbook(structuredClone(props.snapshot))
    if (props.readOnly) await workbook.getWorkbookPermission().setReadOnly()
    subscriptions.push(api.addEvent(api.Event.SelectionChanged, selectCurrent))
    subscriptions.push(api.addEvent(api.Event.SheetEditStarted, () => { editing = true }))
    subscriptions.push(api.addEvent(api.Event.SheetEditEnded, () => { editing = false }))
    subscriptions.push(api.addEvent(api.Event.DragOver, event => showDropHint(event.row, event.column, event.dataTransfer)))
    subscriptions.push(api.addEvent(api.Event.Drop, event => {
      if (props.readOnly || suspended || !draggedField) return
      const { row, column } = event
      const assessment = assessBindingTarget(workbook.save(), { row, column, address: address(row, column) }, draggedField)
      if (assessment.valid) emit('drop', assessment.position, draggedField, assessment.kind)
      else emit('notice', assessment.message)
      draggedField = undefined
      clearDropHint()
    }))
    subscriptions.push(api.addEvent(api.Event.BeforeSheetEditStart, event => {
      const cell = event.worksheet.getRange(event.row, event.column).getCellData()
      if (getBinding(cell)) {
        event.cancel = true
        emit('notice', '绑定单元格请在右侧更换字段，或先解除绑定后编辑。')
      }
    }))
    const injector = instance.univer.__getInjector()
    const clipboard = injector.get(ISheetClipboardService)
    const autoFill = injector.get(IAutoFillService)
    // This hook sees Univer's final paste footprint, including clipboard expansion,
    // merged cells, repeated paste and hidden row/column handling.
    subscriptions.push(clipboard.addClipboardHook({
      id: 'report-binding-clipboard-guard',
      priority: 1000,
      onBeforePaste: pasteTo => {
        if (props.readOnly || suspended) return false
        const bindings = protectedReportCells(workbook.save())
        if (!intersectsDiscreteBindings(bindings, pasteTo.range)) return true
        emit('notice', '粘贴范围包含字段绑定或明细区域标记，请选择普通区域，或先调整绑定及明细区域。')
        return false
      },
      onPasteCells: (pasteFrom, _pasteTo, data) => {
        // Internal copy/cut can carry metadata even if its original source has
        // since been edited. Inspect the real pasted matrix before any mutation.
        if (pasteFrom) {
          let carriesBinding = false
          data.forValue((_row, _column, cell) => { if (getBinding(cell) || cell.custom?.reportDetailAnchor === true) carriesBinding = true })
          const bindings = protectedReportCells(workbook.save())
          const fromThisSheet = pasteFrom.unitId === workbook.getId() && pasteFrom.subUnitId === workbook.getActiveSheet().getSheetId()
          if (carriesBinding || (fromThisSheet && intersectsDiscreteBindings(bindings, pasteFrom.range))) {
            emit('notice', '复制内容包含字段绑定或明细区域标记，请拖拽字段建立绑定，或通过“明细区域”移动整行。')
            throw new CanceledError()
          }
        }
        return { undos: [], redos: [] }
      },
    }))
    subscriptions.push(api.addEvent(api.Event.BeforeCommandExecute, event => {
      if (['sheet.command.insert-sheet', 'sheet.command.remove-sheet', 'sheet.command.copy-sheet'].includes(event.id)) {
        event.cancel = true
        emit('notice', '首版使用单工作表，请在当前工作表内设计。')
      }
      if (![CutCommand.id, 'sheet.command.auto-fill', 'sheet.command.refill', 'sheet.command.move-range',
        'sheet.command.move-range-confirm', 'sheet.command.auto-clear-content'].includes(event.id)) return
      const bindings = protectedReportCells(workbook.save())
      if (!bindings.length) return
      const params = event.params as { sourceRange?: IRange; targetRange?: IRange; fromRange?: IRange; toRange?: IRange; clearRange?: IRange } | undefined
      let protectedOperation = false
      if (event.id === CutCommand.id) {
        const selection = workbook.getActiveSheet().getSelection()?.getActiveRangeList() ?? []
        protectedOperation = intersectsBindings(bindings, selection.map(range => range.getRange()))
      } else if (event.id === 'sheet.command.auto-fill') {
        protectedOperation = intersectsBindings(bindings, [params?.sourceRange, params?.targetRange])
      } else if (event.id === 'sheet.command.refill') {
        const location = autoFill.autoFillLocation
        protectedOperation = !!location && (intersectsDiscreteBindings(bindings, location.source) || intersectsDiscreteBindings(bindings, location.target))
      } else if (['sheet.command.move-range', 'sheet.command.move-range-confirm'].includes(event.id)) {
        protectedOperation = intersectsBindings(bindings, [params?.fromRange, params?.toRange])
      } else if (event.id === 'sheet.command.auto-clear-content') {
        protectedOperation = intersectsBindings(bindings, [params?.clearRange])
      }
      if (protectedOperation) {
        event.cancel = true
        emit('notice', '此次操作涉及字段绑定或明细区域标记，请通过右侧调整绑定和区域；普通区域可正常剪切、填充和移动。')
      }
    }))
    subscriptions.push(api.addEvent(api.Event.CommandExecuted, event => {
      if (event.type === CommandType.MUTATION && event.id.startsWith('sheet.mutation.')) change()
    }))
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (disposed) return
      ready = true
      updateDetailHighlight(workbook.save())
      selectCurrent()
      emit('ready')
    }))
  } catch (error) { emit('failure', error instanceof Error ? error.message : '表格初始化失败。') }
})
onBeforeUnmount(() => {
  disposed = true
  ready = false
  clearTimeout(timer)
  detailHighlight?.dispose()
  dropHighlight?.dispose()
  subscriptions.forEach(s => s.dispose())
  instance?.univer.dispose()
})
defineExpose({ snapshot, peekSnapshot, hasPendingChanges, isEditing, bind, unbind, setDetailRow, clearDetailRegion, selectAt, setDraggedField, suspend, resume, unmergeAt })
</script>

<template>
  <div ref="container" class="spreadsheet-host" :class="{ 'is-preview': readOnly }" aria-label="Excel 报表编辑区" @dragleave="onDragLeave" @dragend="setDraggedField()" />
</template>
