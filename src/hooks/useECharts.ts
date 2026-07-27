import { useCallback, useRef } from 'react';
import * as echarts from 'echarts/core';

/**
 * ECharts 挂载 hook：负责实例生命周期（init/dispose）与容器尺寸自适应（ResizeObserver）。
 *
 * 不引 echarts-for-react，保持现有按需引入优化——echarts.use(...) 按需注册由调用方自己做。
 * containerRef 是 callback ref：容器随条件渲染出现时 init、销毁时 dispose（等价 Vue
 * watch(chartRef) + onBeforeUnmount 组合）；setOption 前置于 init 时会暂存，挂载后自动应用。
 */
export function useECharts() {
  const chartRef = useRef<echarts.ECharts | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const optionRef = useRef<echarts.EChartsCoreOption | null>(null);

  const containerRef = useCallback((el: HTMLDivElement | null) => {
    if (el) {
      chartRef.current = echarts.init(el);
      if (optionRef.current) chartRef.current.setOption(optionRef.current, true);
      observerRef.current = new ResizeObserver(() => chartRef.current?.resize());
      observerRef.current.observe(el);
      return;
    }
    observerRef.current?.disconnect();
    observerRef.current = null;
    chartRef.current?.dispose();
    chartRef.current = null;
  }, []);

  /** 全量替换配置（notMerge=true），与 Vue 版 setOption(option, true) 一致 */
  const setOption = useCallback((option: echarts.EChartsCoreOption) => {
    optionRef.current = option;
    chartRef.current?.setOption(option, true);
  }, []);

  return { containerRef, setOption };
}
