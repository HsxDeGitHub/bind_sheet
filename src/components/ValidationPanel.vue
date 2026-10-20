<script setup lang="ts">
import { CircleCheck, WarningFilled } from '@element-plus/icons-vue'
import { address } from '../domain/bindings'
import type { ReportIssue } from '../domain/validation'

defineProps<{ issues: ReportIssue[] }>()
const emit = defineEmits<{ locate: [issue: ReportIssue]; fix: [issue: ReportIssue] }>()
const actionLabel = (action: ReportIssue['action']) => action === 'unmerge' ? '取消纵向合并' : action === 'rebind' ? '调整绑定' : '选择明细行'
</script>

<template>
  <section class="validation-panel" aria-label="模板检查" aria-live="polite">
    <div class="section-heading"><h3><el-icon><WarningFilled v-if="issues.length" /><CircleCheck v-else /></el-icon>模板检查</h3><span>{{ issues.length ? `${issues.length} 项待处理` : '已通过' }}</span></div>
    <p v-if="!issues.length" class="validation-ok">配置完整，可以生成报表。</p>
    <div v-else class="issue-list">
      <article v-for="issue in issues" :key="issue.id" class="issue-card">
        <button class="issue-location" @click="emit('locate', issue)"><span>{{ issue.row !== undefined && issue.column !== undefined ? address(issue.row, issue.column) : '模板' }}</span><strong>{{ issue.message }}</strong></button>
        <button v-if="issue.action" class="text-button issue-action" @click="emit('fix', issue)">{{ actionLabel(issue.action) }} →</button>
      </article>
    </div>
  </section>
</template>
