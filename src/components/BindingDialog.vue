<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CellPosition, DataField } from '../domain/types'

const props = defineProps<{
  modelValue: boolean
  field?: DataField
  position?: CellPosition
  detailRow?: number
  busy?: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  apply: [options: { kind: 'detail' | 'single' | 'sum'; recordIndex: number; moveDetail: boolean }]
}>()
const kind = ref<'detail' | 'single' | 'sum'>('single')
const recordNumber = ref<number | undefined>(1)
const movesDetail = computed(() => kind.value === 'detail' && props.detailRow !== undefined && props.position !== undefined && props.detailRow !== props.position.row)
const repeatsWithDetail = computed(() => kind.value !== 'detail' && props.detailRow !== undefined && props.position?.row === props.detailRow)
const validRecord = computed(() => Number.isInteger(recordNumber.value) && (recordNumber.value ?? 0) >= 1)
const canApply = computed(() => !!props.field && !!props.position && !props.busy && (kind.value !== 'sum' || props.field.type === 'number') && (kind.value !== 'single' || validRecord.value))
watch(() => props.modelValue, open => {
  if (!open) return
  kind.value = props.detailRow !== undefined && props.position?.row === props.detailRow ? 'detail' : 'single'
  recordNumber.value = 1
})
function close(value: boolean) {
  if (!props.busy) emit('update:modelValue', value)
}
function apply() {
  if (!canApply.value) return
  emit('apply', { kind: kind.value, recordIndex: Math.max(0, (recordNumber.value ?? 1) - 1), moveDetail: movesDetail.value })
}
</script>

<template>
  <el-dialog :model-value="modelValue" @update:model-value="close" title="设置字段绑定" width="570px" class="binding-dialog" :close-on-click-modal="!busy" :close-on-press-escape="!busy" :show-close="!busy">
    <p class="dialog-intro">将 <strong>{{ field?.label }}</strong> 绑定到 <strong>{{ position?.address }}</strong>。选择这个单元格的用途，再应用到模板。</p>
    <el-radio-group v-model="kind" :disabled="busy" class="binding-choices" aria-label="字段绑定用途">
      <el-radio value="single" border><span class="binding-choice"><strong>单值</strong><small>从指定记录取一个值，适合标题、客户名称等位置</small></span></el-radio>
      <el-radio value="detail" border><span class="binding-choice"><strong>明细</strong><small>整行按记录重复展开，生成多条明细</small></span></el-radio>
      <el-radio value="sum" border :disabled="field?.type !== 'number' || busy"><span class="binding-choice"><strong>合计</strong><small>{{ field?.type === 'number' ? '对当前数据源中该字段的全部记录求和' : '仅数值字段支持合计' }}</small></span></el-radio>
    </el-radio-group>
    <div v-if="kind === 'single'" class="binding-options">
      <label for="binding-record-number" class="form-label">取第几条记录</label>
      <el-input-number id="binding-record-number" v-model="recordNumber" :min="1" :precision="0" :step="1" :disabled="busy" controls-position="right" aria-label="取第几条记录" />
      <p class="binding-hint">默认为第 1 条，可修改记录序号；数据为空、该条记录不存在或字段值为空时，单元格留空。</p>
    </div>
    <div v-if="kind === 'detail'" class="binding-options">
      <el-alert v-if="movesDetail" type="warning" :closable="false" show-icon title="应用后将移动整条明细区域">
        整条明细区域从第 {{ (detailRow ?? 0) + 1 }} 行移动至第 {{ (position?.row ?? 0) + 1 }} 行，其他行顺移，可撤销。已有明细绑定及同行内容会一起移动。
      </el-alert>
      <p v-else class="binding-hint">{{ detailRow === undefined ? `将在第 ${(position?.row ?? 0) + 1} 行建立明细区域。` : `第 ${detailRow + 1} 行是当前明细区域。` }}生成时，这一行会按数据记录自动展开。</p>
    </div>
    <el-alert v-if="repeatsWithDetail" class="binding-repeat-warning" type="info" :closable="false" show-icon title="这个单元格位于明细行">
      生成时会随整行重复。需要只显示一次时，请将单值或合计绑定放在明细区域之外。
    </el-alert>
    <template #footer><el-button :disabled="busy" @click="close(false)">取消</el-button><el-button type="primary" :disabled="!canApply" :loading="busy" @click="apply">应用绑定</el-button></template>
  </el-dialog>
</template>

<style scoped>
.binding-dialog .dialog-intro { margin: 0 0 18px; }
.binding-choices { display: flex; flex-direction: column; align-items: stretch; gap: 10px; width: 100%; }
.binding-choices .el-radio { width: 100%; height: auto; min-height: 68px; padding: 13px 16px; margin: 0; }
.binding-choices :deep(.el-radio__label) { white-space: normal; }
.binding-choice { display: flex; flex-direction: column; gap: 7px; }
.binding-choice strong { font-size: 13px; font-weight: 500; }
.binding-choice small { font-size: 11px; color: #84957e; line-height: 1.6; }
.binding-options { margin-top: 20px; }
.binding-hint { margin: 10px 0 0; color: #7b8a74; font-size: 12px; line-height: 1.9; }
.binding-repeat-warning { margin-top: 16px; }
.binding-options :deep(.el-alert__description), .binding-repeat-warning :deep(.el-alert__description) { line-height: 1.8; }
</style>
