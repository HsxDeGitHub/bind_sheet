import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { createTemplate } from '../domain/template'
import { scanBindings } from '../domain/bindings'
import { getDetailRow } from '../domain/detailRegion'
import { dataSourceService } from '../services/dataSource'
import { clearDraft, loadDraft, loadTemplateLibrary, saveDraft as writeDraft, saveTemplateLibrary, type TemplateLibrary } from '../services/templateStorage'
import type { DataSource, GeneratedReport, LocatedBinding, ReportTemplate } from '../domain/types'

const clone = <T,>(value: T): T => structuredClone(value)
const message = (error: unknown) => error instanceof Error ? error.message : '请检查浏览器存储权限或可用空间。'
function nextTime(after?: string) {
  return new Date(Math.max(Date.now(), after ? Date.parse(after) + 1 : 0)).toISOString()
}

export const useDesignerStore = defineStore('designer', () => {
  const template = shallowRef<ReportTemplate>(createTemplate())
  const templates = shallowRef<ReportTemplate[]>([])
  const sources = shallowRef<DataSource[]>([])
  const sourceId = ref('orders-a')
  const generated = shallowRef<GeneratedReport>()
  const bindings = shallowRef<LocatedBinding[]>([])
  const mode = ref<'design' | 'preview'>('design')
  const dirty = ref(false)
  const loading = ref(false)
  const draftSavedAt = ref<string>()
  const draftError = ref('')
  const recoveredDraft = ref(false)
  const hasDraft = computed(() => !!draftSavedAt.value)
  const source = computed(() => sources.value.find(s => s.id === sourceId.value))
  const detailRow = computed(() => getDetailRow(template.value.snapshot))
  let library: TemplateLibrary = { version: 1, templates: [] }

  function selectTemplate(next: ReportTemplate, unsaved = false) {
    template.value = clone(next)
    if (sources.value.some(item => item.id === next.defaultSourceId)) sourceId.value = next.defaultSourceId!
    bindings.value = scanBindings(template.value.snapshot)
    generated.value = undefined
    mode.value = 'design'
    dirty.value = unsaved
  }
  function commitLibrary(next: TemplateLibrary) {
    saveTemplateLibrary(next)
    library = next
    templates.value = clone(next.templates)
  }
  function resetDraftState() {
    draftSavedAt.value = undefined
    draftError.value = ''
    recoveredDraft.value = false
    // 草稿失效时间已随模板库原子写入；清理失败也不会在刷新时误恢复。
    try { clearDraft() } catch { /* 逻辑清除已持久化 */ }
  }
  async function initialize() {
    sources.value = await dataSourceService.listSources()
    const warnings: string[] = []
    try {
      library = loadTemplateLibrary()
      templates.value = clone(library.templates)
      const saved = library.templates.find(item => item.id === library.activeId) ?? library.templates[0]
      if (saved) selectTemplate(saved)
    } catch (error) { warnings.push(`本地模板读取失败：${message(error)}`) }
    try {
      const draft = loadDraft()
      if (draft && (!library.draftDiscardedAt || Date.parse(draft.savedAt) > Date.parse(library.draftDiscardedAt))) {
        selectTemplate(draft.template, true)
        draftSavedAt.value = draft.savedAt
        recoveredDraft.value = true
      }
    } catch (error) {
      draftError.value = `自动草稿恢复失败：${message(error)}`
      warnings.push(draftError.value)
    }
    return warnings.length ? warnings.join('\n') : undefined
  }
  function persist(next: ReportTemplate) {
    const name = next.name.trim() || '未命名报表'
    const saved: ReportTemplate = {
      ...clone(next), id: next.id ?? crypto.randomUUID(), name,
      savedAt: nextTime(), defaultSourceId: sourceId.value,
    }
    saved.snapshot.name = name
    commitLibrary({
      ...library, activeId: saved.id,
      templates: [saved, ...library.templates.filter(item => item.id !== saved.id)],
      draftDiscardedAt: nextTime(draftSavedAt.value),
    })
    template.value = clone(saved)
    bindings.value = scanBindings(saved.snapshot)
    dirty.value = false
    resetDraftState()
    return saved
  }
  function saveAs(next: ReportTemplate, name: string) {
    if (!name.trim()) throw new Error('请输入模板名称。')
    return persist({ ...next, id: undefined, name: name.trim() })
  }
  function openTemplate(id: string) {
    const saved = library.templates.find(item => item.id === id)
    if (!saved) throw new Error('模板不存在，可能已被删除。')
    commitLibrary({ ...library, activeId: id, draftDiscardedAt: nextTime(draftSavedAt.value) })
    selectTemplate(saved)
    resetDraftState()
    return template.value
  }
  function deleteTemplate(id: string) {
    if (!library.templates.some(item => item.id === id)) throw new Error('模板不存在，可能已被删除。')
    const remaining = library.templates.filter(item => item.id !== id)
    const deletingCurrent = template.value.id === id
    commitLibrary({
      ...library, templates: remaining,
      activeId: library.activeId === id ? remaining[0]?.id : library.activeId,
      ...(deletingCurrent ? { draftDiscardedAt: nextTime(draftSavedAt.value) } : {}),
    })
    if (deletingCurrent) {
      const next = { ...template.value, id: undefined, savedAt: undefined }
      selectTemplate(next, true)
      resetDraftState()
    }
  }
  function renameTemplate(id: string, name: string) {
    const saved = library.templates.find(item => item.id === id)
    if (!saved) throw new Error('模板不存在，可能已被删除。')
    if (!name.trim()) throw new Error('请输入模板名称。')
    const isCurrent = template.value.id === id
    if (isCurrent && dirty.value) throw new Error('请先保存当前修改后再重命名。')
    const renamed = { ...clone(saved), name: name.trim(), savedAt: nextTime() }
    renamed.snapshot.name = renamed.name
    commitLibrary({
      ...library,
      templates: library.templates.map(item => item.id === id ? renamed : item),
      ...(isCurrent ? { draftDiscardedAt: nextTime(draftSavedAt.value) } : {}),
    })
    if (isCurrent) {
      template.value = { ...template.value, name: renamed.name, savedAt: renamed.savedAt }
      template.value.snapshot.name = renamed.name
      resetDraftState()
    }
    return renamed
  }
  function saveDraft(next: ReportTemplate) {
    const savedAt = nextTime(library.draftDiscardedAt)
    const draft = { ...clone(next), name: next.name.trim() || '未命名报表', defaultSourceId: sourceId.value }
    draft.snapshot.name = draft.name
    try {
      writeDraft({ version: 1, template: draft, savedAt })
      draftSavedAt.value = savedAt
      draftError.value = ''
      return true
    } catch (error) {
      draftError.value = `自动草稿保存失败：${message(error)}`
      return false
    }
  }
  function discardDraft() {
    commitLibrary({ ...library, draftDiscardedAt: nextTime(draftSavedAt.value) })
    resetDraftState()
  }
  return {
    template, templates, sources, sourceId, source, generated, bindings, mode, dirty, loading, detailRow,
    draftSavedAt, draftError, hasDraft, recoveredDraft,
    initialize, persist, saveAs, openTemplate, deleteTemplate, renameTemplate, saveDraft, discardDraft,
  }
})
