'use strict';

const { readReleaseConfig } = require('./release-settings.cjs');
const release = readReleaseConfig();

module.exports = {
  appId: 'city.haven.game',
  productName: '栖湾市',
  executableName: 'HavenCity',
  electronVersion: '44.9.0',
  electronDist: require('node:path').join(__dirname, 'node_modules/electron/dist'),
  asar: true,
  compression: 'maximum',
  directories: { output: 'release', buildResources: 'assets' },
  files: ['main.cjs', 'preload.cjs', 'update-controller.cjs', 'release-settings.cjs', 'release-config.json', 'assets/icon.ico', 'game/**/*', 'package.json'],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }, { target: 'portable', arch: ['x64'] }],
    icon: 'assets/icon.ico',
    requestedExecutionLevel: 'asInvoker'
  },
  nsis: {
    artifactName: 'HavenCity-Setup-${version}-${arch}.${ext}',
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: '栖湾市',
    deleteAppDataOnUninstall: false,
    runAfterFinish: true,
    installerLanguages: ['zh_CN', 'en_US'],
    language: '2052'
  },
  portable: { artifactName: 'HavenCity-Portable-${version}-${arch}.${ext}', requestExecutionLevel: 'user' },
  // No credentials belong in the application. GH_TOKEN is used only by release tooling.
  publish: release.configured ? [{ provider: 'github', owner: release.owner, repo: release.repo, releaseType: 'release' }] : null
};
