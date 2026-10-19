import releaseConfig from './release-config.json' with { type: 'json' };

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'current' | 'downloading' | 'downloaded' | 'error' | 'unconfigured';
export interface UpdateState {
  status: UpdateStatus;
  version?: string;
  progress?: number;
  message?: string;
  releaseUrl?: string;
}
export interface ReleaseRepository { owner: string; repo: string }
export interface ReleaseConfig extends ReleaseRepository { version: string }
export interface NormalizedRelease {
  version: string;
  releaseUrl: string;
  assetUrl: string;
  assetName: string;
}
export interface HavenDesktopBridge {
  version: string;
  getUpdateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<UpdateState>;
  downloadUpdate(): Promise<UpdateState>;
  installUpdate(): Promise<void>;
  onUpdateState(callback: (state: UpdateState) => void): () => void;
}
declare global { interface Window { havenDesktop?: HavenDesktopBridge } }

export const RELEASE_CONFIG: Readonly<ReleaseConfig> = Object.freeze({
  owner: releaseConfig.owner,
  repo: releaseConfig.repo,
  version: releaseConfig.version,
});

interface ParsedVersion { core: string[]; pre: string[]; version: string }
function parseVersion(value: string): ParsedVersion | null {
  if (typeof value !== 'string' || value.length > 160) return null;
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
  if (!match) return null;
  const pre = match[4]?.split('.') || [];
  if (pre.some(part => /^\d+$/.test(part) && part.length > 1 && part[0] === '0')) return null;
  return {core: match.slice(1, 4), pre, version: value.replace(/^v/, '')};
}
const compareNumeric = (a: string, b: string): -1 | 0 | 1 => a.length !== b.length ? a.length > b.length ? 1 : -1 : a === b ? 0 : a > b ? 1 : -1;

/** SemVer precedence; null means at least one input is not a valid version. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const left = parseVersion(a), right = parseVersion(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i++) {
    const order = compareNumeric(left.core[i], right.core[i]);
    if (order) return order;
  }
  if (!left.pre.length || !right.pre.length) return left.pre.length === right.pre.length ? 0 : left.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const l = left.pre[i], r = right.pre[i];
    if (l === undefined || r === undefined) return l === undefined ? -1 : 1;
    if (l === r) continue;
    const ln = /^\d+$/.test(l), rn = /^\d+$/.test(r);
    if (ln && rn) return compareNumeric(l, r);
    if (ln !== rn) return ln ? -1 : 1;
    return l > r ? 1 : -1;
  }
  return 0;
}

function validRepository(repository: ReleaseRepository): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(repository.owner)
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(repository.repo)
    && repository.repo !== '.' && repository.repo !== '..';
}
function githubPath(value: unknown, repository: ReleaseRepository): { url: string; parts: string[] } | null {
  if (typeof value !== 'string' || value.length > 2000 || !validRepository(repository)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash) return null;
    const parts = url.pathname.split('/').slice(1).map(part => decodeURIComponent(part));
    if (parts.some(part => !part || part.includes('/') || part.includes('\\') || /[\u0000-\u001f\u007f]/.test(part))) return null;
    if (parts[0]?.toLowerCase() !== repository.owner.toLowerCase() || parts[1]?.toLowerCase() !== repository.repo.toLowerCase() || parts[2] !== 'releases') return null;
    return {url: url.href, parts};
  } catch { return null; }
}

/** Only repository-owned GitHub release pages may be linked from the game UI. */
export function safeReleaseUrl(value: unknown, repository: ReleaseRepository): string | undefined {
  const path = githubPath(value, repository);
  if (!path) return undefined;
  return (path.parts.length === 4 && path.parts[3] === 'latest') || (path.parts.length === 5 && path.parts[3] === 'tag') ? path.url : undefined;
}

/** Validate untrusted API data before exposing a portable EXE or a release link. */
export function normalizeRelease(raw: unknown, repository: ReleaseRepository): NormalizedRelease | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !validRepository(repository)) return null;
  const release = raw as Record<string, unknown>;
  if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string') return null;
  const version = parseVersion(release.tag_name);
  if (!version || version.pre.length) return null;
  const page = githubPath(release.html_url, repository);
  if (!page || page.parts.length !== 5 || page.parts[3] !== 'tag' || page.parts[4] !== release.tag_name || !Array.isArray(release.assets)) return null;
  for (const rawAsset of release.assets) {
    if (!rawAsset || typeof rawAsset !== 'object' || Array.isArray(rawAsset)) continue;
    const asset = rawAsset as Record<string, unknown>;
    if (asset.name !== `HavenCity-Portable-${version.version}-x64.exe`) continue;
    const download = githubPath(asset.browser_download_url, repository);
    if (!download || download.parts.length !== 6 || download.parts[3] !== 'download' || download.parts[4] !== release.tag_name || download.parts[5] !== asset.name) continue;
    return {version: version.version, releaseUrl: page.url, assetUrl: download.url, assetName: asset.name};
  }
  return null;
}

/** Browser fallback; no network request is made until the player asks to check. */
export async function queryLatestRelease(config: ReleaseConfig, fetcher: typeof fetch = fetch): Promise<UpdateState> {
  if (!validRepository(config)) return {status: 'unconfigured', message: '发布地址尚未配置。配置公开 GitHub 仓库后即可检查更新。'};
  if (!parseVersion(config.version)) return {status: 'error', message: '当前版本配置无效，暂时无法检查更新。'};
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetcher(`https://api.github.com/repos/${config.owner}/${config.repo}/releases/latest`, {
      headers: {Accept: 'application/vnd.github+json'},
      credentials: 'omit', cache: 'no-store', signal: controller.signal,
    });
    if (!response.ok) {
      const message = response.status === 404 ? '尚未找到公开发布的版本，请稍后重试。' : response.status === 403 || response.status === 429 ? 'GitHub 检查次数暂时受限，请稍后重试。' : `检查更新失败（HTTP ${response.status}），请重试。`;
      return {status: 'error', message};
    }
    const release = normalizeRelease(await response.json(), config);
    if (!release) return {status: 'error', message: '发布信息中没有有效的免安装 EXE，请稍后重试。'};
    return compareVersions(release.version, config.version)! > 0
      ? {status: 'available', version: release.version, releaseUrl: release.releaseUrl, message: '新版本已发布，可前往 GitHub 下载免安装 EXE，关闭游戏后替换。'}
      : {status: 'current', version: config.version, releaseUrl: release.releaseUrl, message: '当前已是最新版本。'};
  } catch (error) {
    return {status: 'error', message: controller.signal.aborted ? '连接 GitHub 超时，请重试。' : '无法连接 GitHub，请检查网络后重试。'};
  } finally { clearTimeout(timeout); }
}

const statuses: readonly UpdateStatus[] = ['idle', 'checking', 'available', 'current', 'downloading', 'downloaded', 'error', 'unconfigured'];
export class GameUpdater {
  readonly version: string;
  readonly desktop: boolean;
  private state: UpdateState;
  private listeners = new Set<(state: UpdateState) => void>();
  private unsubscribe?: () => void;
  private busy = false;
  private revision = 0;
  private bridge: HavenDesktopBridge | undefined;
  private config: ReleaseConfig;

  constructor(bridge: HavenDesktopBridge | undefined = typeof window === 'undefined' ? undefined : window.havenDesktop, config: ReleaseConfig = RELEASE_CONFIG) {
    this.bridge = bridge; this.config = config;
    this.desktop = !!bridge;
    this.version = bridge && parseVersion(bridge.version) ? bridge.version : config.version;
    this.state = !bridge && !validRepository(config) ? {status: 'unconfigured', message: '发布地址尚未配置。配置公开 GitHub 仓库后即可检查更新。'} : {status: 'idle'};
    if (bridge) {
      try { this.unsubscribe = bridge.onUpdateState(state => this.accept(state)); }
      catch { this.accept({status: 'error', message: '更新服务暂时不可用，请重新检查。'}); }
      const revision = this.revision;
      void Promise.resolve().then(() => bridge.getUpdateState()).then(state => { if (!this.busy && this.revision === revision) this.accept(state); }).catch(() => { if (!this.busy && this.revision === revision) this.accept({status: 'error', message: '无法读取更新状态，请重试。'}); });
    }
  }

  getState(): UpdateState { return {...this.state}; }
  subscribe(callback: (state: UpdateState) => void): () => void {
    this.listeners.add(callback); callback(this.getState());
    return () => this.listeners.delete(callback);
  }
  dispose() { this.unsubscribe?.(); this.listeners.clear(); }

  private accept(value: UpdateState) {
    const state: UpdateState = {status: statuses.includes(value?.status) ? value.status : 'error'};
    if (typeof value?.version === 'string' && parseVersion(value.version)) state.version = value.version;
    if (typeof value?.message === 'string') state.message = value.message.slice(0, 300);
    if (typeof value?.progress === 'number' && Number.isFinite(value.progress)) state.progress = Math.max(0, Math.min(100, value.progress));
    const url = safeReleaseUrl(value?.releaseUrl, this.config);
    if (url) state.releaseUrl = url;
    this.state = state;
    this.revision++;
    for (const listener of this.listeners) listener(this.getState());
  }

  async check(): Promise<UpdateState> {
    if (this.busy || this.state.status === 'downloading' || this.state.status === 'downloaded') return this.getState();
    this.busy = true; this.accept({status: 'checking', message: '正在连接 GitHub，检查正式版本…'});
    try { this.accept(this.bridge ? await this.bridge.checkForUpdates() : await queryLatestRelease(this.config)); }
    catch { this.accept({status: 'error', message: '检查更新失败，请检查网络后重试。'}); }
    finally { this.busy = false; }
    return this.getState();
  }

  async download(): Promise<UpdateState> {
    if (!this.bridge || this.busy || this.state.status !== 'available') return this.getState();
    this.busy = true;
    const previous = this.getState();
    this.accept({...previous, status: 'downloading', progress: 0, message: '正在下载更新，可以继续浏览菜单。'});
    try { this.accept(await this.bridge.downloadUpdate()); }
    catch { this.accept({...previous, status: 'error', message: '下载更新失败，请重新检查后重试。'}); }
    finally { this.busy = false; }
    return this.getState();
  }

  async install(): Promise<void> {
    if (!this.bridge || this.busy || this.state.status !== 'downloaded') return;
    this.busy = true;
    try { await this.bridge.installUpdate(); }
    catch { this.accept({...this.state, status: 'error', message: '无法启动更新安装，请重新检查后重试。'}); }
    finally { this.busy = false; }
  }
}
