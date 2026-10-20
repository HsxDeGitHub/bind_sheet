<script setup lang="ts">
import { ref, watch } from 'vue'
const props = defineProps<{ modelValue: boolean; currentRow?: number; selectedRow: number; rowCount: number; detailCount: number; busy?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; apply: [row: number]; clear: [] }>()
const targetRow = ref<number | undefined>(1)
watch(() => props.modelValue, open => { if (open) targetRow.value = Math.min(props.rowCount, Math.max(1, (props.currentRow ?? props.selectedRow) + 1)) })
function apply() { if (!props.busy && targetRow.value !== undefined) emit('apply', targetRow.value - 1) }
</script>

<template>
  <el-dialog :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)" title="设置明细区域" width="510px" class="region-dialog" :close-on-click-modal="!busy" :close-on-press-escape="!busy" :show-close="!busy">
    <p class="dialog-intro">明细区域是按数据记录重复展开的一整行，位置由你指定。</p>
    <div class="region-current"><span>当前区域</span><strong>{{ currentRow === undefined ? '尚未设置' : `第 ${currentRow + 1} 行 · ${detailCount} 个明细字段` }}</strong></div>
    <label class="form-label" for="detail-region-row">明细区域所在行</label>
    <el-input-number id="detail-region-row" v-model="targetRow" :min="1" :max="rowCount" :precision="0" :disabled="busy" aria-label="明细区域所在行" />
    <button class="text-button use-selected-row" :disabled="busy" @click="targetRow = selectedRow + 1">使用当前选中的第 {{ selectedRow + 1 }} 行</button>
    <div class="region-operation-note" v-if="currentRow !== undefined && targetRow !== undefined && targetRow !== currentRow + 1">整条明细行将从第 {{ currentRow + 1 }} 行插入到第 {{ targetRow }} 行，其他行顺移。不会覆盖目标行的内容；样式、合并和字段随行移动，支持撤销。</div>
    <div class="region-operation-note" v-else>设置后，绿色标记会显示该行。将字段按“明细”用途绑定到这里；区域外仍可自由配置单值或合计。</div>
    <p class="region-footnote">当前支持一个单行明细区域。单值和合计可放任意位置；放在明细区域内时，会随整行重复显示。</p>
    <template #footer><el-button v-if="currentRow !== undefined" text type="danger" @click="emit('clear')" :disabled="busy">取消明细区域</el-button><span class="dialog-footer-spacer"></span><el-button @click="emit('update:modelValue', false)" :disabled="busy">取消</el-button><el-button type="primary" @click="apply" :loading="busy" :disabled="targetRow === undefined">{{ currentRow === undefined ? '设置区域' : '应用位置' }}</el-button></template>
  </el-dialog>
</template>
