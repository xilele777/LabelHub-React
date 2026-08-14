// 返回延迟更新的值，用于输入筛选等高频场景。
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
 * @param value 原始值
 * @param delay 防抖延迟，默认 300ms
 */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    // 首次也建立计时器，保证后续变化使用同一套时序。
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
