import { BUILDINGS, FURNITURE, PRISON_RULES, CAREERS, CITY_EVENTS, CITY_POLICIES, LEVEL_XP, xpLevel, wageFor, GRID, TILE, cellToWorld, type Building, type BuildingKind, type CameraMode, type CareerTrack, type CityEvent, type CityPolicy, type EventChoice, type FurnitureKind, type GameState, type Interaction, type PrisonRegime, type Resident, type SkillKind, type SocialAction, type Speed, type Tool } from './types';
import { GameUpdater, type UpdateState } from './updater';

export interface UIActions {
  tool: (tool: Tool) => void;
  mode: (mode: CameraMode) => void;
  speed: (speed: Speed) => void;
  tax: (value: number) => void;
  interact: (action: Interaction, id?: number) => void;
  save: () => void;
  load: () => void;
  reset: () => void;
  focus: () => void;
  selectResident: (id: number) => void;
  buyFurniture: (kind: FurnitureKind) => void;
  sellFurniture: (id: number) => void;
  socialize: (action: SocialAction, id: number) => void;
  prisonRegime: (regime: PrisonRegime) => void;
  prisonIntake: (enabled: boolean) => void;
  upgrade: (id: number) => void;
  career: (track: CareerTrack) => void;
  policy: (policy: CityPolicy, enabled: boolean) => void;
  resolveEvent: (id: number, choice: EventChoice) => void;
  focusEvent: (id: number) => void;
}

const paths: Record<string, string> = {
  cursor: '<path d="m5 3 14 9-7 1-4 7z"/>',
  road: '<path d="m7 3-3 18M17 3l3 18M12 4v3m0 4v3m0 4v3"/>',
  home: '<path d="m3 10 9-7 9 7M5 9v11h14V9M10 20v-7h4v7"/>',
  building: '<path d="M5 21V3h14v18M3 21h18M9 7h1m4 0h1M9 11h1m4 0h1M9 15h1m4 0h1m-4 6v-3h2v3"/>',
  shop: '<path d="M4 10v11h16V10M3 7l2-4h14l2 4v3H3zM8 21v-7h5v7m3-7h1"/>',
  office: '<path d="M3 21h18M5 21V7h9v14m0-18h5v18M8 11h3m-3 4h3m-3 4h3m6-12v1m0 3v1m0 3v1"/>',
  tree: '<path d="m12 2-6 7h3l-5 7h16l-5-7h3zM12 16v6M8 22h8"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-13h-7z"/>',
  water: '<path d="M12 2S5 10 5 15a7 7 0 0 0 14 0c0-5-7-13-7-13ZM8 15a4 4 0 0 0 4 4"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  shield: '<path d="m12 2 8 3v6c0 5-8 11-8 11S4 16 4 11V5zM8 11l3 3 5-6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2"/>',
  hammer: '<path d="m3 21 9-9M9 5l4-3 8 8-3 4-4-4-3 3-4-4z"/>',
  city: '<path d="M3 21h18M4 21V9h6v12m0-18h7v18m0-9h4v9M7 12v1m0 3v1m6-11v1m0 3v1m0 3v1"/>',
  person: '<circle cx="12" cy="5" r="3"/><path d="M5 21v-3a7 7 0 0 1 14 0v3M5 21h14"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  people: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m3-17a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 5v2"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14a4 4 0 0 0 8 0M8 9h.1m7.8 0h.1"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="m8 7 4 5 4-5m-4 5v6m-4-7h8m-8 4h8"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  chevron: '<path d="m8 5 7 7-7 7"/>',
  check: '<path d="m5 12 4 4L20 5"/>',
  flag: '<path d="M5 22V3m0 0c5-4 9 4 15 0v11c-6 4-10-4-15 0"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m8 4 12 8-12 8z"/>',
  fast: '<path d="m3 5 9 7-9 7zm9 0 9 7-9 7z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  settings: '<path d="M4 7h16M4 17h16M8 4v6m8 4v6"/>',
  focus: '<circle cx="12" cy="12" r="5"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>',
  save: '<path d="M4 3h13l3 3v15H4zM8 3v7h8V3M8 21v-7h8v7"/>',
  load: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 0 1 6 1c0 2-3 2-3 5m0 3h.01"/>',
  reset: '<path d="M3 10a9 9 0 1 1 0 5m0-11v6h6"/>',
  talk: '<path d="M21 11a8 8 0 0 1-8 8H8l-5 3V7a5 5 0 0 1 5-5h5a8 8 0 0 1 8 9ZM7 10h10M7 14h6"/>',
  eat: '<path d="M5 3v7m4-7v7M3 3v5a4 4 0 0 0 8 0V3M7 12v10M18 3v19m0-19c-4 4-4 9 0 9"/>',
  rest: '<path d="M3 21V6m0 10h18v5M3 12h6v4m0-5h9a3 3 0 0 1 3 3v2"/>',
  work: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12c6 4 12 4 18 0m-9 1v4"/>',
  relax: '<path d="M5 20c7 2 15-4 14-17C6 2 1 9 5 16c3-5 7-7 10-9M3 22l6-9"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
};
const icon = (name: string, cls = '') => `<svg class="ui-icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.city}</svg>`;
const esc = (value: unknown) => String(value).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]!));
const number = (n: number) => Math.round(n).toLocaleString('zh-CN');
const pct = (n: number) => Math.min(100, Math.max(0, n));
const categories = ['居住', '商业', '公共', '管理'] as const;
const actionNames: Record<Interaction, string> = { talk:'打个招呼', eat:'吃顿热饭', rest:'回家休息', work:'开始工作', relax:'享受公园', adopt:'搬入新家', patrol:'参与巡逻', enter:'进入我的家', exit:'离开住宅', furniture:'使用附近家具', study:'参加学校进修' };
const relationship = (n: number) => n < 20 ? '初次见面' : n < 35 ? '熟悉的邻居' : n < 70 ? '好朋友' : '亲密好友';
const regimes: [PrisonRegime, string][] = [['balanced','均衡日常'],['rehabilitation','康复优先'],['strict','严格监管']];
const prisonSchedule = [['06—08','早餐'],['08—12','劳动'],['12—16','课程'],['16—19','放风'],['19—06','休息']];
const skillInfo: Record<SkillKind, {name:string;icon:string;description:string;practice:string}> = {
  logic: {name:'逻辑',icon:'help',description:'提高商业与科技职业的工资。',practice:'阅读、远程办公或到学校进修。'},
  cooking: {name:'烹饪',icon:'eat',description:'每提升一级，食材费少 ¥1、饱腹多恢复 5。',practice:'使用家中厨房练习，也能提高餐饮职业工资。'},
  charisma: {name:'沟通',icon:'talk',description:'每提升一级，对话增加 2 点关系提升。',practice:'聊天、赞美、送礼和巡逻；提高社区职业工资。'}
};

export class GameUI {
  private state: GameState | null = null;
  private selected: Building | Resident | null = null;
  private mode: CameraMode = 'city';
  private tool: Tool = 'select';
  private category: typeof categories[number] = '居住';
  private drawer: 'manage' | 'menu' | 'help' | 'furniture' | 'contacts' | 'career' | 'journal' | null = null;
  private journalEventId?: number;
  private historyExpanded = false;
  private missionCollapsed = false;
  private tipDismissed = false;
  private confirming = false;
  private contextAction?: Interaction;
  private contextId?: number;
  private lastNotice = 0;
  private cache = new Map<string, string>();
  private minimap: HTMLCanvasElement;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private updater = new GameUpdater();
  private updateState: UpdateState = this.updater.getState();
  private installingUpdate = false;

  constructor(private root: HTMLElement, private actions: UIActions) {
    root.className = 'game-ui';
    root.innerHTML = `
      <div class="city-brand"><div class="brand-mark">${icon('city')}</div><div><div class="brand-name">栖湾<span>市</span></div><div class="brand-sub">HAVEN CITY <span>·</span> 滨水新城</div></div><button class="brand-manage icon-button" data-ui="drawer" data-drawer="manage" title="城市管理" aria-label="城市管理">${icon('settings')}</button></div>
      <nav class="camera-switch glass" aria-label="切换视角"><button data-ui="mode" data-mode="city" title="城市规划 · 快捷键 1">${icon('city')}<span>城市规划</span><kbd>1</kbd></button><button data-ui="mode" data-mode="third" title="居民生活 · 快捷键 2">${icon('person')}<span>居民生活</span><kbd>2</kbd></button><button data-ui="mode" data-mode="first" title="第一人称 · 快捷键 3">${icon('eye')}<span>第一人称</span><kbd>3</kbd></button></nav>
      <div class="city-resources glass"><div class="resource money" title="城市资金">${icon('coin')}<div><small>城市资金</small><strong id="city-money">0</strong></div><span id="city-balance" class="balance"></span></div><div class="resource" title="城市人口">${icon('people')}<div><small>居民</small><strong id="city-population">0</strong></div></div><div class="resource happiness" title="居民幸福度">${icon('smile')}<div><small>幸福度</small><strong id="city-happiness">0<span>%</span></strong></div></div><button class="icon-button menu-button" data-ui="drawer" data-drawer="menu" title="游戏菜单" aria-label="游戏菜单">${icon('menu')}</button></div>
      <button class="event-chip glass" data-ui="journal" aria-label="城市事件" title="城市事件 · J">${icon('flag')}<span>城市事件</span><strong id="event-count">0</strong><kbd>J</kbd></button>
      <div id="mission" class="mission-panel"></div>
      <div id="interior-banner" class="interior-banner glass" hidden><span class="home-symbol">${icon('home')}</span><div><small>HOME, SWEET HOME</small><strong>我的家</strong><span id="home-guest">把日常过成喜欢的模样。</span></div><button data-ui="interact" data-action="exit" title="离开住宅 · H">${icon('arrow')}<span>出门</span></button></div>
      <aside id="drawer" class="drawer glass" hidden></aside>
      <aside id="inspector" class="inspector glass" hidden></aside>
      <div id="toast" class="toast" role="status" aria-live="polite"></div>
      <div id="onboarding" class="onboarding"><span class="tip-symbol">${icon('relax')}</span><div><strong>一座城市，一种自己的生活。</strong><span id="tip-copy">从一条道路、一间小屋开始，也可以按 <kbd>2</kbd> 走进这座城。</span></div><button class="icon-button" data-ui="dismiss-tip" title="收起提示" aria-label="收起提示">${icon('close')}</button></div>
      <div id="build-dock" class="build-dock glass"><div class="dock-heading"><span class="dock-caption">营造城市</span><nav class="build-categories" aria-label="建筑分类">${categories.map(c => `<button data-ui="category" data-category="${c}">${c === '公共' ? '公共服务' : c === '管理' ? '城市管理' : c}</button>`).join('')}</nav><span class="dock-key">B <span>道路</span></span></div><div id="build-tools" class="build-tools"></div><div id="tool-description" class="tool-description"></div></div>
      <div id="life-dock" class="life-dock glass" hidden><div class="life-identity"><div class="avatar">${icon('person')}</div><div><small id="life-location">正在体验生活</small><strong id="player-name">林间</strong><span id="player-wallet"></span></div></div><div class="needs">${[['hunger','eat','饱腹'],['energy','rest','精力'],['social','talk','社交'],['joy','smile','愉悦'],['hygiene','water','清洁']].map(([key, name, label])=>`<div class="need" title="${label}">${icon(name)}<span>${label}</span><div class="need-track"><i id="need-${key}"></i></div></div>`).join('')}</div><div class="life-actions">${(['eat','rest','work','relax'] as Interaction[]).map(a=>`<button data-ui="interact" data-action="${a}" title="${actionNames[a]}">${icon(a)}<span>${{eat:'用餐',rest:'休息',work:'上班',relax:'放松'}[a as 'eat']}</span></button>`).join('')}<button class="indoor-clean" data-ui="use-furniture-kind" data-kind="shower" title="走到淋浴间旁洗澡" hidden>${icon('water')}<span>洗澡</span></button></div><div class="life-utilities"><button id="home-button" data-ui="interact" data-action="enter" title="走到自家门口进入 · H">${icon('home')}<span>我的家</span></button><button id="decorate-button" data-ui="drawer" data-drawer="furniture" hidden title="购置家具与使用房间设施">${icon('hammer')}<span>装修住宅</span></button><button data-ui="drawer" data-drawer="contacts" title="查看关系，邀请朋友">${icon('people')}<span>居民关系</span></button></div></div>
      <div id="context-prompt" class="context-prompt" hidden><kbd>F</kbd><span id="context-text"></span><button data-ui="context" aria-label="执行互动">${icon('arrow')}</button></div>
      <div class="time-control"><div class="clock-label">${icon('sun')}<strong id="city-date">第 1 天</strong><span id="city-hour">08:00</span><span id="weather-label">晴朗</span></div><div class="time-buttons glass"><button data-ui="speed" data-speed="0" title="暂停 · 空格" aria-label="暂停">${icon('pause')}</button><button data-ui="speed" data-speed="1" title="正常速度" aria-label="正常速度">${icon('play')}</button><button data-ui="speed" data-speed="3" title="三倍速度" aria-label="三倍速度">${icon('fast')}<span>3</span></button><span class="time-divider"></span><button data-ui="drawer" data-drawer="help" title="操作指南" aria-label="操作指南">${icon('help')}</button></div></div>
      <div class="minimap-wrap"><div class="minimap-heading"><span id="map-title">栖湾 · 城区鸟瞰</span><button data-ui="focus" title="回到焦点" aria-label="回到焦点">${icon('focus')}</button></div><canvas id="minimap" width="174" height="142" aria-label="城市与室内小地图"></canvas><span class="map-north">N <i>↑</i></span><div class="minimap-footer"><i></i><span id="map-mode">规划视角</span><span id="map-scale">240 m</span></div></div>
      <div class="world-credit">栖居于此 <span>·</span> 自在生长</div>`;
    root.querySelector('.life-utilities')!.insertAdjacentHTML('beforeend', `<button data-ui="drawer" data-drawer="career" title="职业进展与个人技能">${icon('work')}<span>职业与技能</span></button>`);
    this.minimap = root.querySelector<HTMLCanvasElement>('#minimap')!;
    root.addEventListener('click', this.onClick);
    root.addEventListener('input', this.onInput);
    root.addEventListener('pointerdown', e => { if ((e.target as HTMLElement).closest('button,input,.drawer,.inspector,.build-dock,.life-dock')) e.stopPropagation(); });
    window.addEventListener('keydown', e => {
      if (e.code !== 'Escape' || !this.drawer) return;
      e.stopImmediatePropagation();
      this.drawer = null; this.confirming = false; this.renderDrawer(); this.renderMission();
    });
    this.renderTools();
    this.updater.subscribe(state => { this.updateState = state; this.refreshUpdater(); });
  }

  private text(id: string, value: string) {
    if (this.cache.get(id) === value) return;
    const el = this.root.querySelector<HTMLElement>(`#${id}`);
    if (el) el.textContent = value;
    this.cache.set(id, value);
  }

  private onClick = (event: MouseEvent) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-ui]');
    if (!button) return;
    const data = button.dataset;
    switch (data.ui) {
      case 'mode': this.actions.mode(data.mode as CameraMode); break;
      case 'tool': this.actions.tool(data.tool as Tool); break;
      case 'category': this.category = data.category as typeof categories[number]; this.renderTools(); break;
      case 'speed': this.actions.speed(Number(data.speed) as Speed); break;
      case 'drawer': this.drawer = this.drawer === data.drawer ? null : data.drawer as typeof this.drawer; this.confirming = false; this.renderDrawer(); this.renderMission(); break;
      case 'close-drawer': this.drawer = null; this.confirming = false; this.renderDrawer(); this.renderMission(); break;
      case 'mission': this.missionCollapsed = !this.missionCollapsed; this.renderMission(); break;
      case 'dismiss-tip': this.tipDismissed = true; this.root.querySelector<HTMLElement>('#onboarding')!.hidden = true; break;
      case 'interact': this.performInteraction(data.action as Interaction, data.id ? Number(data.id) : undefined); break;
      case 'use-furniture-kind': this.useFurniture(data.kind as FurnitureKind); break;
      case 'buy-furniture': this.actions.buyFurniture(data.kind as FurnitureKind); this.refreshFurniture(); break;
      case 'sell-furniture': this.actions.sellFurniture(Number(data.id)); this.refreshFurniture(); break;
      case 'social': this.actions.socialize(data.action as SocialAction, Number(data.id)); this.refreshContacts(); break;
      case 'prison-regime': this.actions.prisonRegime(data.regime as PrisonRegime); this.refreshManagement(); break;
      case 'prison-intake': this.actions.prisonIntake(!this.state?.prison.intake); this.refreshManagement(); break;
      case 'upgrade': this.actions.upgrade(Number(data.id)); break;
      case 'career': this.actions.career(data.track as CareerTrack); this.refreshCareer(); break;
      case 'policy': this.actions.policy(data.policy as CityPolicy, !this.state?.civic.policies[data.policy as CityPolicy]); this.refreshManagement(); break;
      case 'journal': if (this.drawer === 'journal') { this.drawer = null; this.renderDrawer(); this.renderMission(); } else this.openJournal(); break;
      case 'resolve-event': this.actions.resolveEvent(Number(data.id), data.choice as EventChoice); this.refreshJournal(); break;
      case 'focus-event': this.journalEventId = Number(data.id); this.actions.focusEvent(Number(data.id)); this.refreshJournal(); break;
      case 'event-history': this.historyExpanded = !this.historyExpanded; this.refreshJournal(); break;
      case 'context': if (this.contextAction) this.actions.interact(this.contextAction, this.contextId); break;
      case 'focus': this.actions.focus(); break;
      case 'follow': this.actions.selectResident(Number(data.id)); this.actions.focus(); break;
      case 'save': this.actions.save(); break;
      case 'load': this.actions.load(); break;
      case 'confirm-reset': this.confirming = true; this.renderDrawer(); break;
      case 'cancel-reset': this.confirming = false; this.renderDrawer(); break;
      case 'reset': this.actions.reset(); this.drawer = null; this.confirming = false; this.renderDrawer(); break;
      case 'resident': if (this.drawer === 'contacts') { this.drawer = null; this.renderDrawer(); this.renderMission(); } this.actions.selectResident(Number(data.id)); break;
      case 'help': this.drawer = 'help'; this.renderDrawer(); break;
      case 'check-update': void this.updater.check(); break;
      case 'download-update': void this.updater.download(); break;
      case 'save-before-update': this.actions.save(); break;
      case 'install-update': if (!this.installingUpdate) { this.installingUpdate = true; this.refreshUpdater(); void this.updater.install().finally(() => { this.installingUpdate = false; this.refreshUpdater(); }); } break;
    }
    button.blur();
  };

  private performInteraction(action: Interaction, id?: number) {
    if (this.state?.interior && ['eat','rest','work','relax'].includes(action)) {
      this.useFurniture(({eat:'kitchen',rest:'bed',work:'desk',relax:'sofa'} as Record<string, FurnitureKind>)[action]);
      return;
    }
    this.actions.interact(action, id);
    if (action === 'furniture' && this.drawer === 'furniture') {
      this.drawer = null; this.renderDrawer(); this.renderMission();
    }
  }

  private useFurniture(kind: FurnitureKind) {
    const home = this.state?.homes.find(h => h.homeId === this.state?.interior?.homeId);
    const item = home?.furniture.find(f => f.kind === kind);
    if (!item) { this.toast(`家里还没有${FURNITURE[kind].name}，打开「装修住宅」添置一件吧。`, 'info'); return; }
    this.performInteraction('furniture', item.id);
  }

  private onInput = (event: Event) => {
    const target = event.target as HTMLInputElement;
    if (target.id === 'tax-slider') {
      this.actions.tax(Number(target.value));
      const label = this.root.querySelector('#tax-label');
      if (label) label.textContent = `${target.value}%`;
    }
  };

  update(state: GameState, mode: CameraMode, tool: Tool, selected: Building | Resident | null) {
    const modeChanged = this.mode !== mode;
    const toolChanged = this.tool !== tool;
    if(this.state !== state) this.lastNotice = 0;
    this.state = state; this.mode = mode; this.selected = selected; this.tool = tool;
    this.root.dataset.mode = mode;
    this.root.dataset.interior = String(Boolean(state.interior));
    if (!state.interior && this.drawer === 'furniture') { this.drawer = null; this.renderDrawer(); }
    this.root.querySelector<HTMLElement>('#interior-banner')!.hidden = !state.interior;
    const homeButton = this.root.querySelector<HTMLButtonElement>('#home-button')!;
    homeButton.hidden = Boolean(state.interior);
    homeButton.disabled = !state.player.homeId;
    homeButton.title = state.player.homeId ? '走到自家门口进入 · H' : '走近住宅，选择「把这里当作家」后即可进入';
    this.root.querySelector<HTMLElement>('#decorate-button')!.hidden = !state.interior;
    this.root.querySelector<HTMLElement>('.indoor-clean')!.hidden = !state.interior;
    const guest = state.interior?.guestId ? state.residents.find(r => r.id === state.interior?.guestId) : undefined;
    this.text('home-guest', guest ? `${guest.name} 来做客了，和朋友聊聊近况吧。` : '把日常过成喜欢的模样。');
    this.text('life-location', state.interior ? '享受居家时光' : '正在体验生活');
    this.text('map-title', state.interior ? '我的家 · 房间平面图' : '栖湾 · 城区鸟瞰');
    this.text('map-scale', state.interior ? '室内' : '240 m');
    this.text('city-money', number(state.money));
    const balance = state.stats.income - state.stats.expenses;
    this.text('city-balance', `${balance >= 0 ? '+' : '−'}${number(Math.abs(balance))}/日`);
    this.root.querySelector('#city-balance')!.classList.toggle('negative', balance < 0);
    this.text('city-population', number(state.stats.population));
    this.text('city-happiness', `${Math.round(state.stats.happiness)}%`);
    this.text('city-date', `第 ${Math.floor(state.day)} 天`);
    this.text('city-hour', `${String(Math.floor(state.hour)).padStart(2, '0')}:${String(Math.floor((state.hour % 1) * 60)).padStart(2, '0')}`);
    this.text('weather-label', state.weather);
    this.text('player-name', state.player.name);
    this.text('player-wallet', `个人资金 ¥ ${number(state.player.money)}`);
    const pendingEvents = state.civic.events.filter(event => event.status === 'pending').length;
    this.text('event-count', String(pendingEvents));
    const eventChip = this.root.querySelector<HTMLButtonElement>('.event-chip')!;
    eventChip.classList.toggle('has-events', pendingEvents > 0);
    eventChip.title = pendingEvents ? `${pendingEvents} 件城市事件待处理 · J` : '暂无待处理事件 · J';
    eventChip.setAttribute('aria-description', pendingEvents ? `${pendingEvents} 件待处理` : '暂无待处理事件');
    const progress = state.progression;
    const careerLevel = xpLevel(progress.careers[progress.career].xp);
    this.root.querySelector<HTMLButtonElement>('[data-drawer="career"]')!.title = `${CAREERS[progress.career].roles[careerLevel - 1]} · Lv. ${careerLevel}`;
    this.text('map-mode', state.interior ? '居家生活' : mode === 'city' ? '规划视角' : mode === 'third' ? '居民视角' : '第一人称');
    this.root.querySelectorAll<HTMLButtonElement>('[data-ui="mode"]').forEach(el => { el.classList.toggle('active', el.dataset.mode === mode); el.setAttribute('aria-pressed', String(el.dataset.mode === mode)); });
    this.root.querySelectorAll<HTMLButtonElement>('[data-ui="speed"]').forEach(el => el.classList.toggle('active', Number(el.dataset.speed) === state.speed));
    this.root.querySelector<HTMLElement>('#build-dock')!.hidden = mode !== 'city';
    this.root.querySelector<HTMLElement>('#life-dock')!.hidden = mode === 'city';
    if (toolChanged) {
      const def = BUILDINGS[tool as BuildingKind];
      if (def && def.category !== '道路') this.category = def.category;
      this.renderTools();
    }
    for (const key of ['hunger', 'energy', 'social', 'joy', 'hygiene'] as const) {
      const need = this.root.querySelector<HTMLElement>(`#need-${key}`)!;
      need.style.width = `${pct(state.player[key])}%`;
      need.classList.toggle('low', state.player[key] < 30);
      need.parentElement!.parentElement!.title = `${{hunger:'饱腹',energy:'精力',social:'社交',joy:'愉悦',hygiene:'清洁'}[key]} ${Math.round(state.player[key])}%`;
    }
    this.renderMission();
    this.renderInspector();
    if (this.drawer === 'manage') this.refreshManagement();
    if (this.drawer === 'furniture') this.refreshFurniture();
    if (this.drawer === 'contacts') this.refreshContacts();
    if (this.drawer === 'career') this.refreshCareer();
    if (this.drawer === 'journal') this.refreshJournal();
    if (modeChanged && !this.tipDismissed) this.text('tip-copy', mode === 'city' ? '从一条道路、一间小屋开始，也可以按 2 走进这座城。' : 'WASD 移动，右键拖动环顾。靠近建筑或居民，按 F 互动。');
    const notices = state.notices.filter(n => n.id > this.lastNotice);
    if (notices.length) {
      const last = notices[notices.length - 1];
      this.lastNotice = last.id;
      this.toast(last.text, last.kind);
    }
    this.drawMap();
  }

  private renderTools() {
    this.root.querySelectorAll<HTMLElement>('[data-ui="category"]').forEach(el => el.classList.toggle('active', el.dataset.category === this.category));
    const kinds = (Object.keys(BUILDINGS) as BuildingKind[]).filter(kind => BUILDINGS[kind].category === this.category);
    const toolButton = (tool: Tool, name: string, svg: string, sub: string) => `<button class="build-tool ${this.tool === tool ? 'active' : ''}" data-ui="tool" data-tool="${tool}" title="${name}${BUILDINGS[tool as BuildingKind] ? ` · ¥ ${number(BUILDINGS[tool as BuildingKind].cost)}` : ''}" aria-pressed="${this.tool === tool}">${icon(svg)}<span>${name}</span><small>${sub}</small></button>`;
    this.root.querySelector('#build-tools')!.innerHTML = toolButton('select', '选择', 'cursor', 'ESC') + toolButton('road', '道路', 'road', '¥ 80') + '<i class="dock-divider"></i>' + kinds.map(kind => toolButton(kind, BUILDINGS[kind].name.replace('城市公寓','公寓').replace('花园住宅','住宅').replace('街角商店','商店').replace('商务中心','商务楼').replace('邻里公园','公园').replace('清洁能源站','能源站').replace('水务中心','水务站').replace('社区医院','医院').replace('社区学校','学校').replace('滨湾消防站','消防站').replace('社区警局','警局').replace('矫正中心','矫正中心'), BUILDINGS[kind].icon, `¥ ${number(BUILDINGS[kind].cost)}`)).join('') + '<i class="dock-divider"></i>' + toolButton('bulldoze', '拆除', 'hammer', '返还 45%');
    const desc = this.tool === 'select' ? '点击建筑或居民，看看这里的生活。' : this.tool === 'bulldoze' ? '点击建筑拆除，部分建造费用将返还。' : `${BUILDINGS[this.tool].description}　点击空地建造 · ESC 取消`;
    this.root.querySelector('#tool-description')!.textContent = desc;
  }

  private renderMission() {
    const el = this.root.querySelector<HTMLElement>('#mission')!;
    el.hidden = Boolean(this.state?.interior) || this.drawer === 'manage' || this.drawer === 'furniture';
    if (!this.state) return;
    const missions = this.state.missions;
    const completed = missions.filter(m => m.completed).length;
    const current = missions.find(m => !m.completed);
    const signature = `${this.missionCollapsed}|${current?.id}|${current?.progress}|${completed}`;
    if (this.cache.get('mission-content') === signature) return;
    this.cache.set('mission-content', signature);
    el.classList.toggle('collapsed', this.missionCollapsed);
    el.innerHTML = `<button class="mission-toggle" data-ui="mission"><span class="mission-symbol">${icon(current ? 'flag' : 'check')}</span><span><small>城市手记 <em>${completed}/${missions.length}</em></small><strong>${esc(current?.title || '生活，正在发生')}</strong></span>${icon('chevron','mission-chevron')}</button>${!this.missionCollapsed ? `<div class="mission-content"><p>${esc(current?.description || '继续营造街区，或走进城市，发现属于你的日常。')}</p>${current ? `<div class="mission-progress"><span><i style="width:${pct(current.progress / current.target * 100)}%"></i></span><small>${number(current.progress)} / ${number(current.target)}</small></div><div class="mission-reward">完成奖励 <span>+ ¥ ${number(current.reward)}</span></div>` : ''}</div>` : ''}`;
  }

  private renderInspector() {
    const el = this.root.querySelector<HTMLElement>('#inspector')!;
    el.hidden = !this.selected || this.drawer === 'menu' || this.drawer === 'help' || this.drawer === 'contacts' || this.drawer === 'furniture' || this.drawer === 'career' || this.drawer === 'journal';
    if (!this.selected || !this.state) { this.cache.delete('inspector-content'); return; }
    const selected = this.selected;
    let html = '';
    if ('kind' in selected) {
      const def = BUILDINGS[selected.kind];
      const occupants = this.state.residents.filter(r => r.homeId === selected.id);
      const workers = this.state.residents.filter(r => r.jobId === selected.id);
      const level = selected.level;
      const upkeep = Math.round(def.upkeep * (1 + .6 * (level - 1)) * (selected.kind === 'prison' ? PRISON_RULES[this.state.prison.regime].upkeep : 1) * 10) / 10;
      const upgradeCost = Math.floor(def.cost * .65 * level);
      const isHome = selected.kind === 'home' || selected.kind === 'apartment';
      const capacity = def.capacity * level;
      const description = isHome ? `舒适的居住空间，容纳 ${capacity} 位居民。走近住宅，可以认领自己的家。` : def.description.replace(/120/g, String(capacity)).replace('80 个教育名额', `${capacity} 个教育名额`).replace('16 人', `${capacity} 人`).replace(/提供 \d+ 个岗位/, `提供 ${def.jobs * level} 个岗位`);
      html = `<div class="inspect-overline">${icon(def.icon)}<span>城市建筑</span><span class="status-dot ${selected.active ? 'online' : ''}"></span><small>${selected.active ? '运营中' : '等待连接'}</small></div><div class="inspect-title"><h2>${def.name}</h2><em>Lv. ${level}</em></div><p class="inspect-description">${description}</p><div class="inspect-facts"><div><span>每日维护</span><strong>¥ ${upkeep}</strong></div>${def.capacity ? `<div><span>${selected.kind === 'prison' ? '收押容量' : isHome ? '居住人数' : '服务容量'}</span><strong>${isHome ? `${occupants.length} / ` : ''}${capacity}</strong></div>` : ''}${def.jobs ? `<div><span>工作岗位</span><strong>${workers.length} / ${def.jobs * level}</strong></div>` : ''}</div>${selected.kind !== 'road' ? `<button class="upgrade-button" data-ui="upgrade" data-id="${selected.id}" ${level >= 3 || !selected.active || this.state.money < upgradeCost ? 'disabled' : ''}>${icon(level >= 3 ? 'check' : 'building')}<span>${level >= 3 ? '已达最高等级' : `升级至 Lv. ${level + 1}`}</span><strong>${level >= 3 ? 'MAX' : `¥ ${number(upgradeCost)}`}</strong></button>` : ''}${!selected.active ? '<div class="inspect-warning">请确保建筑相邻有道路，并提供充足水电。</div>' : ''}${occupants.length ? `<div class="resident-list"><small>住在这里</small>${occupants.slice(0,4).map(r => `<button data-ui="resident" data-id="${r.id}"><span class="resident-dot" style="background:${esc(r.color)}"></span>${esc(r.name)}<span>${esc(r.activity)}</span>${icon('chevron')}</button>`).join('')}</div>` : ''}${isHome ? this.state.player.homeId === selected.id ? `<button class="primary-button" data-ui="interact" data-action="enter" data-id="${selected.id}">${icon('home')}走近家门，进入住宅</button>` : `<button class="primary-button" data-ui="interact" data-action="adopt" data-id="${selected.id}">${icon('home')}把这里当作家</button>` : ''}${({shop:'eat',office:'work',park:'relax',prison:'patrol',police:'patrol',school:'study'} as Record<string, Interaction>)[selected.kind] ? `<button class="primary-button" data-ui="interact" data-action="${({shop:'eat',office:'work',park:'relax',prison:'patrol',police:'patrol',school:'study'} as Record<string, Interaction>)[selected.kind]}" data-id="${selected.id}">${icon('arrow')}在附近互动 · ${actionNames[({shop:'eat',office:'work',park:'relax',prison:'patrol',police:'patrol',school:'study'} as Record<string, Interaction>)[selected.kind]]}</button>` : ''}`;
    } else {
      const canInvite = Boolean(this.state.interior && this.state.interior.homeId === this.state.player.homeId && selected.relation >= 35 && this.state.interior.guestId !== selected.id);
      html = `<div class="inspect-overline">${icon('person')}<span>栖湾居民</span><span class="status-dot online"></span><small>${esc(selected.activity)}</small></div><div class="resident-profile"><div class="profile-avatar" style="--resident-color:${esc(selected.color)}">${icon('person')}</div><div><h2>${esc(selected.name)}</h2><p>${selected.jobId ? '有一份稳定的工作' : '正在寻找生活的可能'}</p></div></div><div class="inspect-facts"><div><span>心情</span><strong>${Math.round(selected.mood)} / 100</strong></div><div><span>彼此关系</span><strong>${relationship(selected.relation)} · ${Math.round(selected.relation)}</strong></div></div><div class="relation-track"><i style="width:${pct(selected.relation)}%"></i></div><button class="primary-button" data-ui="interact" data-action="talk" data-id="${selected.id}">${icon('talk')}和 ${esc(selected.name)} 打个招呼</button><div class="social-actions"><button data-ui="social" data-action="chat" data-id="${selected.id}" title="聊聊近况 · 关系 +18">${icon('talk')}聊近况</button><button data-ui="social" data-action="compliment" data-id="${selected.id}" title="真诚赞美 · 关系 +12">${icon('smile')}赞美</button><button data-ui="social" data-action="gift" data-id="${selected.id}" title="小小心意 · 个人 ¥25 · 关系 +25" ${this.state.player.money < 25 ? 'disabled' : ''}>${icon('heart')}礼物 <small>¥25</small></button></div><button class="secondary-button" data-ui="social" data-action="invite" data-id="${selected.id}" ${!canInvite ? 'disabled' : ''}>${icon('home')}${this.state.interior?.guestId === selected.id ? 'TA 正在家中做客' : '邀请来家里坐坐'}</button><p class="social-note">${canInvite ? '在屋内可邀请朋友到访。' : '关系达到 35 后，回到自己的屋内即可邀请。'}室外交谈请先走近。</p><button class="secondary-button" data-ui="follow" data-id="${selected.id}">${icon('focus')}看看 TA 的生活</button><p class="inspect-description" style="margin-top:12px">城市视角下，右键点击地面可指挥 TA 沿街道移动。</p>`;
    }
    if (this.cache.get('inspector-content') !== html) { el.innerHTML = html; this.cache.set('inspector-content', html); }
  }

  private renderDrawer() {
    const el = this.root.querySelector<HTMLElement>('#drawer')!;
    el.hidden = !this.drawer;
    el.classList.toggle('drawer-right', this.drawer !== 'manage' && this.drawer !== 'furniture');
    el.classList.toggle('furniture-drawer', this.drawer === 'furniture');
    el.classList.toggle('contacts-drawer', this.drawer === 'contacts');
    el.classList.toggle('career-drawer', this.drawer === 'career');
    el.classList.toggle('journal-drawer', this.drawer === 'journal');
    el.classList.toggle('menu-drawer', this.drawer === 'menu');
    this.root.dataset.drawer = this.drawer || '';
    this.root.querySelector('.event-chip')!.setAttribute('aria-expanded', String(this.drawer === 'journal'));
    this.cache.delete('inspector-content');
    if (!this.drawer) { this.renderInspector(); return; }
    const header = (eyebrow: string, title: string) => `<div class="drawer-header"><div><small>${eyebrow}</small><h2>${title}</h2></div><button class="icon-button" data-ui="close-drawer" aria-label="关闭">${icon('close')}</button></div>`;
    if (this.drawer === 'manage') {
      el.innerHTML = `${header('CITY HALL', '城市管理')}<div class="management-section"><h3>收支与税收</h3><div class="budget-total"><span>每日结余</span><strong id="budget-balance">—</strong></div><div class="budget-lines"><div><span>税收与经营</span><strong id="budget-income">—</strong></div><div><span>城市维护</span><strong id="budget-expenses">—</strong></div></div><div class="tax-control"><label for="tax-slider">居民税率 <strong id="tax-label">${this.state?.tax || 10}%</strong></label><input id="tax-slider" type="range" min="3" max="20" step="1" value="${this.state?.tax || 10}"/><div><span>更宜居</span><span>更多收入</span></div></div></div><div class="management-section"><h3>城市脉搏</h3><div id="city-services"></div></div><div class="management-section"><h3>安全与矫正</h3><div id="city-security"></div><div class="prison-intake-row"><span>接收新收押人员</span><button class="intake-toggle" data-ui="prison-intake" aria-pressed="false"><i></i><span id="prison-intake-label">暂停接收</span></button></div><div class="prison-regimes">${regimes.map(([value,label]) => `<button data-ui="prison-regime" data-regime="${value}" title="${label}">${label}</button>`).join('')}</div><p id="prison-policy-note" class="drawer-note"></p><div class="rehab-stats"><div><small>康复进度</small><strong id="prison-rehab">—</strong></div><div><small>不安程度</small><strong id="prison-unrest">—</strong></div><div><small>累计获释</small><strong id="prison-released">—</strong></div></div><div class="prison-schedule-heading"><span>每日生活安排</span><strong id="prison-phase">—</strong></div><div class="prison-schedule">${prisonSchedule.map(([time,phase]) => `<div data-prison-phase="${phase}"><small>${time}</small><span>${phase}</span><i></i></div>`).join('')}</div><p class="drawer-note">警局负责巡逻与治安，矫正中心提供收押与康复。课程和放风帮助居民重新开始。</p></div>`;
      el.insertAdjacentHTML('beforeend', `<div class="management-section"><h3>城市政策</h3><p class="policy-intro">每日投入，从一个更好的街区开始。</p><div class="policy-list">${(Object.keys(CITY_POLICIES) as CityPolicy[]).map(policy => {const def = CITY_POLICIES[policy]; return `<div class="policy-card"><button data-ui="policy" data-policy="${policy}" aria-pressed="false">${icon(def.icon)}<span>${def.name}</span><strong>¥ ${def.cost}<small>/日</small></strong><i></i></button><p>${def.description.replace(/^每日 ¥\d+，/, '')}</p></div>`;}).join('')}</div></div>`);
      this.refreshManagement();
    } else if (this.drawer === 'furniture') {
      el.innerHTML = `${header('MAKE YOURSELF AT HOME', '慢慢，布置一个家')}<div class="drawer-wallet"><span>个人钱包</span><strong id="furniture-wallet">—</strong></div><p class="furniture-intro">家具会摆在房间的固定位置。走到旁边，按 <kbd>F</kbd> 或点击使用；出售返还一半购置费用。</p><div id="furniture-list" class="furniture-list"></div>`;
      this.refreshFurniture();
    } else if (this.drawer === 'contacts') {
      el.innerHTML = `${header('FAMILIAR FACES', '有来往的日常')}<p class="contacts-intro">打个招呼，慢慢成为朋友。<br/>关系达到 35 后，在自己的家里邀请 TA 来做客。</p><div id="contacts-list" class="contacts-list"></div><p class="drawer-note">点击姓名查看居民与对话选项。室外互动需要走到对方身边。</p>`;
      this.refreshContacts();
    } else if (this.drawer === 'career') {
      el.innerHTML = `${header('GROW INTO YOUR OWN', '职业与技能')}<div id="career-summary"></div><div class="career-section"><h3>选择自己的方向</h3><p class="career-intro">切换方向会保留各职业的经验与工作次数。</p><div id="career-tracks"></div></div><div class="career-section"><h3>在日常中，慢慢成长</h3><div id="career-skills"></div></div><div class="career-school-note">${icon('help')}<p>走到已接通道路的社区学校附近，可花个人 ¥60、精力 8 进修，获得 45 点逻辑经验。城市教育和学习政策还会提高经验收益。</p></div>`;
      this.refreshCareer();
    } else if (this.drawer === 'journal') {
      el.innerHTML = `${header('LIFE HAPPENS HERE', '城市事件')}<div class="journal-overview"><span>每一个选择，都让城市继续生长。</span><small id="journal-summary"></small></div><div id="journal-active"></div><div id="journal-history"></div><p class="journal-footnote">阅读手记时城市时间暂停。需要亲自参与的活动，请先关闭面板，走到事件地点附近。</p>`;
      this.refreshJournal();
    } else if (this.drawer === 'help') {
      el.innerHTML = `${header('A LITTLE GUIDANCE', '在栖湾，慢慢来')}<div class="help-intro">建造一座理想的城市，<br/>也成为城市里生活的一个人。</div><div class="help-group"><h3>营造城市</h3><p><kbd>W A S D</kbd><span>移动城市视角</span></p><p><kbd>滚轮</kbd><span>拉近 / 拉远</span></p><p><kbd>右键拖动 / Q E</kbd><span>旋转视角</span></p><p><kbd>左键</kbd><span>建造 / 选择</span></p><p><kbd>ESC</kbd><span>取消建造 / 关闭面板</span></p></div><div class="help-group"><h3>走进生活</h3><p><kbd>1 / 2 / 3</kbd><span>切换三种视角</span></p><p><kbd>W A S D</kbd><span>行走</span></p><p><kbd>右键拖动 / Q E</kbd><span>环顾四周</span></p><p><kbd>第一人称</kbd><span>点击画面捕获鼠标</span></p><p><kbd>Shift</kbd><span>快走</span></p><p><kbd>F</kbd><span>人物 / 家具 / 家门互动</span></p><p><kbd>H</kbd><span>自家门口进屋 / 室内出门</span></p><p><kbd>R</kbd><span>回到焦点</span></p><p><kbd>空格</kbd><span>暂停 / 继续城市</span></p></div><div class="help-footer">先走近住宅，选择「把这里当作家」，再进入室内。<br/>在「装修住宅」添置家具，照顾五种生活需求。<br/>聊天、赞美和小礼物，让邻居成为朋友。</div>`;
    } else {
      el.innerHTML = `${header('HAVEN CITY', '留住这一刻')}<p class="menu-intro">每一段日常，都值得被记住。</p><div class="menu-actions"><button data-ui="save">${icon('save')}<span>保存城市<small>保存到此设备</small></span>${icon('chevron')}</button><button data-ui="load">${icon('load')}<span>读取存档<small>回到上次保存的栖湾</small></span>${icon('chevron')}</button><button data-ui="help">${icon('help')}<span>操作指南<small>关于建造和生活</small></span>${icon('chevron')}</button></div><section class="update-panel" aria-labelledby="update-heading"><div class="update-heading"><h3 id="update-heading">游戏更新</h3><span>v${esc(this.updater.version)}</span></div><div id="update-state" role="status" aria-live="polite" aria-atomic="true"></div></section>${this.confirming ? '<div class="reset-confirm"><strong>重新开始这座城市？</strong><p>重新开始将替换当前城市，并覆盖本机自动存档。</p><div><button class="secondary-button" data-ui="cancel-reset">继续生活</button><button class="danger-button" data-ui="reset">重新开始</button></div></div>' : `<button class="reset-link" data-ui="confirm-reset">${icon('reset')}重新开始</button>`}<div class="menu-footer"><span>栖湾市</span>城市与生活 · v${esc(this.updater.version)}</div>`;
      this.refreshUpdater();
    }
    if (this.drawer === 'help') el.insertAdjacentHTML('beforeend', `<div class="help-group help-progression"><h3>成长与城市事件</h3><p><kbd>J</kbd><span>打开城市事件手记</span></p><div class="help-footer">从生活底栏打开「职业与技能」，选择职业方向。工作积累经验，阅读、烹饪和社交提升技能；升级会带来更好的收入。<br/>城市中的事件标记可点击查看。学校支持进修，消防站帮助应对火情。</div></div>`);
    this.renderInspector();
  }

  private refreshUpdater() {
    if (this.drawer !== 'menu') return;
    const state = this.updateState;
    const names: Record<UpdateState['status'], string> = {idle:'让栖湾继续生长', checking:'正在检查更新', available:'发现新版本', current:'已是最新版本', downloading:'正在下载更新', downloaded:'更新已准备好', error:'暂时无法更新', unconfigured: this.updater.desktop ? '更新暂不可用' : '发布地址尚未配置'};
    const description = state.message || ({idle:'手动检查 GitHub 上发布的正式版本。', checking:'正在连接 GitHub，请稍候…', available:'新版本已经发布。', current:'当前已是最新版本。', downloading:'下载完成后，由你决定何时重启安装。', downloaded:'安装前，请先保存当前城市。', error:'请检查网络后重试。', unconfigured:'配置公开 GitHub 仓库后即可检查更新。'} as const)[state.status];
    const busy = state.status === 'checking' || state.status === 'downloading';
    let controls = '';
    if (state.status === 'downloaded') {
      controls = `<p class="update-save-note">安装会关闭并重启游戏。请先保存城市。</p><div class="update-actions"><button class="update-secondary" data-ui="save-before-update">${icon('save')}保存城市</button><button class="update-primary" data-ui="install-update" ${this.installingUpdate ? 'disabled' : ''}>${icon('reset')}${this.installingUpdate ? '正在准备安装…' : '重启并安装'}</button></div>`;
    } else if (state.status === 'available') {
      controls = `<div class="update-actions">${this.updater.desktop ? `<button class="update-primary" data-ui="download-update">${icon('load')}下载更新</button>` : state.releaseUrl ? `<a class="update-primary" data-ui="release-link" href="${esc(state.releaseUrl)}" target="_blank" rel="noopener noreferrer">${icon('load')}前往发布页下载</a>` : ''}${this.updater.desktop && state.releaseUrl ? `<a class="update-secondary" data-ui="release-link" href="${esc(state.releaseUrl)}" target="_blank" rel="noopener noreferrer">发布说明${icon('arrow')}</a>` : ''}</div>`;
    } else if (state.status === 'downloading') {
      const progress = Math.round(state.progress || 0);
      controls = `<div class="update-download-label"><span>下载进度</span><strong>${progress}%</strong></div><div class="update-progress" role="progressbar" aria-label="更新下载进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><i style="width:${progress}%"></i></div><p class="update-note">下载后不会自动安装或重启。</p>`;
    } else {
      controls = `<div class="update-actions"><button class="update-secondary" data-ui="check-update" ${busy ? 'disabled aria-busy="true"' : ''}>${icon(state.status === 'checking' ? 'reset' : 'load')}${state.status === 'checking' ? '正在检查…' : state.status === 'error' ? '重新检查' : '检查更新'}</button></div>`;
    }
    this.patchInner('update-state', `<div class="update-status ${state.status}"><i></i><strong>${names[state.status]}</strong>${state.version && ['available','downloaded','downloading'].includes(state.status) ? `<span>v${esc(state.version)}</span>` : ''}</div><p class="update-description">${esc(description)}</p>${controls}${!this.updater.desktop && state.status !== 'unconfigured' ? '<p class="update-note">浏览器版需要手动下载 Windows 安装包。</p>' : ''}`);
  }

  private refreshManagement() {
    if (!this.state || this.drawer !== 'manage') return;
    const s = this.state.stats;
    const set = (id: string, value: string) => { const el = this.root.querySelector(`#${id}`); if (el) el.textContent = value; };
    set('budget-balance', `${s.income - s.expenses >= 0 ? '+' : '−'} ¥ ${number(Math.abs(s.income - s.expenses))}`);
    set('budget-income', `+ ¥ ${number(s.income)}`);
    set('budget-expenses', `− ¥ ${number(s.expenses)}`);
    const service = (name: string, svg: string, value: string, rate: number) => `<div class="service-row">${icon(svg)}<span>${name}</span><strong>${value}</strong><div class="service-track"><i style="width:${pct(rate)}%" class="${rate < 35 ? 'warning' : ''}"></i></div></div>`;
    const services = service('电力', 'bolt', `${number(s.powerNeed)} / ${number(s.power)}`, s.powerNeed ? s.power / s.powerNeed * 100 : 100) + service('供水', 'water', `${number(s.waterNeed)} / ${number(s.water)}`, s.waterNeed ? s.water / s.waterNeed * 100 : 100) + service('就业', 'work', `${number(s.employed)} / ${number(s.population)}`, s.population ? s.employed / s.population * 100 : 100) + service('居住', 'home', `${number(s.population)} / ${number(s.capacity)}`, s.capacity ? (1 - s.population / s.capacity) * 70 + 30 : 0) + service('教育覆盖', 'help', `${Math.round(s.education)}%`, s.education) + service('消防覆盖', 'shield', `${Math.round(s.fireCoverage)}%`, s.fireCoverage);
    const security = `<div class="security-grid"><div><small>城市安全</small><strong>${Math.round(s.safety)}<span>%</span></strong></div><div><small>矫正中心</small><strong>${s.prisoners}<span> / ${s.prisonCapacity}</span></strong></div></div><div class="crime-line">犯罪指数 <strong>${Math.round(s.crime)}%</strong></div>`;
    const serviceEl = this.root.querySelector('#city-services')!;
    const securityEl = this.root.querySelector('#city-security')!;
    if (serviceEl.innerHTML !== services) serviceEl.innerHTML = services;
    if (securityEl.innerHTML !== security) securityEl.innerHTML = security;
    const slider = this.root.querySelector<HTMLInputElement>('#tax-slider');
    if (slider && document.activeElement !== slider) { slider.value = String(this.state.tax); set('tax-label', `${this.state.tax}%`); }
    const prison = this.state.prison;
    set('prison-intake-label', prison.intake ? '接收开启' : '暂停接收');
    const intake = this.root.querySelector<HTMLButtonElement>('[data-ui="prison-intake"]');
    if (intake) { intake.classList.toggle('active', prison.intake); intake.setAttribute('aria-pressed', String(prison.intake)); }
    this.root.querySelectorAll<HTMLButtonElement>('[data-ui="prison-regime"]').forEach(button => {
      const active = button.dataset.regime === prison.regime;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
    const policy = PRISON_RULES[prison.regime];
    set('prison-policy-note', `${policy.description} 设施维护 ×${policy.upkeep}，每人每日照护 ¥${policy.perPerson}。`);
    set('prison-rehab', `${Math.round(prison.rehabilitation)}%`);
    set('prison-unrest', `${Math.round(prison.unrest)}%`);
    set('prison-released', number(prison.released));
    set('prison-phase', prison.phase);
    this.root.querySelectorAll<HTMLElement>('[data-prison-phase]').forEach(phase => phase.classList.toggle('active', phase.dataset.prisonPhase === prison.phase));
    this.root.querySelectorAll<HTMLButtonElement>('[data-ui="policy"]').forEach(button => {
      const active = this.state!.civic.policies[button.dataset.policy as CityPolicy];
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
      button.title = `${active ? '关闭' : '启用'}${CITY_POLICIES[button.dataset.policy as CityPolicy].name}`;
    });
  }

  private experienceMeter(xp: number, level: number) {
    const floor = LEVEL_XP[level - 1];
    const next = LEVEL_XP[level];
    const rate = next === undefined ? 100 : pct((xp - floor) / (next - floor) * 100);
    return `<div class="experience-meta"><span>${next === undefined ? '已达到最高等级' : `下一等级 · ${number(xp)} / ${next} XP`}</span><small>Lv. ${level}</small></div><div class="experience-track"><i style="width:${rate}%"></i></div>`;
  }

  private refreshCareer() {
    if (this.drawer !== 'career' || !this.state) return;
    const p = this.state.progression;
    const track = CAREERS[p.career];
    const progress = p.careers[p.career];
    const level = xpLevel(progress.xp);
    const salary = wageFor(p), remote = wageFor(p, true);
    this.patchInner('career-summary', `<div class="career-current"><span class="career-current-icon">${icon('work')}</span><div><small>${track.name}</small><h3>${track.roles[level - 1]}</h3><span>Lv. ${level} <em>·</em> 完成 ${progress.shifts} 次工作</span></div></div>${this.experienceMeter(progress.xp,level)}<div class="career-wages"><div><small>外出工作</small><strong>¥ ${salary}<span>/次</span></strong></div><div><small>居家办公</small><strong>¥ ${remote}<span>/次</span></strong></div><div><small>累计赚取</small><strong>¥ ${number(p.totalEarned)}</strong></div></div><div class="career-roles">${track.roles.map((role,i) => `<span class="${i + 1 === level ? 'current' : i + 1 < level ? 'achieved' : ''}"><i>${i + 1}</i>${role}</span>`).join('')}</div>`);
    this.patchInner('career-tracks', (Object.keys(CAREERS) as CareerTrack[]).map(key => {
      const def = CAREERS[key], careerProgress = p.careers[key], careerLevel = xpLevel(careerProgress.xp);
      return `<button class="career-track-button ${key === p.career ? 'active' : ''}" data-ui="career" data-track="${key}" data-career="${key}" aria-pressed="${key === p.career}" title="选择${def.name}">${icon(key === 'business' ? 'work' : key === 'culinary' ? 'eat' : 'people')}<span><strong>${def.name}</strong><small>${def.roles[careerLevel - 1]} · ${number(careerProgress.xp)} XP · ${careerProgress.shifts} 次工作</small></span><em>${key === p.career ? '当前' : `Lv. ${careerLevel}`}</em></button>`;
    }).join(''));
    this.patchInner('career-skills', (Object.keys(skillInfo) as SkillKind[]).map(skill => {
      const def = skillInfo[skill], xp = p.skills[skill], skillLevel = xpLevel(xp);
      const currentEffect = skill === 'cooking' ? `当前烹饪：食材 ¥${Math.max(6,12-(skillLevel-1))}，饱腹 +${55+(skillLevel-1)*5}` : skill === 'charisma' ? `对话关系额外 +${(skillLevel-1)*2}` : `商业职业工资额外 +¥${(skillLevel-1)*5}`;
      return `<div class="skill-card"><div class="skill-heading">${icon(def.icon)}<strong>${def.name}</strong><span>Lv. ${skillLevel}</span></div>${this.experienceMeter(xp,skillLevel)}<p>${def.description}<br/>${def.practice}</p><small class="skill-effect">${currentEffect}</small></div>`;
    }).join(''));
  }

  openJournal(eventId?: number) {
    this.journalEventId = eventId;
    this.drawer = 'journal'; this.confirming = false;
    if (eventId && this.state?.civic.events.find(event => event.id === eventId)?.status !== 'pending') this.historyExpanded = true;
    this.renderDrawer(); this.renderMission();
    if (eventId) this.root.querySelector(`#event-card-${eventId}`)?.scrollIntoView({block:'nearest'});
  }

  private eventCondition(event: CityEvent, choice: EventChoice): string | null {
    if (!this.state) return '城市尚未准备好';
    const state = this.state;
    if (event.expiresAt <= state.elapsed) return '活动已过期，继续城市后将归档。';
    if (choice === 'decline') return null;
    const target = state.buildings.find(building => building.id === event.buildingId);
    if (!target?.active) return '关联建筑未接通道路或已拆除。';
    const cityCost: Partial<Record<EventChoice,number>> = {sponsor:1500,repair:1200,dispatch:600,emergency:1500,fund:900};
    const cost = cityCost[choice] || 0;
    if (cost > 0 && state.money < cost) return `市政资金不足，还需 ¥${number(cost - state.money)}。`;
    if (choice === 'dispatch' && !state.buildings.some(building => building.kind === 'firestation' && building.active)) return '需要一座已接通道路的消防站。';
    if (choice === 'study' && state.player.money < 60) return '个人钱包需要至少 ¥60。';
    if (choice === 'volunteer' && state.player.energy < 20) return '需要至少 20 点精力，先休息片刻。';
    if (choice === 'study' && state.player.energy < 8) return '进修需要至少 8 点精力。';
    if (choice === 'study' || choice === 'volunteer') {
      const destination = choice === 'study' ? '社区学校' : '活动公园';
      if (state.interior) return `请先出门，再走到${destination}附近。`;
      if (Math.hypot(state.player.x-cellToWorld(target.gx),state.player.z-cellToWorld(target.gz)) > 18) return `需要走到${destination} 18 米以内。`;
    }
    return null;
  }

  private refreshJournal() {
    if (this.drawer !== 'journal' || !this.state) return;
    const state = this.state;
    const pending = state.civic.events.filter(event => event.status === 'pending').sort((a,b) => Number(b.id === this.journalEventId) - Number(a.id === this.journalEventId) || a.expiresAt-b.expiresAt);
    const history = state.civic.events.filter(event => event.status !== 'pending').sort((a,b) => b.createdAt-a.createdAt).slice(0,8);
    const summary = this.root.querySelector('#journal-summary');
    if (summary) summary.textContent = `${pending.length} 件待处理 · 累计完成 ${state.civic.resolved} 件`;
    this.patchInner('journal-active', pending.map(event => {
      const def = CITY_EVENTS[event.kind];
      const target = state.buildings.find(building => building.id === event.buildingId);
      const remaining = Math.max(0,Math.ceil(event.expiresAt-state.elapsed));
      return `<article id="event-card-${event.id}" class="city-event-card ${event.id === this.journalEventId ? 'focused' : ''}" data-event-kind="${event.kind}"><div class="event-card-heading"><span>${icon(def.icon)}</span><div><small>${remaining} 模拟秒后结束</small><h3>${def.name}</h3></div></div><p class="event-description">${def.description}</p><div class="event-location"><span>${target ? BUILDINGS[target.kind].name : '附近街区'}</span><button data-ui="focus-event" data-id="${event.id}" ${!target ? 'disabled' : ''} title="定位这次事件">${icon('focus')}定位</button></div><div class="event-choices">${def.choices.map(choice => {
        const condition = this.eventCondition(event,choice.id);
        return `<div class="event-choice"><button data-ui="resolve-event" data-id="${event.id}" data-choice="${choice.id}" ${condition ? `disabled aria-describedby="event-reason-${event.id}-${choice.id}"` : ''}>${esc(choice.label)}${icon('arrow')}</button><p>${esc(choice.description)}</p>${condition ? `<small id="event-reason-${event.id}-${choice.id}" class="event-condition">${condition}</small>` : ''}</div>`;
      }).join('')}</div></article>`;
    }).join('') || `<div class="journal-empty">${icon('relax')}<strong>城市，正在平静地生活。</strong><p>新的街区故事发生时，事件入口会提醒你。</p></div>`);
    this.patchInner('journal-history', `<button class="event-history-toggle" data-ui="event-history" aria-expanded="${this.historyExpanded}"><span>已处理与过期记录 <small>${history.length}</small></span>${icon('chevron')}</button>${this.historyExpanded ? `<div class="event-history-list">${history.length ? history.map(event => `<div id="event-card-${event.id}" class="event-history-row"><span>${icon(CITY_EVENTS[event.kind].icon)}</span><div><strong>${CITY_EVENTS[event.kind].name}</strong><small>${event.status === 'expired' ? '错过了这一次' : CITY_EVENTS[event.kind].choices.find(choice => choice.id === event.choice)?.label || '已完成'}</small></div><em>${event.status === 'expired' ? '已过期' : '已处理'}</em></div>`).join('') : '<p class="drawer-empty">这里将记下你的每一个城市选择。</p>'}</div>` : ''}`);
  }

  private patchInner(id: string, html: string) {
    const el = this.root.querySelector<HTMLElement>(`#${id}`);
    if (!el || (this.cache.get(`html-${id}`) === html && el.innerHTML)) return;
    const drawer = this.root.querySelector<HTMLElement>('#drawer')!;
    const scroll = drawer.scrollTop;
    el.innerHTML = html;
    this.cache.set(`html-${id}`, html);
    drawer.scrollTop = scroll;
  }

  private refreshFurniture() {
    if (this.drawer !== 'furniture' || !this.state) return;
    const wallet = this.root.querySelector('#furniture-wallet');
    if (wallet) wallet.textContent = `¥ ${number(this.state.player.money)}`;
    const home = this.state.homes.find(h => h.homeId === this.state?.interior?.homeId);
    if (!home) { this.patchInner('furniture-list', '<p class="drawer-empty">先进入自己的住宅，再布置这个家。</p>'); return; }
    const html = (Object.keys(FURNITURE) as FurnitureKind[]).map(kind => {
      const def = FURNITURE[kind];
      const owned = home.furniture.find(f => f.kind === kind);
      const affordable = this.state!.player.money >= def.cost;
      const cookingLevel = xpLevel(this.state!.progression.skills.cooking);
      const action = kind === 'desk' ? `远程办公 · 收入 ¥${wageFor(this.state!.progression,true)}` : kind === 'kitchen' ? `烹饪 · ¥${Math.max(6,12-(cookingLevel-1))} / 饱腹 +${55+(cookingLevel-1)*5}` : def.action;
      return `<article class="furniture-card ${owned ? 'owned' : ''}"><div class="furniture-icon">${icon(def.icon)}</div><div class="furniture-details"><div class="furniture-title"><strong>${def.name}</strong><small>${owned ? '已摆放' : `¥ ${def.cost}`}</small></div><p>${kind === 'kitchen' ? '用手艺照顾自己，烹饪技能降低食材费。' : def.description}</p><span>${action}</span></div><div class="furniture-actions">${owned ? `<button class="furniture-use" data-ui="interact" data-action="furniture" data-id="${owned.id}" title="请先走到${def.name}旁边">使用 ${icon('arrow')}</button><button class="furniture-sell" data-ui="sell-furniture" data-id="${owned.id}" title="出售返还个人钱包 ¥${Math.floor(def.cost * .5)}">出售 <small>+¥${Math.floor(def.cost * .5)}</small></button>` : `<button class="furniture-buy" data-ui="buy-furniture" data-kind="${kind}" ${!affordable ? 'disabled' : ''} title="${affordable ? `购置${def.name}，个人钱包扣除 ¥${def.cost}` : '个人余额不足，可在书桌或城市里工作赚钱'}">购置 <small>¥${def.cost}</small></button>`}</div></article>`;
    }).join('');
    this.patchInner('furniture-list', html);
  }

  private refreshContacts() {
    if (this.drawer !== 'contacts' || !this.state) return;
    const canInvite = Boolean(this.state.interior && this.state.interior.homeId === this.state.player.homeId);
    const contacts = [...this.state.residents].sort((a,b) => b.relation - a.relation || a.id - b.id).slice(0,12);
    const html = contacts.map(resident => {
      const invited = this.state!.interior?.guestId === resident.id;
      const enabled = canInvite && resident.relation >= 35 && !invited;
      return `<article class="contact-card"><button class="contact-person" data-ui="resident" data-id="${resident.id}" title="查看 ${esc(resident.name)}，选择聊天或送礼"><span class="contact-avatar" style="--resident-color:${esc(resident.color)}">${icon('person')}</span><span><strong>${esc(resident.name)}</strong><small>${relationship(resident.relation)} <em>${Math.round(resident.relation)}</em></small></span>${icon('chevron')}</button><div class="contact-bottom"><span>${esc(resident.activity)}</span><button data-ui="social" data-action="invite" data-id="${resident.id}" ${!enabled ? 'disabled' : ''} title="${invited ? 'TA 已经在家里做客' : !canInvite ? '请先进入自己的住宅' : resident.relation < 35 ? '关系达到 35 后可邀请' : '请朋友来家里坐坐'}">${icon('home')}${invited ? '正在做客' : '邀请到家'}</button></div></article>`;
    }).join('') || '<p class="drawer-empty">城市还在等待第一位邻居。建一些住宅，迎接新朋友吧。</p>';
    this.patchInner('contacts-list', html);
  }

  setContext(text: string, action?: Interaction, targetId?: number) {
    this.contextAction = action; this.contextId = targetId;
    const el = this.root.querySelector<HTMLElement>('#context-prompt')!;
    el.hidden = !text;
    this.root.classList.toggle('has-context', Boolean(text));
    this.text('context-text', text);
    el.querySelector('button')!.hidden = !action;
    el.querySelector('kbd')!.hidden = !action;
  }

  toast(text: string, kind: 'good' | 'info' | 'bad' = 'info') {
    const el = this.root.querySelector<HTMLElement>('#toast')!;
    el.innerHTML = `${icon(kind === 'good' ? 'check' : kind === 'bad' ? 'bolt' : 'relax')}<span>${esc(text)}</span>`;
    el.dataset.kind = kind;
    el.classList.add('visible');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('visible'), 4200);
  }

  isModalOpen() { return this.drawer !== null; }
  isSimulationPaused() { return this.drawer === 'manage' || this.drawer === 'menu' || this.drawer === 'help' || this.drawer === 'career' || this.drawer === 'journal'; }

  private drawMap() {
    if (!this.state) return;
    const ctx = this.minimap.getContext('2d');
    if (!ctx) return;
    const w = this.minimap.width, h = this.minimap.height;
    ctx.clearRect(0, 0, w, h);
    if (this.state.interior) {
      ctx.fillStyle = '#e4dfcb'; ctx.fillRect(0,0,w,h);
      const sx = (w - 24) / 22, sz = (h - 24) / 18;
      ctx.fillStyle = '#f1ead6'; ctx.fillRect(12,12,w-24,h-24);
      ctx.strokeStyle = '#a7af91'; ctx.lineWidth = 3; ctx.strokeRect(12,12,w-24,h-24);
      const home = this.state.homes.find(home => home.homeId === this.state?.interior?.homeId);
      for (const item of home?.furniture || []) {
        const def = FURNITURE[item.kind];
        const rotated = Math.abs(Math.sin(def.rotation)) > .5;
        const fw = (rotated ? def.depth : def.width) * sx;
        const fh = (rotated ? def.width : def.depth) * sz;
        ctx.fillStyle = item.kind === 'plant' ? '#88a478' : item.kind === 'shower' ? '#a9c5bf' : '#bba88a';
        ctx.fillRect(12+(def.x+11)*sx-fw/2,12+(def.z+9)*sz-fh/2,fw,fh);
      }
      const px = 12 + (this.state.player.x+11)*sx, py = 12 + (this.state.player.z+9)*sz;
      ctx.fillStyle = '#fffbec';ctx.beginPath();ctx.arc(px,py,4,0,Math.PI*2);ctx.fill();
      ctx.fillStyle = '#c67c50';ctx.beginPath();ctx.arc(px,py,2.5,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle = '#8a9e76';ctx.lineWidth = 3;ctx.beginPath();ctx.moveTo(w*.42,h-12);ctx.lineTo(w*.58,h-12);ctx.stroke();
      return;
    }
    ctx.fillStyle = '#dce1cf'; ctx.fillRect(0,0,w,h);
    ctx.fillStyle = '#adcbc4'; ctx.beginPath(); ctx.moveTo(w * .82, 0); ctx.bezierCurveTo(w * .65,h * .3,w * 1.05,h * .6,w * .82,h); ctx.lineTo(w,h); ctx.lineTo(w,0); ctx.fill();
    const cell = Math.min(w / (GRID + 3), h / (GRID + 3));
    const ox = (w - GRID * cell) / 2 - 7, oy = (h - GRID * cell) / 2;
    ctx.strokeStyle = '#c9d2bd'; ctx.lineWidth = .35;
    for (let n=0;n<=GRID;n++) { ctx.beginPath(); ctx.moveTo(ox+n*cell,oy); ctx.lineTo(ox+n*cell,oy+GRID*cell); ctx.stroke(); ctx.beginPath(); ctx.moveTo(ox,oy+n*cell); ctx.lineTo(ox+GRID*cell,oy+n*cell); ctx.stroke(); }
    for (const b of this.state.buildings) {
      ctx.fillStyle = b.kind === 'road' ? '#8d9893' : b.kind === 'park' ? '#7d9b66' : ['home','apartment'].includes(b.kind) ? '#c2a88a' : ['shop','office'].includes(b.kind) ? '#b8bba6' : '#93aaa8';
      const inset = b.kind === 'road' ? 0 : .65;
      ctx.fillRect(ox+b.gx*cell+inset,oy+b.gz*cell+inset,cell-inset*2,cell-inset*2);
    }
    for (const resident of this.state.residents.slice(0,60)) {
      ctx.fillStyle = '#5b755f'; ctx.beginPath(); ctx.arc(ox+(resident.x / TILE + GRID/2)*cell, oy+(resident.z / TILE + GRID/2)*cell,.85,0,Math.PI*2); ctx.fill();
    }
    const p = this.state.player;
    const px = ox+(p.x / TILE + GRID/2)*cell, py = oy+(p.z / TILE + GRID/2)*cell;
    ctx.fillStyle = '#fff9e9'; ctx.beginPath(); ctx.arc(px,py,4,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = '#d46f42'; ctx.beginPath(); ctx.arc(px,py,2.4,0,Math.PI*2); ctx.fill();
  }
}
