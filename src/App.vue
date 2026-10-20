<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, ArrowRight, Check, CircleCheck, Close, Collection, Connection, Document, Download, EditPen, FolderOpened, Grid, InfoFilled, Plus, QuestionFilled, Search, Setting, View } from '@element-plus/icons-vue'
import type { IWorkbookData } from '@univerjs/core'
import SpreadsheetEditor from './components/SpreadsheetEditor.vue'
import QuickCreateDialog from './components/QuickCreateDialog.vue'
import TemplateLibraryDialog from './components/TemplateLibraryDialog.vue'
import ValidationPanel from './components/ValidationPanel.vue'
import BindingDialog from './components/BindingDialog.vue'
import DetailRegionDialog from './components/DetailRegionDialog.vue'
import { getDetailRow } from './domain/detailRegion'
import { useDesignerStore } from './stores/designer'
import { address, firstSheet, getBinding, scanBindings } from './domain/bindings'
import { createTemplate } from './domain/template'
import { createQuickTemplate } from './domain/quickTemplate'
import { collectTemplateIssues, type ReportIssue } from './domain/validation'
import { generateFreshReport, prepareDownloadReport } from './services/reportWorkflow'
import { dataSourceService } from './services/dataSource'
import { downloadExcel } from './services/excelExport'
import type { CellPosition, DataField, LocatedBinding, ReportBinding, ReportTemplate } from './domain/types'

const store = useDesignerStore()
const editor = ref<InstanceType<typeof SpreadsheetEditor>>()
const editorKey = ref(0)
const previewKey = ref(0)
const initialized = ref(false)
const designReady = ref(false)
const previewReady = ref(false)
const editorReady = computed(() => store.mode === 'design' ? designReady.value : previewReady.value)
const editorError = ref('')
const reportName = ref('商品订单明细表')
const search = ref('')
const selected = ref<CellPosition>({ row: 0, column: 0, address: 'A1' })
const selectedBinding = shallowRef<ReportBinding>()
const fieldKey = ref('')
const bindingKind = ref<ReportBinding['kind']>('single')
const singleRecordNumber = ref<number | undefined>(1)
const bindingVisible = ref(false)
const regionVisible = ref(false)
const bindingBusy = ref(false)
const regionBusy = ref(false)
const pendingBinding = shallowRef<{ position: CellPosition; field: DataField }>()
const exporting = ref(false)
const helpVisible = ref(false)
const quickVisible = ref(false)
const libraryVisible = ref(false)
const showProperties = ref(window.innerWidth > 1100)
const dataVisible = ref(false)
const dataRows = shallowRef<Awaited<ReturnType<typeof dataSourceService.getRows>>>([])
const dataLoading = ref(false)
const draftPending = ref(false)
const dragHint = ref('')
const dragValid = ref(true)
let draftTimer: ReturnType<typeof setTimeout> | undefined
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试。'
const notify = (message: string) => ElMessage.info(message)
const filteredFields = computed(() => store.source?.fields.filter(f => `${f.label} ${f.key}`.toLowerCase().includes(search.value.toLowerCase())) ?? [])
const detailBindings = computed(() => store.bindings.filter(b => b.kind === 'detail'))
const sumBindings = computed(() => store.bindings.filter(b => b.kind === 'sum'))
const singleBindings = computed(() => store.bindings.filter(b => b.kind === 'single'))
const sheetRowCount = computed(() => firstSheet(store.template.snapshot).rowCount ?? 150)
const currentField = computed(() => store.source?.fields.find(f => f.key === fieldKey.value))
const issues = computed(() => initialized.value ? collectTemplateIssues(store.template.snapshot, store.source) : [])
const savedLabel = computed(() => {
  if (store.draftError) return '草稿保存失败，点击重试'
  if (draftPending.value) return '正在保存草稿…'
  if (store.dirty && store.draftSavedAt) return `草稿已自动保存 · ${time(store.draftSavedAt)}`
  if (store.dirty) return '有未保存为模板的修改'
  return store.template.savedAt ? `模板已保存 · ${time(store.template.savedAt)}` : '示例模板 · 可继续编辑'
})
const time = (value: string) => new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
const typeLabel = (type: string) => ({ string: '文本', number: '数值', date: '日期', boolean: '布尔' })[type] ?? type
const typeSymbol = (type: string) => ({ string: 'T', number: '#', date: '◷', boolean: '◉' })[type] ?? 'T'

function draftTemplate(): ReportTemplate {
  return { ...store.template, name: reportName.value.trim() || '未命名报表', defaultSourceId: store.sourceId }
}
function flushDraft() {
  clearTimeout(draftTimer)
  if (store.mode === 'design' && editor.value?.hasPendingChanges()) store.dirty = true
  if (!initialized.value || !store.dirty) { draftPending.value = false; return }
  if (store.mode === 'design') {
    const current = editor.value?.peekSnapshot()
    if (current) syncSnapshot(current, false)
  }
  store.saveDraft(draftTemplate())
  draftPending.value = false
}
function scheduleDraft() {
  clearTimeout(draftTimer)
  draftPending.value = true
  draftTimer = setTimeout(flushDraft, 650)
}
function markDirty() { store.dirty = true; store.generated = undefined; scheduleDraft() }
function syncSnapshot(snapshot: IWorkbookData, dirty = true) {
  if (dirty && store.mode !== 'design') return
  store.template = { ...store.template, name: reportName.value.trim() || '未命名报表', snapshot }
  store.bindings = scanBindings(snapshot)
  if (dirty) markDirty()
}
function renameDraft() {
  store.template = { ...store.template, name: reportName.value.trim() || '未命名报表' }
  markDirty()
}
function onSelect(position: CellPosition, binding?: ReportBinding) {
  selected.value = position
  selectedBinding.value = binding
  fieldKey.value = binding?.fieldKey ?? ''
  bindingKind.value = binding?.kind ?? (store.detailRow === position.row ? 'detail' : 'single')
  singleRecordNumber.value = (binding?.recordIndex ?? 0) + 1
}
function onDragHint(message: string, valid: boolean) { dragHint.value = message; dragValid.value = valid }
async function performBinding(position: CellPosition, field: DataField, kind: ReportBinding['kind'], recordIndex = 0, moveConfirmed = false) {
  if (store.loading || bindingBusy.value || exporting.value || store.mode !== 'design') return false
  const snapshot = editor.value?.peekSnapshot()
  if (!snapshot) throw new Error('表格尚未准备好，请稍后重试。')
  const detailRow = getDetailRow(snapshot)
  const moving = kind === 'detail' && detailRow !== undefined && detailRow !== position.row
  if (moving && !moveConfirmed) {
    await ElMessageBox.confirm(`将整条明细区域从第 ${detailRow + 1} 行移到第 ${position.row + 1} 行，并绑定「${field.label}」。其他行顺移，目标内容不会被覆盖，可撤销。`, '移动明细区域并绑定', { confirmButtonText: '移动并绑定', cancelButtonText: '取消' })
  }
  const cell = firstSheet(snapshot).cellData?.[position.row]?.[position.column]
  const occupied = cell && !getBinding(cell) && ((cell.v != null && cell.v !== '') || !!cell.p)
  if (!moving && occupied) await ElMessageBox.confirm(`${position.address} 已有内容，绑定「${field.label}」会替换此单元格内容，支持撤销。`, '替换单元格内容', { confirmButtonText: '应用绑定', cancelButtonText: '取消' })
  bindingBusy.value = true; store.loading = true
  try {
    if (moving) await editor.value!.setDetailRow(position.row)
    await editor.value!.bind(position, field, kind, recordIndex)
    syncSnapshot(await editor.value!.snapshot(), false)
    markDirty()
    ElMessage.success(`「${field.label}」已绑定到 ${position.address} · ${kind === 'single' ? `单值，第 ${recordIndex + 1} 条记录` : kind === 'sum' ? '所有记录求和' : '明细展开'}`)
    return true
  } finally { bindingBusy.value = false; store.loading = false }
}
async function onDrop(position: CellPosition, field: DataField, kind: ReportBinding['kind'] = 'single') {
  if (store.loading || exporting.value || store.mode !== 'design') return
  try {
    if (kind === 'detail' && store.detailRow === position.row) await performBinding(position, field, 'detail')
    else { pendingBinding.value = { position, field }; bindingVisible.value = true }
  } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.warning(errorMessage(error)) }
}
async function applyPendingBinding(options: { kind: ReportBinding['kind']; recordIndex: number; moveDetail: boolean }) {
  if (!pendingBinding.value) return
  try {
    const pending = pendingBinding.value
    if (await performBinding(pending.position, pending.field, options.kind, options.recordIndex, options.moveDetail)) {
      bindingVisible.value = false; pendingBinding.value = undefined
    }
  } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.warning(errorMessage(error)) }
}
async function setRegion(row: number) {
  if (store.loading || store.mode !== 'design') return
  regionBusy.value = true; store.loading = true
  try {
    await editor.value!.setDetailRow(row)
    syncSnapshot(await editor.value!.snapshot(), false)
    markDirty(); regionVisible.value = false
    ElMessage.success(`明细区域已设置到第 ${row + 1} 行，可拖入明细字段`)
  } catch (error) { ElMessage.warning(errorMessage(error)) }
  finally { regionBusy.value = false; store.loading = false }
}
async function clearRegion() {
  if (store.loading) return
  try {
    await ElMessageBox.confirm(`取消明细区域并解除其中 ${detailBindings.value.length} 个明细字段绑定？样式、单值及合计绑定会保留，操作支持撤销。`, '取消明细区域', { confirmButtonText: '取消区域及明细绑定', cancelButtonText: '返回', type: 'warning' })
    regionBusy.value = true; store.loading = true
    await editor.value!.clearDetailRegion()
    syncSnapshot(await editor.value!.snapshot(), false)
    markDirty(); regionVisible.value = false
    ElMessage.success('已取消明细区域，仍可使用单值和合计生成报表')
  } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.warning(errorMessage(error)) }
  finally { regionBusy.value = false; store.loading = false }
}

function startDrag(event: DragEvent, field: DataField) {
  if (store.mode !== 'design' || store.loading) { event.preventDefault(); return }
  editor.value?.setDraggedField(field)
  event.dataTransfer?.setData('application/x-bind-sheet-field', JSON.stringify(field))
  event.dataTransfer?.setData('text/plain', field.label)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
}
async function bindCurrentField(field: DataField) { await onDrop(selected.value, field, store.detailRow === selected.value.row ? 'detail' : 'single') }
async function applyBinding() {
  if (!currentField.value) return
  try { await performBinding(selected.value, currentField.value, bindingKind.value, Math.max(0, (singleRecordNumber.value ?? 1) - 1)) }
  catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.warning(errorMessage(error)) }
}
async function clearBinding() {
  try { await editor.value?.unbind(selected.value); ElMessage.success('已解除绑定，可继续编辑内容') }
  catch (error) { ElMessage.error(errorMessage(error)) }
}
async function commitDesign() {
  if (store.mode === 'design') {
    const snapshot = await editor.value!.snapshot()
    snapshot.name = reportName.value.trim() || '未命名报表'
    syncSnapshot(snapshot, false)
  }
}
async function persistCurrent(showMessage = true) {
  try {
    clearTimeout(draftTimer)
    await commitDesign()
    store.persist(draftTemplate())
    draftPending.value = false
    if (showMessage) ElMessage.success('模板已保存，可在“我的模板”中打开')
    return true
  } catch (error) { ElMessage.error(`保存失败：${errorMessage(error)}`); scheduleDraft(); return false }
}
async function save() { await persistCurrent() }
async function saveAs() {
  try {
    await commitDesign()
    const { value } = await ElMessageBox.prompt('为这份设计保存一个独立模板，原模板保持不变。', '另存为模板', { inputValue: `${reportName.value} 副本`, inputValidator: value => !!value?.trim() || '请输入模板名称', confirmButtonText: '另存为', cancelButtonText: '取消' })
    store.saveAs(draftTemplate(), value)
    reportName.value = store.template.name
    clearTimeout(draftTimer); draftPending.value = false
    ElMessage.success('已另存为独立模板')
  } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(errorMessage(error)) }
}
async function buildReport() {
  if (store.loading) throw new Error('正在生成报表，请稍候。')
  store.loading = true
  try {
    if (!store.source) throw new Error('请选择数据源。')
    const report = await generateFreshReport(async () => { await commitDesign(); return draftTemplate() }, store.source, id => dataSourceService.getRows(id))
    await editor.value?.suspend()
    editorError.value = ''
    previewReady.value = false
    store.generated = report
    store.mode = 'preview'
    previewKey.value++
    return report
  } finally { store.loading = false }
}
async function showFailure(error: unknown) {
  ElMessage.error({ message: errorMessage(error), duration: 5000 })
  if (store.mode === 'preview' && !store.generated) await backToDesign()
  if (issues.value.length) showProperties.value = true
  if (store.mode === 'design') await editor.value?.resume()
}
async function generate() { try { await buildReport() } catch (error) { await showFailure(error) } }
async function exportReport() {
  exporting.value = true
  try {
    const report = await prepareDownloadReport(store.mode, store.generated, buildReport)
    await downloadExcel(report.snapshot, reportName.value)
    ElMessage.success('已下载当前结果的 Excel 文件')
  } catch (error) { await showFailure(error) }
  finally { exporting.value = false }
}
function resetDesign() {
  designReady.value = false; previewReady.value = false; editorError.value = ''; dragHint.value = ''
  store.generated = undefined; store.mode = 'design'; selectedBinding.value = undefined; editorKey.value++
}
async function backToDesign() {
  store.mode = 'design'; editorError.value = ''
  await nextTick()
  await editor.value?.resume()
}
async function changeSource() {
  store.dirty = true; scheduleDraft()
  if (store.mode === 'preview') { store.generated = undefined; await generate() }
  else store.generated = undefined
}
async function confirmSwitch() {
  if (!store.dirty) return true
  await commitDesign()
  try {
    await ElMessageBox.confirm('当前有尚未保存为模板的修改。保存后继续，或选择“不保存，继续”替换当前草稿。', '切换当前设计', { confirmButtonText: '保存并继续', cancelButtonText: '不保存，继续', distinguishCancelAndClose: true, closeOnClickModal: false })
    return await persistCurrent(false)
  } catch (reason) {
    if (reason === 'cancel') { store.discardDraft(); clearTimeout(draftTimer); draftPending.value = false; return true }
    return false
  }
}
async function replaceTemplate(example: boolean) {
  try {
    if (!await confirmSwitch()) return
    store.discardDraft()
    store.template = createTemplate(example); reportName.value = store.template.name
    store.bindings = scanBindings(store.template.snapshot)
    resetDesign(); store.dirty = true; scheduleDraft()
  } catch (error) { ElMessage.error(errorMessage(error)) }
}
function newCommand(command: string) {
  if (command === 'quick') quickVisible.value = true
  else void replaceTemplate(command === 'example')
}
async function quickCreate(options: Parameters<typeof createQuickTemplate>[0]) {
  try {
    const template = createQuickTemplate(options)
    if (!await confirmSwitch()) return
    store.discardDraft(); store.template = template; reportName.value = template.name
    store.bindings = scanBindings(template.snapshot)
    quickVisible.value = false; resetDesign(); store.dirty = true; scheduleDraft()
    ElMessage.success(`已生成 ${options.fields.length} 列模板，可继续调整样式`)
  } catch (error) { ElMessage.error(errorMessage(error)) }
}
async function openSavedTemplate(id: string) {
  try {
    if (!await confirmSwitch()) return
    store.openTemplate(id); reportName.value = store.template.name
    libraryVisible.value = false; resetDesign(); draftPending.value = false
  } catch (error) { ElMessage.error(errorMessage(error)) }
}
async function copySavedTemplate(template: ReportTemplate) {
  try {
    if (!await confirmSwitch()) return
    store.saveAs(template, `${template.name} 副本`); reportName.value = store.template.name
    libraryVisible.value = false; resetDesign(); draftPending.value = false
    ElMessage.success('已复制为独立模板')
  } catch (error) { ElMessage.error(errorMessage(error)) }
}
async function renameSavedTemplate(template: ReportTemplate) {
  try {
    if (template.id === store.template.id && store.dirty && !await persistCurrent(false)) return
    const { value } = await ElMessageBox.prompt('输入新的模板名称。', '重命名模板', { inputValue: template.name, inputValidator: value => !!value?.trim() || '请输入模板名称', confirmButtonText: '保存', cancelButtonText: '取消' })
    store.renameTemplate(template.id!, value)
    if (template.id === store.template.id) reportName.value = store.template.name
  } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(errorMessage(error)) }
}
async function deleteSavedTemplate(template: ReportTemplate) {
  try {
    await ElMessageBox.confirm(`删除“${template.name}”？${template.id === store.template.id ? '当前设计内容会保留为草稿。' : '其他模板不受影响。'}`, '删除已保存模板', { confirmButtonText: '删除模板', cancelButtonText: '取消', type: 'warning' })
    const current = template.id === store.template.id
    if (current) await commitDesign()
    store.deleteTemplate(template.id!)
    if (current) { resetDesign(); scheduleDraft() }
    ElMessage.success('已删除该模板')
  } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(errorMessage(error)) }
}
async function locateIssue(issue: ReportIssue) {
  if (store.mode !== 'design') await backToDesign()
  showProperties.value = true
  await nextTick()
  if (issue.row !== undefined && issue.column !== undefined) editor.value?.selectAt(issue.row, issue.column)
}
async function fixIssue(issue: ReportIssue) {
  await locateIssue(issue)
  if (issue.action === 'unmerge' && issue.row !== undefined && issue.column !== undefined) {
    await editor.value?.unmergeAt(issue.row, issue.column)
    ElMessage.success('已取消纵向合并，可使用撤销恢复')
  } else if (issue.action === 'select-detail') { regionVisible.value = true; notify('可以指定明细区域后添加明细字段，也可以取消区域并使用单值或合计。') }
  else notify('已定位问题单元格，请在右侧更换字段或解除绑定。')
}
function focusBinding(binding: LocatedBinding) { editor.value?.selectAt(binding.row, binding.column) }
async function previewData() {
  dataVisible.value = true; dataLoading.value = true; dataRows.value = []
  try { dataRows.value = await dataSourceService.getRows(store.sourceId) }
  catch (error) { ElMessage.error(errorMessage(error)) }
  finally { dataLoading.value = false }
}
function preventLeaving(event: BeforeUnloadEvent) {
  if (store.mode === 'design' && editor.value?.isEditing()) event.preventDefault()
  if (store.mode === 'design' && editor.value?.hasPendingChanges()) store.dirty = true
  if (store.dirty) { flushDraft(); if (store.draftError) event.preventDefault() }
}
function keyboard(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (designReady.value) void save() }
}
async function initialize() {
  try {
    editorError.value = ''
    const warning = await store.initialize()
    if (warning) ElMessage.warning(warning)
    reportName.value = store.template.name; store.bindings = scanBindings(store.template.snapshot)
    initialized.value = true
    if (store.recoveredDraft) ElMessage.info({ message: '已恢复上次自动保存的草稿，可继续编辑或保存为模板。', duration: 6000 })
  } catch (error) { editorError.value = `数据源加载失败：${errorMessage(error)}` }
}
async function retryEditor() { if (!initialized.value) await initialize(); else resetDesign() }
onMounted(() => {
  void initialize()
  window.addEventListener('beforeunload', preventLeaving)
  window.addEventListener('pagehide', flushDraft)
  window.addEventListener('keydown', keyboard)
})
onBeforeUnmount(() => {
  flushDraft(); clearTimeout(draftTimer)
  window.removeEventListener('beforeunload', preventLeaving)
  window.removeEventListener('pagehide', flushDraft)
  window.removeEventListener('keydown', keyboard)
})
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <a class="brand" href="#" @click.prevent="helpVisible = true" aria-label="bind_sheet 报表使用指南">
        <span class="brand-mark"><el-icon :size="23"><Grid /></el-icon></span>
        <span>bind_sheet<span class="brand-divider"></span><span class="brand-subtitle">报表设计器</span></span>
      </a>
      <div class="workspace-breadcrumb"><span>我的工作空间</span><span class="breadcrumb-slash">/</span><strong>报表设计</strong><span class="version-tag">BETA</span></div>
      <div class="header-right"><span class="local-badge"><i></i> 本地工作空间</span><button class="icon-button" aria-label="使用指南" @click="helpVisible = true"><el-icon :size="19"><QuestionFilled /></el-icon></button><span class="avatar">我</span></div>
    </header>

    <section class="document-bar">
      <div class="document-identity"><span class="document-icon"><el-icon :size="20"><Document /></el-icon></span><div><input class="report-name" aria-label="报表名称" maxlength="60" v-model="reportName" :disabled="store.mode === 'preview' || store.loading" @input="renameDraft" /><span class="save-status" :class="{ unsaved: store.dirty, 'save-error': store.draftError }" aria-live="polite"><i></i>{{ savedLabel }}<button v-if="store.draftError" class="text-button" @click="flushDraft">重试</button></span></div></div>
      <div class="document-actions">
        <el-dropdown @command="newCommand" :disabled="!editorReady || store.loading || exporting"><el-button title="新建设计" aria-label="新建设计" :disabled="!editorReady || store.loading || exporting"><el-icon><Plus /></el-icon>新建</el-button><template #dropdown><el-dropdown-menu><el-dropdown-item command="quick">选择字段快速建表</el-dropdown-item><el-dropdown-item command="blank">空白表格</el-dropdown-item><el-dropdown-item command="example">加载示例模板</el-dropdown-item></el-dropdown-menu></template></el-dropdown>
        <el-button type="primary" plain title="选择字段快速建表" aria-label="快速建表" @click="quickVisible = true" :disabled="!editorReady || store.loading || exporting"><el-icon><Grid /></el-icon>快速建表</el-button>
        <el-button title="我的模板" aria-label="我的模板" @click="libraryVisible = true" :disabled="!editorReady || store.loading || exporting"><el-icon><FolderOpened /></el-icon>我的模板</el-button>
        <el-button title="保存模板 · Ctrl/⌘+S" aria-label="保存模板" @click="save" :disabled="!editorReady || store.loading || exporting"><el-icon><Collection /></el-icon>保存模板</el-button>
        <el-button title="另存为独立模板" aria-label="另存为模板" @click="saveAs" :disabled="!editorReady || store.loading || exporting"><el-icon><Document /></el-icon>另存为</el-button>
        <span class="action-divider"></span>
        <el-button title="生成最新数据预览" :aria-label="store.mode === 'preview' ? '重新生成' : '生成预览'" @click="generate" :loading="store.loading" :disabled="!editorReady || exporting"><el-icon><View /></el-icon>{{ store.mode === 'preview' ? '重新生成' : '生成预览' }}</el-button>
        <el-button type="primary" title="提交最新修改并下载 Excel" @click="exportReport" :loading="exporting" :disabled="!editorReady || store.loading"><el-icon><Download /></el-icon>下载 Excel</el-button>
      </div>
    </section>

    <main class="designer-layout" :class="{ 'properties-open': showProperties }">
      <aside class="source-panel">
        <div class="panel-heading"><div><el-icon><Connection /></el-icon><h2>数据源</h2></div><span class="mock-tag">MOCK</span></div>
        <div class="source-content">
          <label class="form-label" for="source-picker">当前数据源</label>
          <el-select id="source-picker" v-model="store.sourceId" aria-label="当前数据源" @change="changeSource" :disabled="store.loading || exporting" class="source-picker">
            <el-option v-for="source in store.sources" :key="source.id" :label="source.name" :value="source.id"><span>{{ source.name }}</span><span class="option-count">{{ source.recordCount }} 条</span></el-option>
          </el-select>
          <div class="source-meta"><span><i class="connection-dot"></i>已连接 · {{ store.source?.recordCount ?? 0 }} 条记录</span><button @click="previewData" class="text-button">查看数据<el-icon><ArrowRight /></el-icon></button></div>
          <div class="section-divider"></div>
          <div class="field-heading"><span>数据字段 <small>{{ store.source?.fields.length ?? 0 }}</small></span><span class="drag-caption">拖入单元格</span></div>
          <el-input v-model="search" placeholder="搜索字段名称" clearable :prefix-icon="Search" aria-label="搜索字段" class="field-search" />
          <div class="field-list">
            <div v-for="field in filteredFields" :key="field.key" class="field-item" :class="{ numeric: field.type === 'number', 'drag-disabled': store.mode === 'preview' }" :draggable="store.mode === 'design'" @dragstart="startDrag($event, field)" @dragend="editor?.setDraggedField(undefined)" @dblclick="store.mode === 'design' && bindCurrentField(field)" :title="`${field.label} · ${field.key} · 拖入或双击绑定到当前单元格`">
              <span class="field-type">{{ typeSymbol(field.type) }}</span><div class="field-name"><strong>{{ field.label }}</strong><small>{{ field.key }}</small></div><span class="field-grip">⠿</span>
            </div>
            <el-empty v-if="!filteredFields.length && initialized" description="没有匹配的字段" :image-size="54" />
          </div>
          <div class="drag-help"><span class="help-symbol"><el-icon><InfoFilled /></el-icon></span><p>拖入字段，或双击绑定到当前格<br /><strong>可选择单值、明细展开或数值合计</strong></p></div>
          <button class="text-button source-quick-link" @click="quickVisible = true" :disabled="store.loading || !editorReady">批量选择字段，一次生成模板 →</button>
        </div>
        <div class="source-footer"><span class="backend-icon"><el-icon><Connection /></el-icon></span><div><strong>为真实数据做好准备</strong><p>当前使用 Mock，后续可接入后端 API</p></div></div>
      </aside>

      <section class="sheet-panel">
        <div class="sheet-mode-bar">
          <div class="mode-tabs"><button :class="{ active: store.mode === 'design' }" @click="store.mode === 'preview' && backToDesign()" :disabled="store.loading"><el-icon><EditPen /></el-icon>模板设计</button><button :class="{ active: store.mode === 'preview' }" @click="store.mode === 'design' && generate()" :disabled="!editorReady || store.loading"><el-icon><View /></el-icon>数据预览</button></div>
          <span class="sheet-context" v-if="store.mode === 'design'"><i></i>编辑模式<span>·</span>字段绑定自动展开</span>
          <span class="sheet-context preview-context" v-else><el-icon><CircleCheck /></el-icon>已生成 {{ store.generated?.recordCount }} 条数据<span>·</span>只读预览</span>
          <button v-if="store.mode === 'design' && issues.length" class="issue-count-button" @click="showProperties = true">{{ issues.length }} 项待处理</button>
          <button class="property-toggle" @click="showProperties = !showProperties" :aria-expanded="showProperties"><el-icon><Setting /></el-icon>属性</button>
        </div>
        <div class="preview-banner" v-if="store.mode === 'preview'"><div><el-icon><CircleCheck /></el-icon><span>正在查看 <strong>{{ store.generated?.sourceName }}</strong> 的生成结果</span></div><button class="text-button" :disabled="store.loading || exporting" @click="backToDesign"><el-icon><ArrowLeft /></el-icon>返回设计</button></div>
        <div v-if="store.mode === 'design'" class="binding-guide" :class="{ 'invalid-drop': dragHint && !dragValid, 'active-drop': dragHint && dragValid }" aria-live="polite"><span>{{ dragHint || (store.detailRow !== undefined ? `明细区域：第 ${store.detailRow + 1} 行（可移动） · 其他位置可自由绑定单值或合计` : '未设置明细区域 · 拖入字段选择用途，或指定要重复展开的行') }}</span><button class="text-button" @click="regionVisible = true" :disabled="store.loading || !editorReady">{{ store.detailRow === undefined ? '设置明细区域' : '调整明细位置' }}</button></div>
        <div class="spreadsheet-area" v-loading="store.loading || (!editorReady && !editorError)" :element-loading-text="regionBusy ? '正在调整明细区域…' : store.loading ? '正在处理报表…' : '正在准备表格…'">
          <div v-if="initialized" v-show="store.mode === 'design'" class="editor-layer" :inert="store.mode !== 'design' || undefined"><SpreadsheetEditor :key="editorKey" ref="editor" :snapshot="store.template.snapshot" :read-only="false" @ready="designReady = true" @change="syncSnapshot" @select="onSelect" @drop="onDrop" @drag-hint="onDragHint" @notice="notify" @failure="message => editorError = message" /></div>
          <div v-if="store.mode === 'preview' && store.generated" class="editor-layer"><SpreadsheetEditor :key="previewKey" :snapshot="store.generated.snapshot" :read-only="true" @ready="previewReady = true" @notice="notify" @failure="message => editorError = message" /></div>
          <div v-if="editorError" class="editor-failure"><el-icon :size="32"><InfoFilled /></el-icon><h3>表格暂时无法加载</h3><p>{{ editorError }}</p><el-button @click="retryEditor">重新加载</el-button></div>
        </div>
        <div class="sheet-status"><div><span class="status-dot"></span>{{ store.mode === 'design' ? '就绪' : '预览已生成' }}<span class="status-divider"></span>{{ detailBindings.length }} 个明细<span class="status-divider"></span>{{ singleBindings.length }} 个单值<span class="status-divider"></span>{{ sumBindings.length }} 个合计</div><span>{{ store.mode === 'design' ? '拖拽字段，开始设计你的报表' : '下载 Excel，与预览保持一致' }}</span></div>
      </section>

      <aside class="properties-panel" :inert="store.loading || undefined">
        <div class="panel-heading"><div><el-icon><Setting /></el-icon><h2>{{ store.mode === 'design' ? '单元格属性' : '生成信息' }}</h2></div><span class="cell-address" v-if="store.mode === 'design'">{{ selected.address }}</span><button class="properties-close icon-button" aria-label="关闭属性面板" @click="showProperties = false"><el-icon><Close /></el-icon></button></div>
        <template v-if="store.mode === 'design'">
          <div class="property-body">
            <div class="property-title"><span class="tiny-icon"><el-icon><Connection /></el-icon></span><h3>数据绑定</h3><span class="bound-tag" v-if="selectedBinding">已绑定</span></div>
            <p class="property-description">为当前单元格选择数据字段与填充方式。</p>
            <label class="form-label">绑定字段</label>
            <el-select v-model="fieldKey" placeholder="选择数据字段" aria-label="绑定字段" clearable class="full-width" :disabled="!editorReady">
              <el-option v-for="field in store.source?.fields" :key="field.key" :value="field.key" :label="field.label"><span class="option-type">{{ typeSymbol(field.type) }}</span>{{ field.label }}</el-option>
            </el-select>
            <label class="form-label spaced-label">填充方式</label>
            <div class="binding-options">
              <button :class="{ chosen: bindingKind === 'single' }" @click="bindingKind = 'single'"><span class="option-radio"></span><div><strong>单值字段</strong><small>读取指定的一条记录，可放任意位置</small></div><el-icon v-if="bindingKind === 'single'"><Check /></el-icon></button>
              <button :class="{ chosen: bindingKind === 'detail' }" @click="bindingKind = 'detail'"><span class="option-radio"></span><div><strong>明细字段</strong><small>按每条记录重复展开，可调整所在行</small></div><el-icon v-if="bindingKind === 'detail'"><Check /></el-icon></button>
              <button :class="{ chosen: bindingKind === 'sum' }" @click="bindingKind = 'sum'" :disabled="currentField && currentField.type !== 'number'"><span class="option-radio"></span><div><strong>数值合计 <span>Σ</span></strong><small>对所有记录的数值求和</small></div><el-icon v-if="bindingKind === 'sum'"><Check /></el-icon></button>
            </div>
            <div v-if="bindingKind === 'single'" class="single-record-control"><label class="form-label" for="single-record-number">取数据源第几条记录</label><el-input-number id="single-record-number" v-model="singleRecordNumber" :min="1" :precision="0" :disabled="store.loading" aria-label="单值记录序号" /><p>从第 1 条开始；没有对应记录时留空。</p></div>
            <p v-if="bindingKind === 'detail' && store.detailRow !== undefined && selected.row !== store.detailRow" class="binding-position-note">应用时可将整条明细区域移到第 {{ selected.row + 1 }} 行。</p>
            <el-button type="primary" class="full-width apply-button" plain @click="applyBinding" :disabled="!fieldKey || !editorReady">{{ selectedBinding ? '更新绑定' : '应用绑定' }}</el-button>
            <button v-if="selectedBinding" class="remove-binding" @click="clearBinding">解除当前绑定</button>
            <div class="binding-detail" v-if="selectedBinding"><div><span>字段标识</span><code>{{ selectedBinding.fieldKey }}</code></div><div><span>数据类型</span><span>{{ typeLabel(selectedBinding.fieldType) }}</span></div></div>
          </div>
          <div class="property-section">
            <div class="section-heading"><h3>模板结构</h3><span>{{ store.bindings.length }} 个绑定</span></div>
            <div class="structure-item"><span class="structure-icon"><Grid /></span><div><strong>明细区域 · 可调整</strong><small>{{ store.detailRow !== undefined ? `第 ${store.detailRow + 1} 行 · ${detailBindings.length} 个字段` : '尚未设置，可使用单值或合计' }}</small></div><span class="structure-tag">循环</span></div>
            <button class="text-button region-panel-link" @click="regionVisible = true">{{ store.detailRow === undefined ? '设置明细区域' : '移动或取消明细区域' }} →</button>
            <div class="binding-chips"><button v-for="binding in detailBindings" :key="`${binding.row}-${binding.column}`" @click="focusBinding(binding)"><span>{{ address(binding.row, binding.column) }}</span>{{ binding.fieldLabel }}</button></div>
            <div class="structure-item total-structure"><span class="structure-icon sum-icon">Σ</span><div><strong>合计单元格</strong><small>{{ sumBindings.length ? `${sumBindings.length} 个数值字段` : '可放在任意单元格' }}</small></div></div>
            <div class="binding-chips"><button v-for="binding in sumBindings" :key="`${binding.row}-${binding.column}`" @click="focusBinding(binding)"><span>{{ address(binding.row, binding.column) }}</span>{{ binding.fieldLabel }}</button></div>
          </div>
          <div v-if="singleBindings.length" class="property-section"><div class="section-heading"><h3>单值字段</h3><span>{{ singleBindings.length }} 个绑定</span></div><div class="binding-chips"><button v-for="binding in singleBindings" :key="`${binding.row}-${binding.column}`" @click="focusBinding(binding)"><span>{{ address(binding.row, binding.column) }}</span>{{ binding.fieldLabel }} · 第 {{ (binding.recordIndex ?? 0) + 1 }} 条</button></div></div>
          <ValidationPanel :issues="issues" @locate="locateIssue" @fix="fixIssue" />
        </template>
        <template v-else>
          <div class="preview-summary"><div class="success-illustration"><el-icon :size="32"><CircleCheck /></el-icon></div><h3>报表已就绪</h3><p>{{ store.generated?.recordCount === 0 ? '无记录时单值留空、合计为零' : detailBindings.length ? '明细区域已展开，单值与合计按各自规则填充' : '单值与合计已填充，不展开明细行' }}</p><div class="preview-count">{{ store.generated?.recordCount }}<span>条数据源记录</span></div><dl><dt>数据源</dt><dd>{{ store.generated?.sourceName }}</dd><dt>明细字段</dt><dd>{{ detailBindings.length }} 个</dd><dt>单值字段</dt><dd>{{ singleBindings.length }} 个</dd><dt>数值合计</dt><dd>{{ sumBindings.length }} 个</dd><dt>生成时间</dt><dd>{{ store.generated && new Date(store.generated.generatedAt).toLocaleTimeString('zh-CN') }}</dd></dl><el-button type="primary" class="full-width" @click="exportReport" :loading="exporting" :disabled="store.loading"><el-icon><Download /></el-icon>下载 Excel 文件</el-button><button class="text-button preview-edit" @click="backToDesign" :disabled="store.loading || exporting"><el-icon><EditPen /></el-icon>继续设计模板</button></div>
        </template>
        <div class="properties-footer"><el-icon><InfoFilled /></el-icon><p>修改自动保存为草稿 · 命名模板独立保留<br />数据与模板均在当前浏览器处理</p></div>
      </aside>
    </main>

    <el-dialog v-model="dataVisible" title="数据源预览" width="900px" class="data-dialog"><div class="data-dialog-meta"><strong>{{ store.source?.name }}</strong><span>共 {{ store.source?.recordCount }} 条记录 · {{ store.source?.fields.length }} 个字段</span></div><el-table :data="dataRows" height="360" v-loading="dataLoading" stripe empty-text="当前数据源没有记录"><el-table-column v-for="field in store.source?.fields" :key="field.key" :prop="field.key" :label="field.label" :min-width="field.type === 'number' ? 100 : 140" :align="field.type === 'number' ? 'right' : 'left'" /></el-table><template #footer><el-button @click="dataVisible = false">关闭</el-button></template></el-dialog>
    <BindingDialog v-model="bindingVisible" :field="pendingBinding?.field" :position="pendingBinding?.position" :detail-row="store.detailRow" :busy="bindingBusy || store.loading" @apply="applyPendingBinding" />
    <DetailRegionDialog v-model="regionVisible" :current-row="store.detailRow" :selected-row="selected.row" :row-count="sheetRowCount" :detail-count="detailBindings.length" :busy="regionBusy" @apply="setRegion" @clear="clearRegion" />
    <QuickCreateDialog v-model="quickVisible" :source="store.source" @create="quickCreate" />
    <TemplateLibraryDialog v-model="libraryVisible" :templates="store.templates" :active-id="store.template.id" @open="openSavedTemplate" @copy="copySavedTemplate" @rename="renameSavedTemplate" @remove="deleteSavedTemplate" />
    <el-dialog v-model="helpVisible" title="让数据，自动成为报表" width="560px" class="help-dialog"><p class="help-intro">bind_sheet 是一款纯前端 Excel 报表设计器。设计一次模板，重复使用不同数据。</p><ol class="help-steps"><li><span>01</span><div><strong>快速建表，或自由设计</strong><p>批量选字段并指定明细行，或从空白开始自由绑定。</p></div></li><li><span>02</span><div><strong>拖入字段，查看就地提示</strong><p>绿色行是可移动的明细区域；其他位置可选择单值、明细或合计。单值可指定取第几条记录，合计位置不限。</p></div></li><li><span>03</span><div><strong>保存模板，生成 Excel</strong><p>修改自动保存为草稿。使用保存／另存为保留多个模板；预览后返回设计保留位置和撤销历史。</p></div></li></ol><div class="help-note">支持单工作表、一个可指定与移动的单行明细区域，以及任意位置的单值/合计。草稿与模板保存在当前浏览器，清理网站数据会移除。请提交单元格编辑后等待自动保存；数据仅在本地处理。</div><template #footer><el-button type="primary" @click="helpVisible = false">开始设计</el-button></template></el-dialog>
  </div>
</template>
