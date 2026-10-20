<script setup lang="ts">
import { computed, ref } from 'vue'
import { CopyDocument, Delete, EditPen, Search } from '@element-plus/icons-vue'
import { scanBindings } from '../domain/bindings'
import type { ReportTemplate } from '../domain/types'

const props = defineProps<{ modelValue: boolean; templates: ReportTemplate[]; activeId?: string }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  open: [id: string]
  copy: [template: ReportTemplate]
  rename: [template: ReportTemplate]
  remove: [template: ReportTemplate]
}>()
const query = ref('')
const visible = computed(() => props.templates.filter(t => t.name.toLowerCase().includes(query.value.trim().toLowerCase())))
</script>

<template>
  <el-dialog :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)" title="我的模板" width="760px" class="library-dialog">
    <p class="dialog-intro">已保存的模板独立保留。自动草稿只用于恢复最近一次未保存的工作。</p>
    <el-input v-model="query" :prefix-icon="Search" clearable placeholder="搜索模板名称" aria-label="搜索模板名称" />
    <div class="library-grid" v-if="visible.length">
      <article class="template-card" v-for="template in visible" :key="template.id" :class="{ current: template.id === activeId }">
        <div class="template-card-top"><strong :title="template.name">{{ template.name }}</strong><span v-if="template.id === activeId">当前模板</span></div>
        <div class="mini-sheet" aria-hidden="true"><i v-for="n in 18" :key="n" :class="{ header: n <= 6, detail: n > 6 && n <= 12 }"></i></div>
        <p>{{ scanBindings(template.snapshot).length }} 个绑定<span>·</span>{{ template.savedAt ? new Date(template.savedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '尚未保存' }}</p>
        <div class="template-card-actions"><el-button size="small" type="primary" plain @click="emit('open', template.id!)">打开模板</el-button><span></span><el-button text :icon="CopyDocument" title="复制模板" :aria-label="`复制模板 ${template.name}`" @click="emit('copy', template)" /><el-button text :icon="EditPen" title="重命名" :aria-label="`重命名模板 ${template.name}`" @click="emit('rename', template)" /><el-button text :icon="Delete" title="删除模板" :aria-label="`删除模板 ${template.name}`" @click="emit('remove', template)" /></div>
      </article>
    </div>
    <el-empty v-else :description="query ? '没有找到这个名称的模板' : '还没有已保存的模板，点击“保存模板”保留当前设计'" :image-size="90" />
    <template #footer><span class="library-storage-note">模板保存在当前浏览器，不会自动上传。</span><el-button @click="emit('update:modelValue', false)">关闭</el-button></template>
  </el-dialog>
</template>
