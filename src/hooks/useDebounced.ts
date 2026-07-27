import { useEffect, useState } from 'react';

/**
 * 返回 value 的防抖镜像值。
 *
 * 输入框继续绑定原始 state 保证即时回显，过滤 / 请求侧改为依赖防抖后的镜像值，
 * 避免每次按键都触发全量重算。
 *
 * 注意：value 以 Object.is 比较（useEffect 依赖），应传原始类型或稳定引用；
 * 每次渲染新建的对象/数组会导致防抖计时器不断重置。
 *
 * @param value 原始值（Vue 版的 ref/getter 在 React 中即每次渲染传入的最新值）
 * @param delay 防抖延迟，默认 300ms
 */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    // 首渲染也会调度一次「设为同值」的定时器，结果与 Vue 版 watch（非 immediate）一致
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
