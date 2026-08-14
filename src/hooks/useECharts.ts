// 管理 ECharts 实例的创建、更新、尺寸调整和销毁。
import { useCallback, useRef } from 'react';
import * as echarts from 'echarts/core';

/**
 * ECharts 挂载 hook：负责实例生命周期（init/dispose）与容器尺寸自适应（ResizeObserver）。
 *
 * 按需注册图表组件由调用方完成。containerRef 负责实例的创建、销毁和尺寸监听；
 * 容器尚未挂载时传入的配置会在初始化后自动应用。
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

  /** 用新配置完整替换当前图表。 */
  const setOption = useCallback((option: echarts.EChartsCoreOption) => {
    optionRef.current = option;
    chartRef.current?.setOption(option, true);
  }, []);

  return { containerRef, setOption };
}
