import { useEffect, useRef, useState } from 'react';
import { getSocket } from '../services/notificationWebSocket';
import { logger } from '../utils/logger';

export type NetworkState = 'online' | 'offline' | 'reconnecting';

export interface UseNetworkStatusReturn {
  state: NetworkState;
  /** 从断线到恢复的瞬间为 true，3 秒后自动复位 */
  justRecovered: boolean;
  wasOffline: boolean;
}

/**
 * 全局网络状态检测 — 三路信号汇总：
 * 1. Navigator.onLine + online/offline 事件（浏览器级）
 * 2. Socket.IO connect/disconnect（WebSocket 级）
 * 3. 页面可见性变化时主动探测（切回后台期间断网的场景）
 *
 * 统一收敛为三个状态：online | reconnecting | offline
 */
export function useNetworkStatus(): UseNetworkStatusReturn {
  const [state, setState] = useState<NetworkState>(() => (navigator.onLine ? 'online' : 'offline'));
  const [justRecovered, setJustRecovered] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);
  // 事件回调里读取当前状态用镜像 ref，避免闭包捕获过期值
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let recoverTimer: ReturnType<typeof setTimeout> | undefined;

    function setOnline() {
      if (stateRef.current === 'offline' || stateRef.current === 'reconnecting') {
        setWasOffline(true);
        setJustRecovered(true);
        clearTimeout(recoverTimer);
        recoverTimer = setTimeout(() => {
          setJustRecovered(false);
        }, 3000);
      }
      stateRef.current = 'online';
      setState('online');
      logger.log('[Network] 网络已恢复');
    }

    function setOffline() {
      stateRef.current = 'offline';
      setState('offline');
      logger.warn('[Network] 网络已断开');
    }

    function setReconnecting() {
      if (stateRef.current === 'online') return; // 在线时不触发重连状态
      stateRef.current = 'reconnecting';
      setState('reconnecting');
    }

    // ── 1. Navigator 级检测 ──
    const onBrowserOnline = () => setOnline();
    const onBrowserOffline = () => setOffline();
    window.addEventListener('online', onBrowserOnline);
    window.addEventListener('offline', onBrowserOffline);

    // ── 2. Socket.IO 级检测（延迟绑定，确保 Socket 已初始化） ──
    let socketCheckTimer: ReturnType<typeof setInterval> | undefined;
    let boundSocket: ReturnType<typeof getSocket> = null;
    const onSocketDisconnect = () => setReconnecting();
    const onSocketConnect = () => setOnline();

    function bindSocket(socket: ReturnType<typeof getSocket>) {
      if (!socket) return;
      boundSocket = socket;
      socket.on('disconnect', onSocketDisconnect);
      socket.on('connect', onSocketConnect);
    }

    const attachTimer = setTimeout(() => {
      const socket = getSocket();
      if (socket) {
        bindSocket(socket);
        return;
      }
      // Socket 尚未初始化，轮询等待
      socketCheckTimer = setInterval(() => {
        const s = getSocket();
        if (s) {
          clearInterval(socketCheckTimer);
          bindSocket(s);
        }
      }, 500);
    }, 1000);

    // ── 3. 页面可见性变化时探测（切回后台断网的场景） ──
    function onVisibilityChange() {
      if (document.visibilityState !== 'visible') return;
      if (navigator.onLine) {
        setOnline();
      } else {
        setOffline();
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('online', onBrowserOnline);
      window.removeEventListener('offline', onBrowserOffline);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearTimeout(recoverTimer);
      clearTimeout(attachTimer);
      clearInterval(socketCheckTimer);
      // socket 是全局单例，卸载时必须摘掉本 hook 的监听（Vue 版随组件销毁整体断连，React 版需显式 off）
      boundSocket?.off('disconnect', onSocketDisconnect);
      boundSocket?.off('connect', onSocketConnect);
    };
  }, []);

  return { state, justRecovered, wasOffline };
}
