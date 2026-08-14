#!/usr/bin/env bash
#
# LabelHub 冒烟检查（部署设计 §8）
#
# 用法:
#   scripts/smoke.sh                      # 默认 http://127.0.0.1，即经由 Nginx
#   scripts/smoke.sh http://<公网IP>      # 人工体检
#
# 基址默认走 Nginx 而非直连 3001，这样检查覆盖的是用户实际经过的完整链路，
# 能捕获 Nginx 配置错误。任一项失败即以非零码退出，供 CD 触发回滚。

set -uo pipefail

BASE="${1:-http://127.0.0.1}"
FAILED=0

pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() {
  printf '  \033[31m✗\033[0m %s\n' "$1"
  FAILED=1
}

# 取响应头（HEAD 请求）
head_of() { curl -sI --max-time 5 "$1" 2>/dev/null || true; }
status_of() { printf '%s' "$1" | awk 'NR==1{print $2}'; }
cache_of() {
  printf '%s' "$1" | grep -i '^cache-control:' | tr -d '\r' | sed 's/^[Cc]ache-[Cc]ontrol:[[:space:]]*//'
}

echo "冒烟检查: $BASE"

# ── 1. 健康检查（轮询，给进程重启留窗口）──────────────
echo "[1/5] GET /api/health"
code=000
attempt=0
for attempt in $(seq 1 15); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$BASE/api/health" 2>/dev/null || echo 000)
  [ "$code" = "200" ] && break
  sleep 2
done
if [ "$code" = "200" ]; then
  pass "health 200（第 ${attempt} 次尝试）"
else
  fail "health 期望 200，实际 ${code}"
fi

# ── 2. index.html 必须 no-cache ───────────────────────
echo "[2/5] GET /index.html"
hdr=$(head_of "$BASE/index.html")
code=$(status_of "$hdr")
cc=$(cache_of "$hdr")
if [ "$code" = "200" ]; then pass "index.html 200"; else fail "index.html 期望 200，实际 ${code:-000}"; fi
case "$cc" in
  *no-cache*) pass "Cache-Control: $cc" ;;
  *) fail "index.html 期望含 no-cache，实际: ${cc:-<无>}" ;;
esac

# ── 3. 入口 JS 必须 immutable（文件名带 hash，必须动态解析）──
echo "[3/5] 入口 JS 强缓存"
asset=$(curl -s --max-time 5 "$BASE/index.html" 2>/dev/null |
  grep -o '/assets/[A-Za-z0-9._-]*\.js' | head -1)
if [ -z "$asset" ]; then
  fail "未能从 index.html 解析出 /assets/*.js"
else
  hdr=$(head_of "$BASE$asset")
  code=$(status_of "$hdr")
  cc=$(cache_of "$hdr")
  if [ "$code" = "200" ]; then pass "$asset 200"; else fail "$asset 期望 200，实际 ${code:-000}"; fi
  case "$cc" in
    *immutable*) pass "Cache-Control: $cc" ;;
    *) fail "入口 JS 期望含 immutable，实际: ${cc:-<无>}" ;;
  esac
fi

# ── 4. SPA 直达路由回退 ───────────────────────────────
echo "[4/5] GET /tasks（SPA 直达）"
out=$(curl -s -o /dev/null -w '%{http_code} %{content_type}' --max-time 5 "$BASE/tasks" 2>/dev/null || echo "000 -")
code=${out%% *}
ctype=${out#* }
if [ "$code" = "200" ]; then pass "/tasks 200"; else fail "/tasks 期望 200，实际 ${code}"; fi
case "$ctype" in
  text/html*) pass "Content-Type: $ctype" ;;
  *) fail "/tasks 期望 text/html，实际: ${ctype}" ;;
esac

# ── 5. WebSocket 握手（polling 阶段）──────────────────
echo "[5/5] GET /socket.io/ 握手"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 \
  "$BASE/socket.io/?EIO=4&transport=polling" 2>/dev/null || echo 000)
if [ "$code" = "200" ]; then pass "socket.io 握手 200"; else fail "socket.io 期望 200，实际 ${code}"; fi

echo
if [ "$FAILED" = 0 ]; then
  echo "冒烟检查全部通过"
else
  echo "冒烟检查存在失败项"
fi
exit "$FAILED"
