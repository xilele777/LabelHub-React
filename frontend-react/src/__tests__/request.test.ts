import { describe, expect, it } from 'vitest';
import { buildRequestKey } from '@/api/request';

describe('buildRequestKey（在途 GET 去重键）', () => {
  it('无参数时直接返回 url', () => {
    expect(buildRequestKey('/tasks')).toBe('/tasks');
  });

  it('参数键顺序不影响结果', () => {
    const a = buildRequestKey('/tasks', { page: 1, status: 'draft' });
    const b = buildRequestKey('/tasks', { status: 'draft', page: 1 });
    expect(a).toBe(b);
  });

  it('不同参数值生成不同的键', () => {
    const a = buildRequestKey('/tasks', { page: 1 });
    const b = buildRequestKey('/tasks', { page: 2 });
    expect(a).not.toBe(b);
  });

  it('忽略值为 undefined 的参数', () => {
    expect(buildRequestKey('/tasks', { page: undefined })).toBe('/tasks');
    expect(buildRequestKey('/tasks', { page: 1, status: undefined })).toBe(
      buildRequestKey('/tasks', { page: 1 }),
    );
  });

  it('不同 url 生成不同的键', () => {
    expect(buildRequestKey('/tasks', { page: 1 })).not.toBe(buildRequestKey('/users', { page: 1 }));
  });
});
