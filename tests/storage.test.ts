import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createTemplate } from '../src/domain/template'
import {
  LEGACY_TEMPLATE_KEY, TEMPLATE_DRAFT_KEY, TEMPLATE_LIBRARY_KEY,
  loadTemplate, loadTemplateLibrary, saveTemplate,
} from '../src/services/templateStorage'
import { useDesignerStore } from '../src/stores/designer'

vi.mock('../src/services/dataSource', () => ({
  dataSourceService: {
    listSources: async () => [{ id: 'orders-a', fields: [] }, { id: 'orders-b', fields: [] }],
  },
}))

let values: Map<string, string>
let failKey: string | undefined
let failRemove: boolean
beforeEach(() => {
  values = new Map()
  failKey = undefined
  failRemove = false
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (key === failKey) throw new Error('浏览器空间不足')
      values.set(key, value)
    },
    removeItem: (key: string) => {
      if (failRemove) throw new Error('浏览器拒绝清理')
      values.delete(key)
    },
  })
  setActivePinia(createPinia())
})
afterEach(() => vi.unstubAllGlobals())

function freshStore() {
  setActivePinia(createPinia())
  return useDesignerStore()
}

describe('模板持久化', () => {
  it('序列化后恢复工作簿、绑定和模板名称', () => {
    expect(loadTemplate()).toBeUndefined()
    const template = createTemplate()
    const saved = saveTemplate(template)
    expect(saved.id).toBeTruthy()
    expect(loadTemplate()).toEqual(saved)
    expect(loadTemplate()).toMatchObject(template)
  })
  it('旧单模板自动迁移至模板库，成功后才清理旧存储', () => {
    const legacy = { ...createTemplate(), name: '原有客户报表' }
    values.set(LEGACY_TEMPLATE_KEY, JSON.stringify(legacy))
    const library = loadTemplateLibrary()
    expect(library.templates).toHaveLength(1)
    expect(library.templates[0]).toMatchObject(legacy)
    expect(library.activeId).toBe(library.templates[0]!.id)
    expect(values.has(TEMPLATE_LIBRARY_KEY)).toBe(true)
    expect(values.has(LEGACY_TEMPLATE_KEY)).toBe(false)
  })
  it('迁移写入失败保留旧模板，不伪造新库', () => {
    const raw = JSON.stringify(createTemplate())
    values.set(LEGACY_TEMPLATE_KEY, raw)
    failKey = TEMPLATE_LIBRARY_KEY
    expect(() => loadTemplateLibrary()).toThrow('空间不足')
    expect(values.get(LEGACY_TEMPLATE_KEY)).toBe(raw)
    expect(values.has(TEMPLATE_LIBRARY_KEY)).toBe(false)
  })
  it('拒绝损坏或版本不兼容的本地模板', () => {
    values.set(LEGACY_TEMPLATE_KEY, '{broken')
    expect(() => loadTemplate()).toThrow()
    values.set(LEGACY_TEMPLATE_KEY, JSON.stringify({ version: 1, name: '坏模板', snapshot: { id: 'test', sheetOrder: ['missing'], sheets: {} } }))
    expect(() => loadTemplate()).toThrow('不兼容')
    values.set(LEGACY_TEMPLATE_KEY, JSON.stringify({ ...createTemplate(), version: 2 }))
    expect(() => loadTemplate()).toThrow('不兼容')
  })
  it('浏览器空间不足时向调用方报告失败', () => {
    failKey = TEMPLATE_LIBRARY_KEY
    expect(() => saveTemplate(createTemplate())).toThrow('空间不足')
  })
})

describe('多模板与独立自动草稿', () => {
  it('命名保存更新当前 id，另存为使用新 id，两个模板内容互不覆盖', async () => {
    const store = useDesignerStore()
    await store.initialize()
    const first = store.persist({ ...createTemplate(), name: '客户甲' })
    const second = store.saveAs({ ...first, name: '客户乙', snapshot: { ...first.snapshot, name: '客户乙' } }, '客户乙')
    expect(second.id).not.toBe(first.id)
    expect(store.templates).toHaveLength(2)
    store.persist({ ...second, name: '客户乙新版' })
    expect(store.templates).toHaveLength(2)
    expect(store.templates.find(item => item.id === first.id)?.name).toBe('客户甲')
    store.openTemplate(first.id!)
    expect(store.template.name).toBe('客户甲')
    store.template.snapshot.name = '尚未保存的工作簿'
    expect(store.templates.find(item => item.id === first.id)?.snapshot.name).toBe('客户甲')
  })
  it('自动草稿不覆盖命名模板，刷新恢复修改和所选数据源', async () => {
    const store = useDesignerStore()
    await store.initialize()
    const saved = store.persist({ ...createTemplate(), name: '原模板' })
    store.sourceId = 'orders-b'
    const changed = { ...saved, name: '修改中的草稿' }
    expect(store.saveDraft(changed)).toBe(true)
    expect(store.templates[0]!.name).toBe('原模板')
    expect(store.hasDraft).toBe(true)
    const restored = freshStore()
    await restored.initialize()
    expect(restored.template.name).toBe('修改中的草稿')
    expect(restored.sourceId).toBe('orders-b')
    expect(restored.dirty).toBe(true)
    expect(restored.recoveredDraft).toBe(true)
    expect(restored.templates[0]!.name).toBe('原模板')
  })
  it('保存失败保留当前模板、模板库和未保存状态', async () => {
    const store = useDesignerStore()
    await store.initialize()
    const saved = store.persist(createTemplate())
    store.dirty = true
    failKey = TEMPLATE_LIBRARY_KEY
    expect(() => store.saveAs({ ...saved, name: '新模板' }, '新模板')).toThrow('空间不足')
    expect(store.template.id).toBe(saved.id)
    expect(store.templates).toHaveLength(1)
    expect(store.dirty).toBe(true)
    expect(() => store.deleteTemplate(saved.id!)).toThrow('空间不足')
    expect(store.templates).toHaveLength(1)
  })
  it('自动草稿失败显示错误且不误报新的保存时间', async () => {
    const store = useDesignerStore()
    await store.initialize()
    expect(store.saveDraft(createTemplate())).toBe(true)
    const savedAt = store.draftSavedAt
    failKey = TEMPLATE_DRAFT_KEY
    expect(store.saveDraft({ ...createTemplate(), name: '不能写入' })).toBe(false)
    expect(store.draftSavedAt).toBe(savedAt)
    expect(store.draftError).toContain('自动草稿保存失败')
    expect(store.draftError).toContain('空间不足')
  })
  it('命名保存成功后，即使草稿清理失败也不会恢复过时草稿', async () => {
    const store = useDesignerStore()
    await store.initialize()
    store.saveDraft({ ...createTemplate(), name: '旧草稿' })
    failRemove = true
    store.persist({ ...createTemplate(), name: '正式模板' })
    expect(store.hasDraft).toBe(false)
    expect(values.has(TEMPLATE_DRAFT_KEY)).toBe(true)
    const restored = freshStore()
    await restored.initialize()
    expect(restored.template.name).toBe('正式模板')
    expect(restored.dirty).toBe(false)
    expect(restored.recoveredDraft).toBe(false)
  })
  it('放弃草稿后刷新恢复最近打开模板，而非已放弃草稿', async () => {
    const store = useDesignerStore()
    await store.initialize()
    const first = store.persist({ ...createTemplate(), name: '模板甲' })
    store.saveAs(createTemplate(), '模板乙')
    store.saveDraft({ ...store.template, name: '未保存内容' })
    store.openTemplate(first.id!)
    const restored = freshStore()
    await restored.initialize()
    expect(restored.template.name).toBe('模板甲')
    expect(restored.hasDraft).toBe(false)
    restored.saveDraft({ ...restored.template, name: '另一次未保存内容' })
    restored.discardDraft()
    const afterDiscard = freshStore()
    await afterDiscard.initialize()
    expect(afterDiscard.template.name).toBe('模板甲')
  })
  it('重命名不切换当前模板，当前有修改时拒绝覆盖工作簿', async () => {
    const store = useDesignerStore()
    await store.initialize()
    const first = store.persist({ ...createTemplate(), name: '模板甲' })
    const second = store.saveAs(createTemplate(), '模板乙')
    store.renameTemplate(first.id!, '模板甲改名')
    expect(store.template.id).toBe(second.id)
    expect(store.templates.find(item => item.id === first.id)?.name).toBe('模板甲改名')
    store.dirty = true
    expect(() => store.renameTemplate(second.id!, '当前改名')).toThrow('请先保存')
    expect(store.template.name).toBe('模板乙')
    store.dirty = false
    store.renameTemplate(second.id!, '当前改名')
    expect(store.template.name).toBe('当前改名')
  })
  it('删除当前模板保留工作簿为未命名草稿，其他模板保留', async () => {
    const store = useDesignerStore()
    await store.initialize()
    const first = store.persist({ ...createTemplate(), name: '模板甲' })
    const current = store.saveAs(createTemplate(), '模板乙')
    const snapshotId = current.snapshot.id
    store.deleteTemplate(current.id!)
    expect(store.template.id).toBeUndefined()
    expect(store.template.savedAt).toBeUndefined()
    expect(store.template.snapshot.id).toBe(snapshotId)
    expect(store.dirty).toBe(true)
    expect(store.templates.map(item => item.id)).toEqual([first.id])
  })
  it('损坏的草稿不影响已保存模板恢复，错误可持续展示', async () => {
    const store = useDesignerStore()
    await store.initialize()
    store.persist({ ...createTemplate(), name: '完整模板' })
    values.set(TEMPLATE_DRAFT_KEY, '{broken')
    const restored = freshStore()
    const warning = await restored.initialize()
    expect(restored.template.name).toBe('完整模板')
    expect(restored.templates).toHaveLength(1)
    expect(warning).toContain('自动草稿恢复失败')
    expect(restored.draftError).toContain('自动草稿恢复失败')
  })
})
