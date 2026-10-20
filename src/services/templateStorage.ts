import type { ReportTemplate } from '../domain/types'

// 沿用历史存储键，确保项目更名后已有模板与草稿仍可读取。
export const LEGACY_TEMPLATE_KEY = 'fangge-report-template-v1'
export const TEMPLATE_LIBRARY_KEY = 'fangge-report-library-v1'
export const TEMPLATE_DRAFT_KEY = 'fangge-report-draft-v1'

export interface TemplateLibrary {
  version: 1
  templates: ReportTemplate[]
  activeId?: string
  // 与模板库一次写入，防止浏览器拒绝清理草稿时恢复已放弃的旧内容。
  draftDiscardedAt?: string
}
export interface TemplateDraft {
  version: 1
  template: ReportTemplate
  savedAt: string
}

function assertTemplate(value: unknown): asserts value is ReportTemplate {
  const template = value as ReportTemplate | undefined
  const snapshot = template?.snapshot
  const sheetId = snapshot?.sheetOrder?.[0]
  if (template?.version !== 1 || typeof template.name !== 'string' ||
    (template.id !== undefined && (typeof template.id !== 'string' || !template.id)) ||
    !Array.isArray(snapshot?.sheetOrder) || snapshot.sheetOrder.length !== 1 ||
    !sheetId || !snapshot.sheets?.[sheetId] || typeof snapshot.sheets[sheetId] !== 'object' ||
    typeof snapshot.id !== 'string') {
    throw new Error('保存的模板格式不兼容，无法读取。')
  }
}
function validTime(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}
export function saveTemplateLibrary(library: TemplateLibrary) {
  localStorage.setItem(TEMPLATE_LIBRARY_KEY, JSON.stringify(library))
}
export function loadTemplateLibrary(): TemplateLibrary {
  const value = localStorage.getItem(TEMPLATE_LIBRARY_KEY)
  if (value) {
    const library = JSON.parse(value) as TemplateLibrary
    if (library?.version !== 1 || !Array.isArray(library.templates)) throw new Error('本地模板库格式不兼容，无法读取。')
    const ids = new Set<string>()
    for (const template of library.templates) {
      assertTemplate(template)
      if (!template.id || ids.has(template.id)) throw new Error('本地模板库标识重复或缺失，无法读取。')
      ids.add(template.id)
    }
    if ((library.activeId !== undefined && !ids.has(library.activeId)) ||
      (library.draftDiscardedAt !== undefined && !validTime(library.draftDiscardedAt))) {
      throw new Error('本地模板库格式不兼容，无法读取。')
    }
    return library
  }
  const legacyValue = localStorage.getItem(LEGACY_TEMPLATE_KEY)
  if (!legacyValue) return { version: 1, templates: [] }
  const legacy = JSON.parse(legacyValue) as ReportTemplate
  assertTemplate(legacy)
  const migrated = { ...legacy, id: legacy.id ?? crypto.randomUUID() }
  const library: TemplateLibrary = { version: 1, templates: [migrated], activeId: migrated.id }
  // 迁移成功后再清理，空间不足时旧模板仍然存在。
  saveTemplateLibrary(library)
  try { localStorage.removeItem(LEGACY_TEMPLATE_KEY) } catch { /* 保留旧备份不会影响新库 */ }
  return library
}
export function loadDraft(): TemplateDraft | undefined {
  const value = localStorage.getItem(TEMPLATE_DRAFT_KEY)
  if (!value) return undefined
  const draft = JSON.parse(value) as TemplateDraft
  if (draft?.version !== 1 || !validTime(draft.savedAt)) throw new Error('自动草稿格式不兼容，无法恢复。')
  assertTemplate(draft.template)
  return draft
}
export function saveDraft(draft: TemplateDraft) {
  localStorage.setItem(TEMPLATE_DRAFT_KEY, JSON.stringify(draft))
}
export function clearDraft() {
  localStorage.removeItem(TEMPLATE_DRAFT_KEY)
}

// 保留旧服务入口，新的编辑界面通过模板库和独立草稿操作。
export function loadTemplate(): ReportTemplate | undefined {
  const library = loadTemplateLibrary()
  return library.templates.find(template => template.id === library.activeId) ?? library.templates[0]
}
export function saveTemplate(template: ReportTemplate): ReportTemplate {
  const library = loadTemplateLibrary()
  const saved = { ...template, id: template.id ?? crypto.randomUUID() }
  saveTemplateLibrary({ ...library, activeId: saved.id, templates: [saved, ...library.templates.filter(item => item.id !== saved.id)] })
  return saved
}
