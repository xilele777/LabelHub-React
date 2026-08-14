/**
 * TaskList 页冒烟测试：列表渲染 + 筛选联动（关键字变化回第一页并重新请求）。
 *
 * mock 边界：页面直调的 api/task.getTaskList；筛选缓存（useListCacheStore）真实运行，
 * 用于验证「详情页返回恢复页码」与「筛选变化重置页码」两条路径。
 *
 * 运行: npx vitest run src/__tests__/TaskList.smoke.test.tsx
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { App as AntdApp } from 'antd';
import TaskList from '../pages/TaskList';
import { getTaskList } from '../api/task';
import { useListCacheStore } from '../store/useListCacheStore';
import { makeTask, resetSessionState, signIn } from './helpers/smoke';

vi.mock('../api/task', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/task')>()),
  getTaskList: vi.fn(),
}));

const mockedGetTaskList = vi.mocked(getTaskList);

function renderTaskList() {
  return render(
    <MemoryRouter>
      <AntdApp>
        <TaskList />
      </AntdApp>
    </MemoryRouter>,
  );
}

describe('TaskList 冒烟', () => {
  beforeEach(() => {
    resetSessionState();
    signIn();
    mockedGetTaskList.mockReset();
    mockedGetTaskList.mockResolvedValue({
      code: 200,
      message: 'ok',
      data: {
        items: [
          makeTask({ id: 't001', name: '街景图像分类' }),
          makeTask({ id: 't002', name: '合同实体抽取' }),
        ],
        total: 12,
      },
    });
  });

  it('渲染任务表格与搜索区', async () => {
    renderTaskList();

    expect(await screen.findByText('街景图像分类')).toBeTruthy();
    expect(screen.getByText('合同实体抽取')).toBeTruthy();
    expect(screen.getByPlaceholderText('搜索任务名称')).toBeTruthy();
    expect(mockedGetTaskList).toHaveBeenCalledWith(
      expect.objectContaining({ _page: 1, _limit: 5 }),
    );
  });

  it('挂载时从会话缓存恢复页码', async () => {
    useListCacheStore.getState().setTaskListCache({ keyword: '', status: null, page: 2 });
    renderTaskList();

    await waitFor(() => {
      expect(mockedGetTaskList).toHaveBeenCalledWith(expect.objectContaining({ _page: 2 }));
    });
  });

  it('输入关键字后回到第一页并携带关键字重新请求', async () => {
    useListCacheStore.getState().setTaskListCache({ keyword: '', status: null, page: 2 });
    renderTaskList();
    await waitFor(() => expect(mockedGetTaskList).toHaveBeenCalled());

    fireEvent.change(screen.getByPlaceholderText('搜索任务名称'), {
      target: { value: '街景' },
    });

    // useDebounced 默认 300ms，waitFor 轮询覆盖
    await waitFor(() => {
      expect(mockedGetTaskList).toHaveBeenLastCalledWith(
        expect.objectContaining({ _page: 1, keyword: '街景' }),
      );
    });
  });
});
