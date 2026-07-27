// 独立于 request.ts / useAuthStore.ts —— 两者都依赖此常量。
// 抽出为无依赖模块，消除 request ⇄ store 循环加载时的 TDZ 风险
// （Vue 版依赖入口恰好先加载 store 才成立，React 版入口顺序相反）。
export const AUTH_EXPIRED_EVENT = 'labelhub:auth-expired';
