import { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '../utils/logger';

/**
 * 本标签页唯一标识。
 * Channel 已按 userId 隔离，频道内全部是同一账号的消息，
 * 「自己 / 其他标签页」必须按标签页身份区分（同账号多标签页正是要拦截的场景），
 * 不能按 userId 区分。不用 crypto.randomUUID()：http 直连 IP 的生产部署
 * 属非 secure context，该 API 不可用。
 */
const TAB_ID = `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

export interface LockMessage {
  type: 'lock' | 'release';
  itemId: string;
  tabId: string;
  userId: string;
  timestamp: number;
}

export interface UseCrossTabLockReturn {
  /** 是否有其他标签页正持有编辑锁 */
  lockedByOtherTab: boolean;
  /** 被其他标签页锁定的条目 ID（条目粒度，避免误伤其他条目的编辑） */
  lockedItemId: string | null;
  /** 广播加锁消息到其他标签页 */
  broadcastLock: (itemId: string, userId: string) => void;
  /** 广播释放消息到其他标签页 */
  broadcastRelease: (itemId: string) => void;
}

/**
 * BroadcastChannel 跨标签页编辑锁检测。
 *
 * 服务端悲观锁以用户为粒度（lockedBy = username），同一账号在同一浏览器
 * 开多个标签页编辑同一条数据时，每个标签页 claim 都会成功，实际在互相覆盖。
 * 通过 BroadcastChannel 广播锁状态补上「标签页粒度」的互斥：
 * 标签页 B 收到标签页 A 的锁消息后，对该条目禁用编辑并提示。
 *
 * Channel 名称按 userId 隔离（不同用户间的冲突由服务端悲观锁负责）；
 * 消息按 TAB_ID 区分本标签页与其他标签页。
 * 标签页崩溃（不触发 beforeunload）会残留本地锁状态，刷新后消失；
 * 数据正确性始终由服务端 30 分钟锁超时 + 提交版本校验兜底，本层只是 UX 前置拦截。
 */
export function useCrossTabLock(userId: string): UseCrossTabLockReturn {
  const [lockedByOtherTab, setLockedByOtherTab] = useState(false);
  const [lockedItemId, setLockedItemId] = useState<string | null>(null);
  // 事件回调里读取当前锁定条目用镜像 ref，避免闭包捕获过期值
  const lockedItemIdRef = useRef<string | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const heldRef = useRef<{ itemId: string; userId: string } | null>(null);
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  const getChannel = useCallback((): BroadcastChannel | null => {
    if (typeof BroadcastChannel === 'undefined') return null;
    if (!channelRef.current && userIdRef.current) {
      // Channel 名称按用户隔离，避免跨用户干扰
      const channel = new BroadcastChannel(`labelhub-lock-${userIdRef.current}`);
      channel.addEventListener('message', (event: MessageEvent<LockMessage>) => {
        const msg = event.data;
        if (!msg || msg.tabId === TAB_ID) return; // 只忽略本标签页自己的消息

        if (msg.type === 'lock') {
          logger.log('[CrossTab] 其他标签页加锁:', msg.itemId);
          lockedItemIdRef.current = msg.itemId;
          setLockedByOtherTab(true);
          setLockedItemId(msg.itemId);
        } else if (msg.type === 'release') {
          // 仅当释放的是当前记录的条目才清除，防止乱序消息误清
          if (lockedItemIdRef.current === msg.itemId) {
            logger.log('[CrossTab] 其他标签页释放锁:', msg.itemId);
            lockedItemIdRef.current = null;
            setLockedByOtherTab(false);
            setLockedItemId(null);
          }
        }
      });
      channelRef.current = channel;
    }
    return channelRef.current;
  }, []);

  const post = useCallback(
    (type: LockMessage['type'], itemId: string, uid: string) => {
      const ch = getChannel();
      if (ch) {
        ch.postMessage({
          type,
          itemId,
          tabId: TAB_ID,
          userId: uid,
          timestamp: Date.now(),
        } satisfies LockMessage);
      }
    },
    [getChannel],
  );

  const broadcastLock = useCallback(
    (itemId: string, uid: string) => {
      heldRef.current = { itemId, userId: uid };
      post('lock', itemId, uid);
    },
    [post],
  );

  const broadcastRelease = useCallback(
    (itemId: string) => {
      heldRef.current = null;
      post('release', itemId, userIdRef.current);
    },
    [post],
  );

  useEffect(() => {
    getChannel();

    // 页面关闭/刷新时广播释放当前持有的锁
    const onBeforeUnload = () => {
      const held = heldRef.current;
      if (held) {
        post('release', held.itemId, held.userId);
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      const held = heldRef.current;
      if (held) {
        heldRef.current = null;
        post('release', held.itemId, held.userId);
      }
      channelRef.current?.close();
      channelRef.current = null;
    };
    // userId 变化时重建 channel（getChannel/post 引用稳定，实际依赖 userId）
  }, [userId, getChannel, post]);

  return {
    lockedByOtherTab,
    lockedItemId,
    broadcastLock,
    broadcastRelease,
  };
}
