'use strict';

function stableVersion(value) {
  if (typeof value !== 'string' || value.length > 120) return null;
  const match = /^v?(0|[1-9]\d{0,15})\.(0|[1-9]\d{0,15})\.(0|[1-9]\d{0,15})(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
  if (!match) return null;
  const parts = match.slice(1, 4).map(Number);
  if (!parts.every(Number.isSafeInteger)) return null;
  return { version: value.replace(/^v/, ''), parts };
}

function validAsset(asset, release, tag, version) {
  const name = `HavenCity-Portable-${version}-x64.exe`;
  if (!asset || typeof asset !== 'object' || asset.name !== name || asset.state !== 'uploaded'
    || !Number.isSafeInteger(asset.size) || asset.size <= 0 || typeof asset.browser_download_url !== 'string' || asset.browser_download_url.length > 2000) return false;
  try {
    const raw = asset.browser_download_url;
    const url = new URL(raw);
    // Checking the raw authority also rejects an explicitly supplied default HTTPS port.
    if (!/^https:\/\/github\.com\//i.test(raw) || url.protocol !== 'https:' || url.hostname !== 'github.com'
      || url.username || url.password || url.port || url.search || url.hash) return false;
    const parts = url.pathname.split('/').slice(1).map(part => decodeURIComponent(part));
    if (parts.length !== 6 || parts.some(part => !part || /[/\\\u0000-\u001f\u007f]/.test(part))) return false;
    return parts[0].toLowerCase() === release.owner.toLowerCase() && parts[1].toLowerCase() === release.repo.toLowerCase()
      && parts[2] === 'releases' && parts[3] === 'download' && parts[4] === tag && parts[5] === name;
  } catch { return false; }
}

function publicTag(value, release) {
  if (typeof value !== 'string' || value.length > 2000 || !/^https:\/\/github\.com\//i.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.port || url.search || url.hash) return null;
    const parts = url.pathname.split('/').slice(1).map(part => decodeURIComponent(part));
    if (parts.length !== 5 || parts.some(part => !part || /[/\\\u0000-\u001f\u007f]/.test(part))
      || parts[0].toLowerCase() !== release.owner.toLowerCase() || parts[1].toLowerCase() !== release.repo.toLowerCase()
      || parts[2] !== 'releases' || parts[3] !== 'tag') return null;
    const remote = stableVersion(parts[4]);
    return remote ? { tag: parts[4], remote } : null;
  } catch { return null; }
}

function trustedAssetRedirect(value) {
  if (typeof value !== 'string' || value.length > 12000 || !/^https:\/\/release-assets\.githubusercontent\.com\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'release-assets.githubusercontent.com'
      && !url.username && !url.password && !url.port && !url.hash;
  } catch { return false; }
}

function updateResult(remote, current, currentVersion) {
  let order = 0;
  for (let i = 0; i < 3; i++) if (remote.parts[i] !== current.parts[i]) { order = remote.parts[i] > current.parts[i] ? 1 : -1; break; }
  return { version: order > 0 ? remote.version : currentVersion, available: order > 0 };
}

/** User-triggered Portable checks use a validated GitHub release, never NSIS latest.yml. */
async function checkPortableRelease(release, currentVersion, fetcher = globalThis.fetch) {
  if (!release || release.configured !== true || typeof release.owner !== 'string' || typeof release.repo !== 'string'
    || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(release.owner)
    || !/^[A-Za-z0-9_.-]{1,100}$/.test(release.repo) || ['.', '..'].includes(release.repo)) throw new Error('尚未配置有效的 GitHub 更新仓库。');
  const current = stableVersion(currentVersion);
  if (!current) throw new Error('当前游戏版本无效，无法检查更新。');
  if (typeof fetcher !== 'function') throw new Error('更新网络服务暂不可用，请稍后重试。');
  const signal = AbortSignal.timeout(15_000);
  async function request(url, options) {
    try {
      return await fetcher(url, { credentials: 'omit', cache: 'no-store', signal, ...options });
    } catch (error) {
      throw new Error(signal.aborted || error?.name === 'AbortError' || error?.name === 'TimeoutError'
        ? '连接 GitHub 超时，请稍后重试。' : '无法连接 GitHub，请检查网络后重试。');
    }
  }
  const response = await request(`https://api.github.com/repos/${release.owner}/${release.repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' }, redirect: 'error',
  });
  if ([403, 429].includes(response?.status)) {
    // The anonymous API quota is shared by IP. Public HEAD requests verify the same release without downloading it.
    const page = await request(`https://github.com/${release.owner}/${release.repo}/releases/latest`, { method: 'HEAD', redirect: 'manual' });
    const tag = [302, 303, 307].includes(page?.status) ? publicTag(page.headers.get('location'), release) : null;
    if (!tag) throw new Error('GitHub API 暂时受限，公开发行页也未返回有效的正式版本，请稍后重试。');
    const name = `HavenCity-Portable-${tag.remote.version}-x64.exe`;
    const asset = await request(`https://github.com/${release.owner}/${release.repo}/releases/download/${encodeURIComponent(tag.tag)}/${encodeURIComponent(name)}`, { method: 'HEAD', redirect: 'manual' });
    if (![302, 303, 307].includes(asset?.status) || !trustedAssetRedirect(asset.headers.get('location'))) throw new Error('正式发行中缺少有效的 Windows x64 免安装 EXE，请稍后重试。');
    return updateResult(tag.remote, current, currentVersion);
  }
  if (!response || !response.ok) {
    if (response?.status === 404) throw new Error('尚未找到公开发布的版本，请稍后重试。');
    if ([403, 429].includes(response?.status)) throw new Error('GitHub 请求暂时受限，请稍后重试。');
    throw new Error(`检查更新失败（HTTP ${Number.isInteger(response?.status) ? response.status : '未知'}），请稍后重试。`);
  }
  let data;
  try { data = await response.json(); }
  catch { throw new Error('GitHub 发行信息无法读取，请稍后重试。'); }
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.draft !== false || data.prerelease !== false) throw new Error('未找到有效的正式发行版本。');
  const remote = stableVersion(data.tag_name);
  if (!remote || !Array.isArray(data.assets) || !data.assets.some(asset => validAsset(asset, release, data.tag_name, remote.version))) throw new Error('正式发行中缺少有效的 Windows x64 免安装 EXE。');
  return updateResult(remote, current, currentVersion);
}

module.exports = { checkPortableRelease };
