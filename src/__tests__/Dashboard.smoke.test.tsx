/**
 * Dashboard 页冒烟测试：统计卡片渲染 + 最近任务列表 + 刷新触发数据拉取。
 *
 * mock 边界：store 的 fetch action 用 setState 覆盖为 vi.fn()（Dashboard 挂载即调用），
 * 数据直接预置进 store，不触碰 api 层。
 *
 * 运行: npx vitest run src/__tests__/Dashboard.smoke.test.tsx
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { App as AntdApp } from 'antd';
import Dashboard from '../pages/Dashboard';
import { useTaskStore } from '../store/useTaskStore';
import { useTemplateStore } from '../store/useTemplateStore';
import { TaskStatus, TaskType, type TemplateItem } from '../types';
import { makeTask, resetSessionState, signIn } from './helpers/smoke';

const TEMPLATE: TemplateItem = {
  id: 'tpl001',
  name: '图像分类模板',
  type: TaskType.IMAGE_CLASSIFICATION,
  description: '',
  fields: [],
  createdAt: '2026-07-19T08:00:00.000Z',
  updatedAt: '2026-07-19T08:00:00.000Z',
} as unknown as TemplateItem;

function renderDashboard() {
  return render(
    <MemoryRouter>
      <AntdApp>
        <Dashboard />
      </AntdApp>
    </MemoryRouter>,
  );
}

describe('Dashboard 冒烟', () => {
  const fetchTasks = vi.fn().mockResolvedValue(undefined);
  const fetchTemplates = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    resetSessionState();
    signIn();
    fetchTasks.mockClear();
    fetchTemplates.mockClear();
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 't001', name: '街景图像分类', status: TaskStatus.IN_PROGRESS }),
        makeTask({ id: 't002', name: '合同实体抽取', status: TaskStatus.COMPLETED }),
      ],
      loading: false,
      fetchTasks,
    });
    useTemplateStore.setState({
      templates: [TEMPLATE],
      loading: false,
      fetchTemplates,
    });
  });

  it('渲染统计卡片与最近任务', async () => {
    renderDashboard();

    expect(screen.getByText('任务总数')).toBeTruthy();
    expect(screen.getByText('进行中任务')).toBeTruthy();
    expect(screen.getByText('模板总数')).toBeTruthy();
    expect(screen.getByText('最近任务')).toBeTruthy();
    expect(await screen.findByText('街景图像分类')).toBeTruthy();
    expect(screen.getByText('合同实体抽取')).toBeTruthy();
  });

  it('挂载时拉取任务与模板数据', async () => {
    renderDashboard();

    await waitFor(() => {
      expect(fetchTasks).toHaveBeenCalled();
      expect(fetchTemplates).toHaveBeenCalled();
    });
  });

  it('点击刷新按钮重新拉取', async () => {
    renderDashboard();
    await waitFor(() => expect(fetchTasks).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /刷\s*新/ }));

    await waitFor(() => {
      expect(fetchTasks).toHaveBeenCalledTimes(2);
      expect(fetchTemplates).toHaveBeenCalledTimes(2);
    });
  });
});
