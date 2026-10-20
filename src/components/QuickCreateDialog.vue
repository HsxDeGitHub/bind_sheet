<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { DataSource } from '../domain/types'
import type { QuickTemplateOptions } from '../domain/quickTemplate'

const props = defineProps<{ modelValue: boolean; source?: DataSource }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  create: [options: QuickTemplateOptions]
}>()
const name = ref('')
const detailRowNumber = ref<number | undefined>(6)
const validDetailRow = computed(() => Number.isSafeInteger(detailRowNumber.value) && (detailRowNumber.value ?? 0) >= 3)
const selectedKeys = ref<string[]>([])
const sumKeys = ref<string[]>([])
const selected = computed(() => props.source?.fields.filter(f => selectedKeys.value.includes(f.key)) ?? [])
const numericFields = computed(() => selected.value.filter(f => f.type === 'number'))
watch(() => props.modelValue, open => {
  if (!open) return
  name.value = '订单明细表'
  detailRowNumber.value = 6
  selectedKeys.value = props.source?.fields.slice(0, 6).map(f => f.key) ?? []
  sumKeys.value = selectedKeys.value.includes('amount') ? ['amount'] : []
})
watch(selectedKeys, keys => { sumKeys.value = sumKeys.value.filter(k => keys.includes(k)) })
function create() {
  if (!validDetailRow.value) return
  emit('create', { name: name.value.trim() || '未命名报表', fields: selected.value, sumFieldKeys: sumKeys.value, defaultSourceId: props.source?.id, detailRow: (detailRowNumber.value ?? 6) - 1 })
}
</script>

<template>
  <el-dialog :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)" title="选择字段，快速建表" width="620px" class="quick-dialog">
    <p class="dialog-intro">自动生成标题、表头和明细模板行，之后可继续调整样式与绑定。</p>
    <label for="quick-report-name" class="form-label">报表名称</label>
    <el-input id="quick-report-name" v-model="name" maxlength="60" placeholder="例如：商品订单明细表" />
    <div class="quick-detail-row-setting">
      <label for="quick-detail-row" class="form-label">明细区域所在行</label>
      <el-input-number id="quick-detail-row" v-model="detailRowNumber" :min="3" :precision="0" :step="1" controls-position="right" aria-label="明细区域所在行" />
      <p>可自行指定，从第 3 行开始；表头在上一行，标题自动安排在上方。后续可移动明细区域。</p>
    </div>
    <div class="quick-section-title"><strong>选择报表字段</strong><span>{{ selected.length }} / {{ source?.fields.length ?? 0 }} 个</span><button class="text-button" @click="selectedKeys = source?.fields.map(f => f.key) ?? []">全选</button><button class="text-button" @click="selectedKeys = []">清空</button></div>
    <el-checkbox-group v-model="selectedKeys" class="quick-field-grid" aria-label="选择报表字段">
      <el-checkbox v-for="field in source?.fields" :key="field.key" :value="field.key" border><span class="quick-field-label">{{ field.label }}<small>{{ field.key }}</small></span><span class="quick-type">{{ field.type === 'number' ? '数值' : field.type === 'date' ? '日期' : '文本' }}</span></el-checkbox>
    </el-checkbox-group>
    <div class="quick-section-title"><strong>需要合计的数值列</strong><span>可选</span></div>
    <el-checkbox-group v-model="sumKeys" aria-label="需要合计的数值列" class="quick-sums"><el-checkbox v-for="field in numericFields" :key="field.key" :value="field.key">{{ field.label }}</el-checkbox><span v-if="!numericFields.length" class="muted">选中数值字段后可配置合计</span></el-checkbox-group>
    <div class="quick-layout-preview"><strong>模板结构预览</strong><div><span>报表标题</span><span>表头 · {{ selected.length }} 列</span><span class="detail-preview">明细区域 · 第 {{ detailRowNumber ?? 6 }} 行 · 按数据记录自动展开</span><span v-if="sumKeys.length">合计 · {{ sumKeys.length }} 列</span></div></div>
    <template #footer><el-button @click="emit('update:modelValue', false)">取消</el-button><el-button type="primary" :disabled="!selected.length || selected.length > 24 || !validDetailRow" @click="create">生成模板</el-button></template>
  </el-dialog>
</template>

<style scoped>
.quick-detail-row-setting { margin-top: 20px; }
.quick-detail-row-setting p { margin: 8px 0 0; font-size: 11px; color: #84957e; line-height: 1.8; }
</style>
