#!/bin/bash
#
# apply-patches.sh — 将本项目补丁应用到 Sony Digital Paper App 1.4.7 原版解包目录
#
# 用法：
#   ./apply-patches.sh /path/to/extracted-app
#
# <extracted-app> 为从官方 Digital Paper App 1.4.7 的 app.asar 解出的目录
# （即包含 main.js / app / node_modules / package.json 的那一层，可用
#   npx asar extract "/Applications/Digital Paper App.app/Contents/Resources/app.asar" extracted-app
#   获得）
#
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
SRC="${1:?用法: ./apply-patches.sh <官方 app 1.4.7 asar 解包目录>}"
SRC="$(cd "$SRC" && pwd)"

# 1. 校验目标目录
if [ ! -f "$SRC/main.js" ] || [ ! -d "$SRC/app" ] || [ ! -d "$SRC/node_modules" ]; then
    echo "错误: $SRC 不是有效的 app.asar 解包目录（需含 main.js / app / node_modules）" >&2
    exit 1
fi
if grep -q "arm64-port" "$SRC/main.js" 2>/dev/null; then
    echo "错误: 目标目录已应用过补丁（main.js 含 arm64-port 标记）" >&2
    exit 1
fi

echo "[1/5] 应用 8 个补丁…"
for p in "$REPO"/patches/*.patch; do
    echo "  · $(basename "$p")"
    (cd "$SRC" && patch -p1 --forward --silent) < "$p"
done

echo "[2/5] 注入新文件（preload.js / mdns shim）…"
cp "$REPO/files/preload.js" "$SRC/preload.js"
# 用 bonjour-hap 兼容 shim 替换 native mdns addon（dns_sd_bindings.node 仅 x86）
rm -rf "$SRC/node_modules/mw-discovery-ctrl/node_modules/mdns"
mkdir -p "$SRC/node_modules/mw-discovery-ctrl/node_modules/mdns"
cp "$REPO"/files/mdns-shim/* "$SRC/node_modules/mw-discovery-ctrl/node_modules/mdns/"

echo "[3/5] 移除无源码的蓝牙模块（原版即不可用）…"
rm -rf "$SRC/node_modules/bt-pairing-mw" "$SRC/node_modules/bt-pan-mw"

echo "[4/5] 替换 package.json（Electron 44 + arm64 依赖声明）…"
cp "$REPO/package.json" "$SRC/package.json"
cp "$REPO/run.sh" "$SRC/run.sh"
chmod +x "$SRC/run.sh"

echo "[5/5] 完成！后续步骤："
cat << 'EOF'
  cd <extracted-app>
  npm install                # 安装 Electron 44 / @electron/remote / bonjour-hap / sqlite3 等
  # 如 sqlite3 构建失败，需针对 Electron 头文件重编译：
  #   npx node-gyp rebuild -C node_modules/sqlite3 --runtime=electron --target=44.9.0 --dist-url=https://electronjs.org/headers
  ./run.sh                   # 启动（受限沙箱环境已含 --no-sandbox --disable-gpu）
  # 或直接:  ./node_modules/.bin/electron .
  # 打包独立 .app（可选）: 把本仓库 scripts/make-app.sh 拷到解包目录后执行
EOF
