'use strict';

/** The only updater entry points are explicit renderer requests. No timers check or install updates. */
function createUpdateController(options) {
  const { release, isPackaged, isPortable, createUpdater, checkPortableRelease, publish, openRelease, prepareInstall, confirmInstall } = options;
  let state = !release.configured
    ? { status: 'unconfigured', message: '尚未配置 GitHub 更新仓库。' }
    : !isPackaged
      ? { status: 'unconfigured', message: '开发模式不检查更新，请使用打包后的 EXE。', releaseUrl: release.releaseUrl }
      : { status: 'idle', ...(isPortable ? { message: '免安装版可检查版本，下载后需手动替换 EXE。' } : {}), releaseUrl: release.releaseUrl };
  let updater;
  let checkPromise;
  let downloadPromise;
  let availableVersion;
  let installPending = false;

  const snapshot = () => ({ ...state });
  function setState(next) {
    state = { ...(release.releaseUrl ? { releaseUrl: release.releaseUrl } : {}), ...next };
    publish(snapshot());
    return snapshot();
  }
  function failure(error) {
    installPending = false;
    const detail = error instanceof Error ? error.message : String(error);
    return setState({ status: 'error', ...(availableVersion ? { version: availableVersion } : {}), message: `更新失败：${detail.slice(0, 240)}` });
  }
  function getUpdater() {
    if (updater) return updater;
    updater = createUpdater({ provider: 'github', owner: release.owner, repo: release.repo, private: false });
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.on('checking-for-update', () => setState({ status: 'checking', message: '正在检查 GitHub 最新版本…' }));
    updater.on('update-available', info => {
      availableVersion = info.version;
      setState({ status: 'available', version: info.version, message: isPortable ? '发现新版本，请从发行页下载免安装 EXE，关闭游戏后替换。' : '发现新版本，可选择下载。' });
    });
    updater.on('update-not-available', info => {
      availableVersion = undefined;
      setState({ status: 'current', version: info.version, message: '当前已是最新版本。' });
    });
    updater.on('download-progress', progress => setState({ status: 'downloading', version: availableVersion, progress: Math.max(0, Math.min(100, Number(progress.percent) || 0)), message: '正在下载更新，游戏可以继续运行。' }));
    updater.on('update-downloaded', info => setState({ status: 'downloaded', version: info.version, progress: 100, message: '更新已下载，确认后保存游戏并重启安装。' }));
    updater.on('error', failure);
    return updater;
  }

  return {
    getState: snapshot,
    async checkForUpdates() {
      if (state.status === 'unconfigured' || state.status === 'downloading' || state.status === 'downloaded') return snapshot();
      if (checkPromise) return checkPromise;
      setState({ status: 'checking', message: '正在检查 GitHub 最新版本…' });
      if (isPortable) {
        availableVersion = undefined;
        // Portable releases do not use NSIS metadata or latest.yml, which may still describe an older installer.
        checkPromise = Promise.resolve().then(() => {
          if (typeof checkPortableRelease !== 'function') throw new Error('免安装版检查服务不可用，请前往 GitHub 发行页。');
          return checkPortableRelease();
        }).then(info => {
          if (!info || typeof info.available !== 'boolean' || typeof info.version !== 'string' || info.version.length > 160
            || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(info.version)) throw new Error('免安装版发布信息无效。');
          availableVersion = info.available ? info.version : undefined;
          return setState({ status: info.available ? 'available' : 'current', version: info.version,
            message: info.available ? '发现新版本，请从发行页下载免安装 EXE，关闭游戏后替换。' : '当前已是最新版本。' });
        }).catch(failure).finally(() => { checkPromise = undefined; });
        return checkPromise;
      }
      checkPromise = Promise.resolve().then(() => getUpdater().checkForUpdates()).then(snapshot).catch(failure).finally(() => { checkPromise = undefined; });
      return checkPromise;
    },
    async downloadUpdate() {
      if (state.status === 'unconfigured' || state.status === 'downloaded') return snapshot();
      if (downloadPromise) return downloadPromise;
      if (checkPromise) return checkPromise;
      if (!availableVersion) return snapshot();
      if (isPortable) {
        try {
          await openRelease(release.releaseUrl);
          return setState({ status: 'available', version: availableVersion, message: '已打开发行页，请下载 Portable EXE；关闭游戏后替换原文件。存档会保留。' });
        } catch (error) { return failure(error); }
      }
      setState({ status: 'downloading', version: availableVersion, progress: 0, message: '正在下载更新，游戏可以继续运行。' });
      downloadPromise = Promise.resolve().then(() => getUpdater().downloadUpdate()).then(snapshot).catch(failure).finally(() => { downloadPromise = undefined; });
      return downloadPromise;
    },
    async installUpdate() {
      if (installPending || state.status !== 'downloaded' || isPortable) return;
      installPending = true;
      let willInstall = false;
      try {
        if (!await confirmInstall()) return;
        // Renderer saves its localStorage synchronously before the application is closed.
        await prepareInstall();
        willInstall = true;
        // Let the invoke response reach the renderer before the process starts exiting.
        setImmediate(() => {
          try { getUpdater().quitAndInstall(false, true); }
          catch (error) { installPending = false; failure(error); }
        });
      } catch (error) {
        failure(error);
      } finally {
        if (!willInstall) installPending = false;
      }
    }
  };
}

module.exports = { createUpdateController };
