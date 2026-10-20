#!/bin/zsh
# Digital Paper App (arm64 port) 启动脚本
#
# 说明:
# - ELECTRON_RUN_AS_NODE 必须清除, 否则 Electron 以纯 Node 模式启动, require('electron') 返回空对象
# - --no-sandbox 仅在 WorkBuddy 嵌套沙箱内运行时需要; 从 Terminal 直接启动可去掉
#   (WorkBuddy 的 seatbelt 沙箱会阻止 Chromium 自身 sandbox 初始化)
# - --disable-gpu 在嵌套沙箱下规避 GPU 子进程崩溃; 真机 Terminal 启动可去掉

cd "$(dirname "$0")"
unset ELECTRON_RUN_AS_NODE
exec ./node_modules/.bin/electron . --no-sandbox --disable-gpu "$@"
