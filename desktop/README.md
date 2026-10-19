# 栖湾市 Windows 桌面版

独立 Electron 外壳，读取 `game/index.html` 离线游戏。当前只发布单文件 Portable EXE，下载后双击即可玩。更新按钮独立检查 GitHub 正式发行及相应的免安装 EXE，发现新版后打开发行页，下载后关闭游戏并手动替换 EXE；不依赖安装包或 `latest.yml`。存档保存在当前 Windows 用户的应用数据中。

`window.havenDesktop` 提供 `version`、`getUpdateState()`、`checkForUpdates()`、`downloadUpdate()`、`installUpdate()`、`onUpdateState(callback)`。最后一个方法返回取消监听函数。状态为 `idle | checking | available | current | downloading | downloaded | error | unconfigured`，可带 `version`、`progress`（0–100）、`message`、`releaseUrl`。

主进程只接受本地游戏主窗口的固定 IPC。游戏通过安全的 `haven://game/index.html` 源读取本地文件，保持 `contextIsolation=true`、`nodeIntegration=false`、`sandbox=true`。没有启动检查、定时更新、自动下载或退出时自动安装。

安装按钮触发原生确认框，确认后派发可取消的 `haven:before-update-install` 事件，供游戏同步保存。游戏保存失败时必须调用 `event.preventDefault()`，主进程收到失败结果会中止安装；保存成功才运行 NSIS 更新。F11 切换全屏。

构建和发布步骤见 [BUILD.md](BUILD.md)。
