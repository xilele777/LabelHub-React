<template>
  <a-spin :spinning="annotationStore.loading && annotationStore.dataItems.length === 0">
    <section class="annotation-workbench">
      <a-alert
        v-if="annotationStore.error"
        type="error"
        show-icon
        closable
        :message="annotationStore.error"
        class="page-alert"
        @close="annotationStore.error = null"
      />

      <a-empty
        v-if="!annotationStore.loading && annotationStore.dataItems.length === 0"
        description="暂无分配给您的标注数据"
      >
        <a-space direction="vertical" align="center">
          <a-typography-text type="secondary">
            可以等待负责人分配，或从任务池领取待标注数据。
          </a-typography-text>
          <a-button type="primary" @click="openClaimModal">领取标注任务</a-button>
        </a-space>
      </a-empty>

      <template v-else-if="currentItem && currentTask && templateSchema">
        <a-card size="small" class="workbench-header">
          <div class="header-row">
            <a-space wrap>
              <a-typography-title :level="5" class="task-title">
                {{ currentTask.name || '标注任务' }}
              </a-typography-title>
              <a-tag :color="statusMeta.color">{{ statusMeta.label }}</a-tag>
              <a-typography-text type="secondary">
                {{ currentIndexInTask + 1 }} / {{ sameTaskItems.length }}
              </a-typography-text>
            </a-space>
            <a-steps
              size="small"
              :current="progressCurrent"
              class="progress-steps"
              :items="progressItems"
            />
          </div>
          <a-typography-text
            v-if="currentTask?.instructions"
            type="secondary"
            class="task-instructions"
          >
            {{ currentTask.instructions }}
          </a-typography-text>
        </a-card>

        <a-alert
          v-if="annotationStore.conflictInfo"
          type="error"
          show-icon
          class="page-alert"
          message="并发冲突：数据已被其他操作修改"
          :description="`服务器版本为 ${annotationStore.conflictInfo.currentVersion}，请先同步服务端数据后再继续提交。`"
        >
          <template #action>
            <a-space>
              <a-button size="small" danger @click="resolveConflict">使用服务端数据</a-button>
              <a-button size="small" @click="annotationStore.clearConflict()">稍后处理</a-button>
            </a-space>
          </template>
        </a-alert>

        <a-alert
          v-if="annotationStore.lockInfo"
          type="warning"
          show-icon
          class="page-alert"
          message="该数据正在被其他人编辑（悲观锁生效）"
          :description="`持锁人：${annotationStore.lockInfo.lockedBy || '未知'}；加锁时间：${formatLockTime(annotationStore.lockInfo.lockedAt)}。锁超时 30 分钟后自动释放。`"
        >
          <template #action>
            <a-space>
              <a-button
                size="small"
                type="primary"
                :loading="lockAcquiring"
                @click="retryAcquireLock"
              >
                重试加锁
              </a-button>
              <a-button size="small" @click="annotationStore.clearConflict()">稍后处理</a-button>
            </a-space>
          </template>
        </a-alert>

        <a-alert
          v-if="isCrossTabLocked"
          type="warning"
          show-icon
          class="page-alert"
          message="该数据正在本浏览器的另一个标签页中编辑"
          description="同一账号同时只能在一个标签页编辑同一条数据，请切回原标签页继续，或在原标签页离开该条目后再编辑。"
        />

        <div class="workbench-main">
          <a-card title="原始数据" size="small" class="panel-card raw-panel">
            <pre class="raw-json">{{ prettyRawData }}</pre>
          </a-card>

          <a-card size="small" class="panel-card form-panel">
            <template #title>
              <a-space>
                <span>标注表单</span>
                <a-tag :color="liveReviewMeta.tagColor">{{ liveReviewMeta.label }}</a-tag>
                <a-tag>{{ liveReviewResult.score }} 分</a-tag>
              </a-space>
            </template>

            <a-alert
              :type="liveReviewMeta.alertType"
              show-icon
              class="review-alert"
              :message="liveReviewResult.summary"
              :description="reviewDescription"
            />

            <a-form
              ref="formRef"
              layout="vertical"
              class="dynamic-form"
              :model="formState"
              :disabled="!isEditable"
            >
              <template v-for="field in templateSchema.fields" :key="field.id">
                <section v-if="field.type === FieldType.TITLE" class="schema-title-block">
                  <component :is="`h${getTitleLevel(field)}`" class="schema-title">
                    {{ field.label }}
                  </component>
                  <p v-if="getStringField(field, 'content')" class="schema-copy">
                    {{ getStringField(field, 'content') }}
                  </p>
                  <p v-if="field.description" class="schema-description">{{ field.description }}</p>
                </section>

                <a-form-item
                  v-else
                  :name="field.fieldKey"
                  :label="field.label"
                  :rules="buildFieldRules(field)"
                  :validate-status="fieldValidateStatus(field.fieldKey)"
                  :help="fieldHelp(field.fieldKey)"
                  :data-field-key="field.fieldKey"
                  :aria-label="field.label"
                >
                  <template #label>
                    <span class="field-label">
                      {{ field.label }}
                      <a-tooltip v-if="field.description" :title="field.description">
                        <QuestionCircleOutlined class="field-help-icon" />
                      </a-tooltip>
                    </span>
                  </template>

                  <a-input
                    v-if="field.type === FieldType.INPUT"
                    v-model:value="formState[field.fieldKey]"
                    :placeholder="field.placeholder"
                    :maxlength="getNumberField(field, 'maxLength')"
                    :show-count="Boolean(getNumberField(field, 'maxLength'))"
                  />

                  <a-textarea
                    v-else-if="field.type === FieldType.TEXTAREA"
                    v-model:value="formState[field.fieldKey]"
                    :placeholder="field.placeholder"
                    :maxlength="getNumberField(field, 'maxLength')"
                    :show-count="Boolean(getNumberField(field, 'maxLength'))"
                    :auto-size="
                      getBooleanField(field, 'autoSize') ? { minRows: 3, maxRows: 8 } : false
                    "
                  />

                  <a-radio-group
                    v-else-if="field.type === FieldType.RADIO"
                    v-model:value="formState[field.fieldKey]"
                    :options="getOptions(field)"
                    :class="{ 'choice-group--vertical': getDirection(field) === 'vertical' }"
                  />

                  <a-checkbox-group
                    v-else-if="field.type === FieldType.CHECKBOX"
                    v-model:value="formState[field.fieldKey]"
                    :options="getOptions(field)"
                    :class="{ 'choice-group--vertical': getDirection(field) === 'vertical' }"
                  />

                  <a-select
                    v-else-if="field.type === FieldType.SELECT"
                    v-model:value="formState[field.fieldKey]"
                    :placeholder="field.placeholder"
                    :show-search="getBooleanField(field, 'searchable')"
                    :mode="getBooleanField(field, 'multiple') ? 'multiple' : undefined"
                    :options="getOptions(field)"
                    allow-clear
                  />

                  <a-rate
                    v-else-if="field.type === FieldType.RATING"
                    v-model:value="formState[field.fieldKey]"
                    :count="getNumberField(field, 'maxScore', 5)"
                    :allow-half="getBooleanField(field, 'allowHalf')"
                  />

                  <a-switch
                    v-else-if="field.type === FieldType.SWITCH"
                    v-model:checked="formState[field.fieldKey]"
                    :checked-children="getStringField(field, 'checkedChildren', '是')"
                    :un-checked-children="getStringField(field, 'unCheckedChildren', '否')"
                  />
                </a-form-item>
              </template>
            </a-form>
          </a-card>

          <a-card title="实时预审" size="small" class="panel-card review-panel">
            <div class="score-box">
              <a-progress
                type="dashboard"
                :percent="liveReviewResult.score"
                :stroke-color="liveReviewMeta.strokeColor"
              />
              <a-typography-text strong :style="{ color: liveReviewMeta.strokeColor }">
                {{ liveReviewMeta.label }}
              </a-typography-text>
            </div>

            <a-space wrap class="risk-tags">
              <a-tag color="red">严重 {{ riskStats.error }}</a-tag>
              <a-tag color="orange">警告 {{ riskStats.warning }}</a-tag>
              <a-tag color="blue">提示 {{ riskStats.info }}</a-tag>
            </a-space>

            <a-empty
              v-if="liveReviewResult.fieldWarnings.length === 0"
              description="未发现预审风险"
            />
            <a-list v-else size="small" :data-source="sortedWarnings" class="warning-list">
              <template #renderItem="{ item }">
                <a-list-item class="warning-item" @click="scrollToField(item.fieldKey)">
                  <a-list-item-meta>
                    <template #title>
                      <a-space>
                        <a-tag :color="severityColor(item.severity)">
                          {{ severityLabel(item.severity) }}
                        </a-tag>
                        <a-typography-text strong>{{ item.fieldLabel }}</a-typography-text>
                      </a-space>
                    </template>
                    <template #description>
                      <span>{{ item.message }}</span>
                    </template>
                  </a-list-item-meta>
                </a-list-item>
              </template>
            </a-list>
          </a-card>
        </div>

        <a-card size="small" class="footer-actions">
          <div class="footer-row">
            <a-space>
              <a-button :disabled="!canPrev" @click="goPrev">上一条</a-button>
              <a-button :disabled="!canNext" @click="goNext">下一条</a-button>
              <a-button @click="openClaimModal">领取更多</a-button>
            </a-space>
            <a-space>
              <a-button
                v-if="canSaveDraft"
                :disabled="Boolean(annotationStore.conflictInfo)"
                @click="saveDraft"
              >
                保存草稿
              </a-button>
              <a-button
                v-if="!isReadOnly"
                type="primary"
                :loading="submitting"
                :disabled="Boolean(annotationStore.conflictInfo) || riskStats.error > 0"
                @click="submitCurrent"
              >
                {{ currentItem.status === DataItemStatus.REJECTED ? '重新提交' : '提交' }}
              </a-button>
              <a-tag v-else color="success">已提交</a-tag>
            </a-space>
          </div>
        </a-card>
      </template>

      <template v-else-if="currentItem && taskStore.loading">
        <a-spin class="page-loading" tip="正在加载关联任务…" />
      </template>

      <a-result
        v-else-if="currentItem && taskStore.error"
        status="error"
        title="任务信息加载失败"
        :sub-title="taskStore.error"
      >
        <template #extra>
          <a-button type="primary" @click="retryLoadDependencies">重试</a-button>
        </template>
      </a-result>

      <a-result
        v-else-if="currentItem && !currentTask"
        status="warning"
        title="关联任务不存在或不可用"
        sub-title="当前标注数据关联的任务未能加载，可能已被删除或配置异常。"
      >
        <template #extra>
          <a-button type="primary" @click="retryLoadDependencies">重新加载</a-button>
        </template>
      </a-result>

      <a-result
        v-else-if="currentTask && !currentTask.templateId"
        status="warning"
        title="任务未配置模板"
        sub-title="请联系负责人为该任务绑定标注模板后再继续。"
      >
        <template #extra>
          <a-button type="primary" @click="retryLoadDependencies">重新加载</a-button>
        </template>
      </a-result>

      <template v-else-if="currentItem && currentTask && templateLoading">
        <a-spin class="page-loading" tip="正在加载标注模板…" />
      </template>

      <a-result
        v-else-if="currentItem && currentTask && templateError"
        status="error"
        title="标注模板加载失败"
        :sub-title="templateError"
      >
        <template #extra>
          <a-space>
            <a-button type="primary" @click="retryLoadTemplate">重试加载模板</a-button>
            <a-button @click="retryLoadDependencies">刷新全部依赖</a-button>
          </a-space>
        </template>
      </a-result>

      <a-result
        v-else-if="currentItem && currentTask && !templateSchema"
        status="warning"
        title="未找到标注模板"
        :sub-title="`模板 ${currentTask.templateId} 不存在或已被删除。`"
      >
        <template #extra>
          <a-space>
            <a-button type="primary" @click="retryLoadTemplate">重试加载模板</a-button>
            <a-button @click="retryLoadDependencies">刷新全部依赖</a-button>
          </a-space>
        </template>
      </a-result>

      <a-spin v-else class="page-loading" />
    </section>

    <a-modal
      v-model:open="claimModalOpen"
      title="领取标注任务"
      width="760px"
      :footer="null"
      destroy-on-close
    >
      <div class="lh-modal-stack">
        <a-space wrap class="claim-toolbar lh-modal-toolbar">
          <a-select
            v-model:value="claimTaskId"
            allow-clear
            placeholder="全部任务"
            class="claim-select"
            :options="runningTaskOptions"
          />
          <a-button @click="fetchAvailableItems">刷新</a-button>
          <a-button
            type="primary"
            :loading="batchClaiming"
            :disabled="selectedClaimIds.length === 0"
            @click="claimSelectedItems"
          >
            批量领取 {{ selectedClaimIds.length || '' }}
          </a-button>
        </a-space>
        <a-table
          row-key="id"
          size="small"
          class="lh-modal-table"
          :loading="annotationStore.availableLoading"
          :data-source="annotationStore.availableItems"
          :pagination="{ pageSize: 8 }"
          :row-selection="{ selectedRowKeys: selectedClaimIds, onChange: onClaimSelectionChange }"
          :columns="claimColumns"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'taskId'">
              {{ taskName(record.taskId) }}
            </template>
            <template v-else-if="column.key === 'action'">
              <a-button
                size="small"
                type="primary"
                :loading="claimingId === record.id"
                @click="claimOneItem(record.id)"
              >
                领取
              </a-button>
            </template>
          </template>
        </a-table>
      </div>
    </a-modal>
  </a-spin>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { message, Modal, type FormInstance, type TableColumnsType } from 'ant-design-vue';
import { QuestionCircleOutlined } from '@ant-design/icons-vue';
import {
  DataItemStatus,
  FieldType,
  Role,
  TaskStatus,
  type AnnotationTemplate,
  type DataItem,
  type TaskItem,
} from '../../types';
import { ReviewStatus, type Severity } from '../../types/aiReview';
import { useAnnotationStore, type AvailableItem } from '../../store/useAnnotationStore';
import { useAuthStore } from '../../store/useAuthStore';
import { useTaskStore } from '../../store/useTaskStore';
import { getTemplateSchemaAsync } from '../../utils/templateSchemaHelper';
import { SEMANTIC_COLORS } from '../../utils/statusMeta';
import { useDraftPersistence } from '../../composables/useDraftPersistence';
import { useEditLock } from './composables/useEditLock';
import { useLivePreReview } from './composables/useLivePreReview';
import { useCrossTabLock } from '../../composables/useCrossTabLock';
import {
  buildFieldRules,
  getBooleanField,
  getDirection,
  getNumberField,
  getOptions,
  getStringField,
  getTitleLevel,
} from './fieldHelpers';
import {
  connectNotificationWS,
  getSocket,
  joinTaskRoom,
  leaveTaskRoom,
  type Notification,
} from '../../services/notificationWebSocket';

const route = useRoute();
const annotationStore = useAnnotationStore();
const taskStore = useTaskStore();
const authStore = useAuthStore();

const formRef = ref<FormInstance>();
const templateSchema = ref<AnnotationTemplate | null>(null);
const templateLoading = ref(false);
const templateError = ref<string | null>(null);
const templateRequestToken = ref(0);
const formState = reactive<Record<string, unknown>>({});
const submitting = ref(false);
const claimModalOpen = ref(false);
const claimTaskId = ref<string>();
const claimingId = ref<string | null>(null);
const batchClaiming = ref(false);
const selectedClaimIds = ref<string[]>([]);
const joinedTaskIds = new Set<string>();

const queryTaskId = computed(() =>
  typeof route.query.taskId === 'string' ? route.query.taskId : undefined,
);
const queryDataItemId = computed(() =>
  typeof route.query.dataItemId === 'string' ? route.query.dataItemId : undefined,
);

const currentItem = computed<DataItem | undefined>(
  () => annotationStore.dataItems[annotationStore.currentIndex],
);
const currentTask = computed<TaskItem | undefined>(() =>
  currentItem.value
    ? taskStore.tasks.find((task) => task.id === currentItem.value?.taskId)
    : undefined,
);
const sameTaskItems = computed(() =>
  currentItem.value
    ? annotationStore.dataItems.filter((item) => item.taskId === currentItem.value?.taskId)
    : [],
);
const currentIndexInTask = computed(() =>
  currentItem.value
    ? sameTaskItems.value.findIndex((item) => item.id === currentItem.value?.id)
    : -1,
);
const canPrev = computed(() => annotationStore.currentIndex > 0);
const canNext = computed(() => annotationStore.currentIndex < annotationStore.dataItems.length - 1);
const isReadOnly = computed(() => {
  const status = currentItem.value?.status;
  return (
    status === DataItemStatus.SUBMITTED ||
    status === DataItemStatus.AI_REVIEWING ||
    status === DataItemStatus.AI_REVIEWED ||
    status === DataItemStatus.PENDING_REVIEW ||
    status === DataItemStatus.REVIEWED
  );
});
// ── 跨标签页锁检测（BroadcastChannel，条目粒度）─────────────
const crossTab = useCrossTabLock(authStore.user?.id ?? '');
const isCrossTabLocked = computed(() =>
  Boolean(currentItem.value && crossTab.lockedItemId.value === currentItem.value.id),
);
const isEditable = computed(
  () =>
    !isReadOnly.value &&
    !annotationStore.conflictInfo &&
    !annotationStore.lockInfo &&
    !isCrossTabLocked.value,
);
const canSaveDraft = computed(
  () => !isReadOnly.value && currentItem.value?.status !== DataItemStatus.REJECTED,
);

// ── 实时预审引擎（composable）──────────────────────────
const { liveReviewResult, riskStats, sortedWarnings, fieldValidateStatus, fieldHelp } =
  useLivePreReview({ templateSchema, currentItem, formState });

// ── 悲观编辑锁：进入可编辑条目自动加锁，切换/提交/离开自动释放 ──
const { acquiring: lockAcquiring, retry: retryAcquireLock } = useEditLock({
  itemId: () => currentItem.value?.id ?? null,
  enabled: () =>
    Boolean(currentItem.value) &&
    !isReadOnly.value &&
    authStore.user?.role === Role.ANNOTATOR &&
    !isCrossTabLocked.value,
  claim: async (id) => {
    const result = await annotationStore.claimItem(id);
    if (result && authStore.user?.id) {
      crossTab.broadcastLock(id, authStore.user.id);
    }
    return result;
  },
  release: async (id) => {
    crossTab.broadcastRelease(id);
    await annotationStore.releaseItem(id);
  },
});

const statusMeta = computed(() => {
  const status = currentItem.value?.status ?? DataItemStatus.PENDING;
  return dataStatusMeta[status];
});
const progressCurrent = computed(() => {
  const status = currentItem.value?.status;
  if (
    status === DataItemStatus.PENDING ||
    status === DataItemStatus.DRAFT ||
    status === DataItemStatus.REJECTED
  )
    return 0;
  if (
    status === DataItemStatus.SUBMITTED ||
    status === DataItemStatus.AI_REVIEWING ||
    status === DataItemStatus.AI_REVIEWED
  )
    return 1;
  if (status === DataItemStatus.PENDING_REVIEW) return 2;
  return 3;
});
const progressItems = computed(() => [
  { title: currentItem.value?.status === DataItemStatus.DRAFT ? '草稿' : '标注' },
  { title: '预审' },
  { title: '审核' },
  { title: '完成' },
]);
const prettyRawData = computed(() => JSON.stringify(currentItem.value?.rawData ?? {}, null, 2));

const liveReviewMeta = computed(() => reviewStatusMeta[liveReviewResult.value.reviewStatus]);
const reviewDescription = computed(() => {
  if (liveReviewResult.value.fieldWarnings.length === 0)
    return '当前表单数据未触发必填、评分范围或文本长度等预审规则。';
  return `发现 ${riskStats.value.error} 个严重问题、${riskStats.value.warning} 个警告、${riskStats.value.info} 个提示。`;
});

const runningTaskOptions = computed(() =>
  taskStore.tasks
    .filter((task) => task.status === TaskStatus.IN_PROGRESS)
    .map((task) => ({ label: task.name, value: task.id })),
);
const claimColumns: TableColumnsType<AvailableItem> = [
  { title: 'ID', dataIndex: 'id', key: 'id', width: 116, ellipsis: true },
  {
    title: '任务',
    dataIndex: 'taskId',
    key: 'taskId',
    width: 132,
    ellipsis: true,
    responsive: ['md'],
  },
  { title: '数据预览', dataIndex: 'rawDataPreview', key: 'rawDataPreview', ellipsis: true },
  { title: '操作', key: 'action', width: 76 },
];

const dataStatusMeta: Record<DataItemStatus, { label: string; color: string }> = {
  [DataItemStatus.PENDING]: { label: '待标注', color: 'default' },
  [DataItemStatus.DRAFT]: { label: '草稿', color: 'processing' },
  [DataItemStatus.SUBMITTED]: { label: '已提交', color: 'success' },
  [DataItemStatus.AI_REVIEWING]: { label: '规则预审中', color: 'processing' },
  [DataItemStatus.AI_REVIEWED]: { label: '规则已预审', color: 'cyan' },
  [DataItemStatus.PENDING_REVIEW]: { label: '待人工审核', color: 'orange' },
  [DataItemStatus.REVIEWED]: { label: '审核通过', color: 'green' },
  [DataItemStatus.REJECTED]: { label: '已驳回', color: 'red' },
};

const reviewStatusMeta: Record<
  ReviewStatus,
  {
    label: string;
    tagColor: string;
    strokeColor: string;
    alertType: 'success' | 'warning' | 'error';
  }
> = {
  [ReviewStatus.PASS]: {
    label: '通过',
    tagColor: 'success',
    strokeColor: SEMANTIC_COLORS.success,
    alertType: 'success',
  },
  [ReviewStatus.RISK]: {
    label: '风险',
    tagColor: 'warning',
    strokeColor: SEMANTIC_COLORS.warning,
    alertType: 'warning',
  },
  [ReviewStatus.FAIL]: {
    label: '不通过',
    tagColor: 'error',
    strokeColor: SEMANTIC_COLORS.danger,
    alertType: 'error',
  },
};

onMounted(() => {
  void taskStore.fetchTasks();
  void refreshWorkbenchData();
  setupSocketLifecycle();
});

onBeforeUnmount(() => {
  const socket = getSocket();
  socket?.off('connect', handleSocketConnect);
  socket?.off('disconnect', handleSocketDisconnect);
  socket?.off('notification', handleSocketNotification);
  joinedTaskIds.forEach((taskId) => leaveTaskRoom(taskId));
  joinedTaskIds.clear();
});

watch(
  () =>
    [
      annotationStore.dataItems.length,
      queryDataItemId.value,
      annotationStore.currentIndex,
    ] as const,
  () => {
    if (annotationStore.dataItems.length === 0) return;
    if (queryDataItemId.value) {
      const targetIndex = annotationStore.dataItems.findIndex(
        (item) => item.id === queryDataItemId.value,
      );
      if (targetIndex >= 0 && targetIndex !== annotationStore.currentIndex) {
        annotationStore.setCurrentIndex(targetIndex);
      }
      return;
    }
    if (annotationStore.currentIndex >= annotationStore.dataItems.length) {
      annotationStore.setCurrentIndex(0);
    }
  },
  { immediate: true },
);

watch(
  () => currentTask.value?.templateId,
  (templateId) => {
    void loadTemplateSchema(templateId);
  },
  { immediate: true },
);

watch(
  () => annotationStore.dataItems.map((item) => item.taskId),
  (taskIds) => {
    Array.from(new Set(taskIds)).forEach((taskId) => {
      if (!joinedTaskIds.has(taskId)) {
        joinTaskRoom(taskId);
        joinedTaskIds.add(taskId);
      }
    });
  },
  { deep: true },
);

watch(
  () => currentItem.value?.id,
  () => {
    resetFormState(currentItem.value?.annotationData ?? {});
  },
  { immediate: true },
);

// ── 本地草稿自动保存：防抖持久化 + 版本校验恢复 ──
// 必须注册在上方「切换条目重置表单」的 watch 之后，保证先重置再尝试恢复草稿
const draft = useDraftPersistence({
  key: () => currentItem.value?.id ?? null,
  version: () => currentItem.value?.version ?? 1,
  snapshot: () => ({ ...formState }),
  restore: (data) => resetFormState(data),
  onRestored: () => message.info('已恢复本地未提交的草稿修改'),
});

async function refreshWorkbenchData() {
  await Promise.all([
    annotationStore.fetchDataItems(queryTaskId.value),
    annotationStore.fetchAIReviews(queryTaskId.value),
  ]);
}

async function loadTemplateSchema(templateId?: string) {
  const requestToken = templateRequestToken.value + 1;
  templateRequestToken.value = requestToken;
  templateSchema.value = null;
  templateError.value = null;

  if (!templateId) {
    templateLoading.value = false;
    return;
  }

  templateLoading.value = true;
  try {
    const schema = await getTemplateSchemaAsync(templateId);
    if (templateRequestToken.value !== requestToken) return;
    templateSchema.value = schema ?? null;
  } catch (error) {
    if (templateRequestToken.value !== requestToken) return;
    const messageText = error instanceof Error ? error.message : '加载标注模板失败';
    templateError.value = `模板 ${templateId} 加载失败：${messageText}`;
  } finally {
    if (templateRequestToken.value === requestToken) {
      templateLoading.value = false;
    }
  }
}

async function retryLoadTemplate() {
  await loadTemplateSchema(currentTask.value?.templateId);
}

async function retryLoadDependencies() {
  await taskStore.fetchTasks();
  await refreshWorkbenchData();
}

function setupSocketLifecycle() {
  const token = authStore.token || localStorage.getItem('token');
  if (token) connectNotificationWS(token);

  const socket = getSocket();
  if (!socket) return;
  socket.on('connect', handleSocketConnect);
  socket.on('disconnect', handleSocketDisconnect);
  socket.on('notification', handleSocketNotification);
}

function handleSocketConnect() {
  joinedTaskIds.forEach((taskId) => joinTaskRoom(taskId));
}

function handleSocketDisconnect() {
  // Connection status is tracked in the notification store by the socket service.
}

function handleSocketNotification(notification: Notification) {
  if (
    notification.type === 'task_assigned' ||
    notification.type === 'task_unassigned' ||
    notification.type === 'task_status_changed' ||
    notification.type === 'task_due_soon' ||
    notification.type === 'ai_review_complete' ||
    notification.type === 'review_rejected' ||
    notification.type === 'review_approved'
  ) {
    void taskStore.fetchTasks();
    void refreshWorkbenchData();
    if (claimModalOpen.value) void fetchAvailableItems();
  }
}

function resetFormState(values: Record<string, unknown>) {
  Object.keys(formState).forEach((key) => {
    delete formState[key];
  });
  Object.entries(values).forEach(([key, value]) => {
    formState[key] = value;
  });
}

function severityColor(severity: Severity) {
  return severity === 'error' ? 'red' : severity === 'warning' ? 'orange' : 'blue';
}

function severityLabel(severity: Severity) {
  return severity === 'error' ? '严重' : severity === 'warning' ? '警告' : '提示';
}

function formatLockTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '未知';
}

function scrollToField(fieldKey: string) {
  document
    .querySelector(`[data-field-key="${fieldKey}"]`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function goPrev() {
  if (canPrev.value) annotationStore.setCurrentIndex(annotationStore.currentIndex - 1);
}

function goNext() {
  if (canNext.value) annotationStore.setCurrentIndex(annotationStore.currentIndex + 1);
}

async function saveDraft() {
  if (!currentItem.value || !authStore.user) return;
  try {
    await annotationStore.saveDraft(
      currentItem.value.id,
      { ...formState },
      authStore.user.username,
    );
    message.success('草稿已保存');
    draft.clear();
  } catch (error) {
    if (!isConflictError(error)) message.error('保存草稿失败');
  }
}

async function submitCurrent() {
  if (!currentItem.value || !authStore.user) return;
  try {
    submitting.value = true;
    if (currentItem.value.status === DataItemStatus.REJECTED) {
      await annotationStore.resubmitItem(
        currentItem.value.id,
        { ...formState },
        authStore.user.username,
      );
      message.success('标注已重新提交，规则预审已完成');
    } else {
      await annotationStore.submitAnnotation(
        currentItem.value.id,
        { ...formState },
        authStore.user.username,
      );
      message.success('标注已提交，规则预审已完成');
    }
    draft.clear();
  } catch (error) {
    if (!isConflictError(error)) {
      Modal.warning({
        title: '提交失败',
        content: error instanceof Error ? error.message : '提交失败，请稍后重试',
      });
    }
  } finally {
    submitting.value = false;
  }
}

function isConflictError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: number }).code === 409
  );
}

function resolveConflict() {
  if (!currentItem.value) return;
  annotationStore.resolveConflictWithServer(currentItem.value.id);
  message.success('已同步为服务端最新数据');
}

function openClaimModal() {
  claimModalOpen.value = true;
  selectedClaimIds.value = [];
  claimTaskId.value = queryTaskId.value ?? currentItem.value?.taskId;
  void fetchAvailableItems();
}

function fetchAvailableItems() {
  return annotationStore.fetchAvailableItems(claimTaskId.value);
}

function onClaimSelectionChange(keys: Array<string | number>) {
  selectedClaimIds.value = keys.map(String);
}

async function claimOneItem(id: string) {
  claimingId.value = id;
  const ok = await annotationStore.claimAssignment(id);
  claimingId.value = null;
  if (!ok) {
    message.error('领取失败');
    return;
  }
  claimModalOpen.value = false;
  focusItem(id);
  message.success('领取成功');
}

async function claimSelectedItems() {
  if (selectedClaimIds.value.length === 0) return;
  batchClaiming.value = true;
  const result = await annotationStore.batchClaimAssignments(selectedClaimIds.value);
  batchClaiming.value = false;
  if (!result) {
    message.error('批量领取失败');
    return;
  }
  const first = result.claimed[0];
  if (first) {
    claimModalOpen.value = false;
    focusItem(first.id);
  }
  message.success(`已领取 ${result.claimedCount} 条标注任务`);
}

function focusItem(id: string) {
  const index = annotationStore.dataItems.findIndex((item) => item.id === id);
  if (index >= 0) annotationStore.setCurrentIndex(index);
}

function taskName(taskId: string) {
  return taskStore.tasks.find((task) => task.id === taskId)?.name || taskId;
}
</script>

<style scoped>
.annotation-workbench {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 92px);
  min-height: 640px;
  overflow: hidden;
}

.page-alert {
  margin-bottom: 12px;
}

.page-loading {
  margin: 100px auto;
}

.workbench-header,
.footer-actions {
  flex-shrink: 0;
  margin-bottom: 10px;
  background: transparent;
}

.header-row,
.footer-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.task-title {
  margin: 0;
}

.task-instructions {
  display: block;
  margin-top: 8px;
}

.progress-steps {
  width: min(520px, 42vw);
  min-width: 360px;
}

.workbench-main {
  display: grid;
  grid-template-columns: minmax(260px, 320px) minmax(440px, 1fr) minmax(280px, 340px);
  gap: 0;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: #fff;
  border: 1px solid var(--lh-border);
  border-radius: 8px;
  animation: lh-workbench-enter var(--lh-motion-slow) var(--lh-ease-emphasized);
  transition:
    border-color var(--lh-motion-base) var(--lh-ease-standard),
    box-shadow var(--lh-motion-base) var(--lh-ease-standard);
}

.workbench-main:hover {
  border-color: var(--lh-border-strong);
  box-shadow: 0 10px 22px rgba(60, 64, 67, 0.06);
}

.panel-card {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  transition: background-color var(--lh-motion-base) var(--lh-ease-standard);
}

.panel-card:hover {
  background: #fbfdff;
}

.raw-panel,
.form-panel {
  border-right: 1px solid var(--lh-divider);
}

.panel-card :deep(.ant-card-body) {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.raw-json {
  margin: 0;
  padding: 10px 12px;
  color: #0f172a;
  background: #f7f9fc;
  border: 1px solid var(--lh-divider);
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.review-alert {
  margin-bottom: 16px;
}

.dynamic-form {
  padding-right: 2px;
}

.field-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.field-help-icon {
  color: #8c8c8c;
  font-size: 12px;
}

.schema-title-block {
  margin-bottom: 20px;
  padding: 12px 14px;
  background: #f7f9fc;
  border: 1px solid var(--lh-divider);
  border-radius: 6px;
  transition:
    background-color var(--lh-motion-base) var(--lh-ease-standard),
    border-color var(--lh-motion-base) var(--lh-ease-standard);
}

.schema-title-block:hover {
  background: #f4f8ff;
  border-color: #d5e2f6;
}

.schema-title {
  margin: 0 0 6px;
}

.schema-copy,
.schema-description {
  margin: 0;
  color: #5f6368;
}

.choice-group--vertical {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.score-box {
  display: grid;
  justify-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.risk-tags {
  margin-bottom: 12px;
}

.warning-list {
  cursor: pointer;
}

.warning-item:hover {
  background: #f5f8ff;
  transform: translateX(2px);
}

.warning-item {
  transition:
    background-color var(--lh-motion-base) var(--lh-ease-standard),
    transform var(--lh-motion-base) var(--lh-ease-standard);
}

@keyframes lh-workbench-enter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.claim-toolbar {
  margin-bottom: 12px;
}

.claim-select {
  width: 240px;
}

@media (max-width: 1280px) {
  .annotation-workbench {
    height: auto;
    min-height: 0;
    overflow: visible;
  }

  .workbench-main {
    grid-template-columns: minmax(260px, 340px) minmax(420px, 1fr);
  }

  .review-panel {
    grid-column: 1 / -1;
    min-height: 360px;
  }
}

@media (max-width: 860px) {
  .header-row,
  .footer-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .progress-steps {
    min-width: 0;
    width: 100%;
  }

  .workbench-main {
    grid-template-columns: 1fr;
  }
}
</style>
