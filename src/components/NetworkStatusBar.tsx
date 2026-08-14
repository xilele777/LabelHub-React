// 网络状态提示条，展示连接中、在线和离线状态。
import { DisconnectOutlined, LoadingOutlined, WifiOutlined } from '@ant-design/icons';
import { useNetworkStatus, type NetworkState } from '../hooks/useNetworkStatus';
import './NetworkStatusBar.css';

const MESSAGE_MAP: Record<NetworkState, string> = {
  online: '网络已恢复，数据已同步',
  reconnecting: '网络连接中断，正在重连…',
  offline: '网络已断开，请检查网络连接',
};

export default function NetworkStatusBar() {
  const { state, justRecovered } = useNetworkStatus();

  const visible = state !== 'online' || justRecovered;
  if (!visible) return null;

  return (
    <div className={`network-bar network-bar--${state}`}>
      <span className="network-bar__icon">
        {state === 'online' ? (
          <WifiOutlined />
        ) : state === 'reconnecting' ? (
          <LoadingOutlined spin />
        ) : (
          <DisconnectOutlined />
        )}
      </span>
      <span className="network-bar__text">{MESSAGE_MAP[state]}</span>
    </div>
  );
}
