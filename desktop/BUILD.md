# Windows 免安装版构建与发布

使用 Node.js 22.12 或更新版。依赖固定为 Electron 44.9.0、electron-builder 26.15.3、electron-updater 6.8.9（保留旧安装版桥兼容）。

1. 在游戏根目录运行 `pnpm --config.verify-deps-before-run=false run build`，生成离线 HTML。
2. 首次准备桌面依赖：`pnpm --dir desktop install --ignore-scripts`，然后 `node desktop/node_modules/electron/install.js`。
3. 同步根 `package.json`、`desktop/package.json`、`src/release-config.json` 的版本；两处 `release-config.json` 保持相同公开仓库 owner/repo。
4. 运行 `node scripts/build-windows.mjs`，自动复制最新离线版并输出单文件 `desktop/release/HavenCity-Portable-0.4.0-x64.exe`。
5. 修改 `RELEASE_NOTES.md`，提交源码并推送对应版本标签。运行 `node scripts/github-release.mjs --publish-release`，只上传当前版本的免安装 EXE，上传完成后才公开该次发行。

用户只需下载 EXE 并双击。运行不需要安装器、外网、Node.js 或开发服务器。首次启动会在临时目录展开内置运行时，完整游戏内容均已打包在 EXE 中。

免安装版仅在点击“检查更新”时请求固定仓库的 GitHub API，验证稳定版本及其精确匹配的 Portable EXE；API 限流时改用公开发行页与 EXE 地址的 HEAD 请求核实版本和文件，不下载文件。发现新版后打开固定发行页，用户下载新版、关闭游戏后替换旧 EXE；不会自动安装，不依赖 `latest.yml` 或安装包。保留相同 appId、应用名称与游戏源，存档继续使用原来的用户数据位置。旧版玩家也可从菜单导出 JSON，再导入到新版。

打包命令固定 `--publish never`，仅显式运行发布脚本才上传。GitHub 凭证只由发布工具在内存中从系统 Git 凭证助手读取，游戏中不包含令牌。EXE 当前未作商业代码签名。
