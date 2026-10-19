# Windows 构建与发布

使用 Node.js 22.12 或更新版。依赖固定为 Electron 44.9.0、electron-builder 26.15.3、electron-updater 6.8.9。

1. 在游戏根目录生成离线版，将最终离线 HTML 复制为 `desktop/game/index.html`；若使用资源目录版，连同依赖资源一起复制，使用相对路径。
2. 编辑 `desktop/release-config.json`，填写公开 GitHub 仓库 `owner` 和 `repo`。空 owner 仍可运行游戏，更新状态为 `unconfigured`。仓库配置同时供打包元数据和运行时使用。
3. 在 `desktop/` 执行 `npm install`、`npm test`，然后 `npm run build:win`。首次构建需要网络下载 Electron 与 NSIS 工具。
4. `release/` 输出 `HavenCity-Setup-0.3.0-x64.exe`、`HavenCity-Portable-0.3.0-x64.exe`、安装包 `.blockmap` 和 `latest.yml`（已配置仓库时）。`npm run pack` 仅生成解包目录，`npm start` 本地运行。
5. 在 GitHub 创建公开正式版本 `v0.3.0`，同时上传两个 EXE、安装包 `.blockmap`、`latest.yml`。构建命令固定 `--publish never`，不会上传或创建远程版本。

后续更新同时提高 `desktop/package.json` 与游戏版本，以相同仓库构建并发布更高版本标签及全套制品。安装版用 `latest.yml` 与 SHA-512 检查下载完整性，下载后仍需点击安装并确认；Portable 不承诺自动替换。不要在包内放 GitHub Token；如通过 CI 发布，令牌只存 CI Secret。

生产签名可用 electron-builder 的证书环境变量配置。未签名首版可能显示 Windows SmartScreen 发布者提示；签名身份要在后续版本保持一致。卸载不会主动删除存档。更改应用名称或 `appId` 会影响安装和存档身份。

当前配置采用 v26 及 updater 6：`quitAndInstall(false, true)`、`autoInstallOnAppQuit=false`。将来升级 v27/updater 7 时，按[官方迁移文档](https://www.electron.build/docs/migration/v27-breaking-changes/)调整安装参数、手动安装策略、签名清单和构建选项。

参考：[NSIS 配置](https://www.electron.build/v26/configuration/nsis)、[手动更新](https://www.electron.build/v26/docs/features/auto-update/)、[Electron 安全要求](https://www.electronjs.org/docs/latest/tutorial/security)。
