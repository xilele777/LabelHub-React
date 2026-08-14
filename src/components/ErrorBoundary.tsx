// 全局错误边界，捕获渲染异常并提供恢复入口。
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Result, Space } from 'antd';
import { useNavigate } from 'react-router';
import { logger } from '../utils/logger';
import './ErrorBoundary.css';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** 「返回首页」的跳转实现，由外层函数组件注入（class 组件无法使用 useNavigate） */
  onGoHome: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** 捕获子树渲染错误并提供恢复入口。 */
class ErrorBoundaryImpl extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error('[ErrorBoundary]', error, 'Info:', info.componentStack);

    // 生产环境上报错误
    if (import.meta.env.PROD) {
      try {
        const payload = JSON.stringify({
          message: error.message,
          stack: error.stack,
          info: info.componentStack,
          component: 'ErrorBoundary',
          url: window.location.href,
          timestamp: new Date().toISOString(),
        });
        navigator.sendBeacon('/api/error-report', payload);
      } catch {
        // 上报本身不应引发新错误
      }
    }
  }

  retry = () => {
    this.setState({ error: null });
  };

  goHome = () => {
    this.setState({ error: null });
    this.props.onGoHome();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="error-boundary">
        <Result
          status="error"
          title="模块加载异常"
          subTitle={error.message || '未知错误'}
          extra={
            <Space>
              <Button type="primary" onClick={this.retry}>
                重试
              </Button>
              <Button onClick={this.goHome}>返回首页</Button>
            </Space>
          }
        />
      </div>
    );
  }
}

export default function ErrorBoundary({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <ErrorBoundaryImpl onGoHome={() => void navigate('/dashboard', { replace: true })}>
      {children}
    </ErrorBoundaryImpl>
  );
}
