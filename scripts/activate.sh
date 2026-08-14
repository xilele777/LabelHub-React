#!/usr/bin/env bash
#
# 激活一个 release（部署设计 §6.3 / §6.5）
#
# 用法: activate.sh <release-name>
#
# 该脚本常驻 /srv/labelhub/shared/，不随 release 走——因为回滚时需要在
# current 被切走的情况下依然可用。由 CD 在上传完 release 后调用。

set -uo pipefail

ROOT=/srv/labelhub
REL="${1:?用法: activate.sh <release-name>}"
DIR="$ROOT/releases/$REL"
KEEP=5

log() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }

[ -d "$DIR" ] || {
  echo "release 不存在: $DIR"
  exit 1
}

# 记录当前 release，供健康检查失败时回滚
PREV=""
if [ -L "$ROOT/current" ]; then
  PREV=$(basename "$(readlink -f "$ROOT/current")")
fi
echo "当前 release: ${PREV:-<无>} → 目标: $REL"

log "建立共享软链（数据与密钥不随 release 走）"
ln -sfn "$ROOT/shared/data" "$DIR/server/data"
ln -sfn "$ROOT/shared/.env" "$DIR/.env"

log "准备生产依赖"
if [ -d "$DIR/server/node_modules" ]; then
  echo "  node_modules 已存在，跳过"
elif [ -n "$PREV" ] &&
  [ -d "$ROOT/releases/$PREV/server/node_modules" ] &&
  cmp -s "$DIR/server/package-lock.json" "$ROOT/releases/$PREV/server/package-lock.json"; then
  # lock 未变则从上一个 release 硬链接复制：秒级完成且几乎不占额外磁盘。
  # 硬链接安全——删除旧 release 只减引用计数，文件本身仍被新 release 持有。
  echo "  package-lock.json 与 $PREV 一致，硬链接复用其 node_modules"
  cp -al "$ROOT/releases/$PREV/server/node_modules" "$DIR/server/node_modules" 2>/dev/null ||
    cp -a "$ROOT/releases/$PREV/server/node_modules" "$DIR/server/node_modules"
else
  echo "  依赖有变更，执行 npm ci"
  (cd "$DIR/server" && npm ci --omit=dev --no-audit --no-fund) || {
    echo "依赖安装失败，未做任何切换"
    exit 1
  }
fi

# 切换 current 并重建进程。
# 用 delete+start 而非 reload：pm2 会把 script 路径解析为真实路径并缓存，
# 符号链接切换后 reload 仍会运行旧 release 的代码（代价是 2-3 秒不可用）。
switch_to() {
  local rel="$1"
  ln -sfn "$ROOT/releases/$rel" "$ROOT/current.tmp"
  mv -T "$ROOT/current.tmp" "$ROOT/current"
  pm2 delete labelhub >/dev/null 2>&1 || true
  (cd "$ROOT/current" && pm2 start ecosystem.config.cjs >/dev/null 2>&1) || return 1
  pm2 save >/dev/null 2>&1 || true
}

log "原子切换到 $REL"
switch_to "$REL" || echo "进程启动异常，交由健康检查判定"

log "健康检查（经 Nginx，覆盖用户实际链路）"
if bash "$ROOT/current/scripts/smoke.sh" http://127.0.0.1; then
  log "清理旧 release（保留最近 $KEEP 个）"
  # shellcheck disable=SC2012
  ls -1dt "$ROOT"/releases/*/ 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
    echo "  删除 $(basename "$old")"
    rm -rf "$old"
  done
  echo
  echo "部署成功: $REL"
  exit 0
fi

# ── 回滚 ────────────────────────────────────────────────────
echo
echo "健康检查失败，回滚到 ${PREV:-<无>}"
if [ -n "$PREV" ] && [ -d "$ROOT/releases/$PREV" ]; then
  switch_to "$PREV"
  if bash "$ROOT/current/scripts/smoke.sh" http://127.0.0.1; then
    echo "回滚成功，线上已恢复到 $PREV"
  else
    echo "回滚后仍不健康，需人工介入"
  fi
else
  echo "没有可回滚的 release"
fi

# 无论回滚是否成功都以非零码退出：CD 显示绿色必须等价于线上真实可用
exit 1
