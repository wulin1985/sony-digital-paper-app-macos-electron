#!/bin/bash
#
# make-app.sh — [arm64-port] 手动组装独立 .app（替代 electron-builder，避免联网下载）
#
# 原理：node_modules/electron/dist/Electron.app 即完整 Electron 44 运行时；
#       复制骨架 → 改名主程序 → 改写 Info.plist（对齐 Sony 原版元数据）→
#       注入 Resources/app（项目代码 + node_modules，排除 electron dev 包 310M）→
#       ad-hoc 签名。
#
# 产物：dist-app/Digital Paper App.app
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist-app"
APP="$DIST/Digital Paper App.app"
SRC_ELECTRON="$ROOT/node_modules/electron/dist/Electron.app"
EXEC_NAME="DigitalPaperApp"
ICON_SRC="/Applications/Digital Paper App.app/Contents/Resources/electron.icns"

echo "[1/6] 清理并复制 Electron 运行时骨架…"
rm -rf "$DIST"
mkdir -p "$DIST"
# 注意：electron dist 自带 com.apple.provenance xattr，cp -R 会报 Operation not permitted，必须用 ditto
ditto "$SRC_ELECTRON" "$APP"

echo "[2/6] 重命名主程序 Electron → ${EXEC_NAME}…"
mv "$APP/Contents/MacOS/Electron" "$APP/Contents/MacOS/$EXEC_NAME"

echo "[3/6] 改写 Info.plist（对齐 Sony 原版 + arm64 版本号 + 本地网络权限）…"
PLIST="$APP/Contents/Info.plist"
PB=/usr/libexec/PlistBuddy
"$PB" -c 'Set :CFBundleName Digital Paper App' "$PLIST"
"$PB" -c 'Set :CFBundleDisplayName Digital Paper App' "$PLIST"
"$PB" -c "Set :CFBundleExecutable $EXEC_NAME" "$PLIST"
# bundle id 加 .arm64 后缀，与已安装的 Sony 原版（com.sony.digitalpaperapp）区分
"$PB" -c 'Set :CFBundleIdentifier com.sony.digitalpaperapp.arm64' "$PLIST"
"$PB" -c 'Set :CFBundleShortVersionString 1.4.7.1202-arm64.1' "$PLIST"
"$PB" -c 'Set :CFBundleVersion 1.4.7.1202-arm64.1' "$PLIST"
"$PB" -c 'Set :LSMinimumSystemVersion 11.0.0' "$PLIST"
# macOS 14+ 本地网络权限（mDNS 发现 digitalpaper.local 需要）
if ! "$PB" -c 'Print :NSLocalNetworkUsageDescription' "$PLIST" >/dev/null 2>&1; then
  "$PB" -c 'Add :NSLocalNetworkUsageDescription string 用于发现和连接 Digital Paper 电纸书设备（digitalpaper.local）' "$PLIST"
fi
if ! "$PB" -c 'Print :NSBonjourServices' "$PLIST" >/dev/null 2>&1; then
  "$PB" -c 'Add :NSBonjourServices array' "$PLIST"
  "$PB" -c 'Add :NSBonjourServices:0 string _digitalpaper._tcp' "$PLIST"
fi

echo "[4/6] 注入应用代码 Resources/app（排除 electron dev 包 / .bin / 构建脚本）…"
APPDIR="$APP/Contents/Resources/app"
mkdir -p "$APPDIR/node_modules"
rsync -a \
  --exclude 'node_modules' \
  --exclude 'dist-app' \
  --exclude 'scripts' \
  --exclude '.git' \
  --exclude '.DS_Store' \
  --exclude '.gitkeep' \
  --exclude 'run.sh' \
  "$ROOT/" "$APPDIR/"
rsync -a \
  --exclude 'electron' \
  --exclude '.bin' \
  --exclude '.DS_Store' \
  "$ROOT/node_modules/" "$APPDIR/node_modules/"

echo "[5/6] 图标（沿用 Sony 原版 electron.icns）…"
if [ -f "$ICON_SRC" ]; then
  cp "$ICON_SRC" "$APP/Contents/Resources/electron.icns"
fi

echo "[6/6] ad-hoc 代码签名…"
codesign --force --deep --sign - "$APP" 2>&1 | grep -v "^$" || true

# 校验
codesign --verify "$APP" && echo "签名校验通过"

echo ""
echo "完成：$APP"
du -sh "$APP"
