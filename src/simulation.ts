import { BUILDINGS, CAREERS, CITY_EVENTS, CITY_POLICIES, FURNITURE, PRISON_RULES, GRID, cellToWorld, worldToCell, wageFor, xpLevel } from './types.ts';
import type { ActionResult, Building, BuildingKind, CareerTrack, CityEffect, CityEventKind, CityPolicy, CityStats, EventChoice, FurnitureKind, GameState, HomeInterior, Interaction, Mission, PrisonRegime, Progression, Resident, SkillKind, SocialAction, Speed } from './types.ts';

const SAVE_KEY = 'haven-city-save-v1';
const VERSION = 3;
const STARTER_FURNITURE: FurnitureKind[] = ['bed', 'kitchen', 'sofa', 'shower', 'dining', 'plant'];
const COLORS = ['#d88d61', '#668fa0', '#b68c9b', '#858f68', '#cdb26b', '#8d8db4', '#658b7c', '#c27d72'];
const NAMES = ['林知夏', '陈望舒', '周屿', '许清和', '苏小满', '沈南风', '顾星河', '宋时雨', '叶晨', '陆一帆', '江晚', '温予安', '程嘉树', '夏可', '李思远', '唐晴', '何沐', '徐知行', '方悦', '吴桐', '赵宁', '谢川', '郑岚', '梁初', '白舟', '孟秋', '孙墨', '蔡明', '季然', '秦月', '韩松', '朱禾'];
type Point = { x: number; z: number };
const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const cellKey = (x: number, z: number) => `${x},${z}`;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const isKind = (value: unknown): value is BuildingKind => typeof value === 'string' && Object.hasOwn(BUILDINGS, value);
const isFurnitureKind = (value: unknown): value is FurnitureKind => typeof value === 'string' && Object.hasOwn(FURNITURE, value);
const isRegime = (value: unknown): value is PrisonRegime => typeof value === 'string' && Object.hasOwn(PRISON_RULES, value);
const isLand = (gx: number, gz: number) => Number.isInteger(gx) && Number.isInteger(gz) && gx >= 0 && gx < GRID - 1 && gz >= 1 && gz < GRID - 1;
const worldPoint = (b: Building): Point => ({ x: cellToWorld(b.gx), z: cellToWorld(b.gz) });
const lifeMissions = (): Mission[] => [
  { id: 'settle', title: '城市里的家', description: '认领一处住宅，第一次走进自己的家。', target: 1, progress: 0, reward: 1000, completed: false },
  { id: 'decorate', title: '理想生活空间', description: '在家中选购两件家具，布置自己的生活。', target: 2, progress: 0, reward: 1200, completed: false },
  { id: 'visitor', title: '好友来访', description: '与邻居建立 35 点关系，邀请朋友到自己家做客。', target: 1, progress: 0, reward: 1500, completed: false },
];
const civicMissions = (): Mission[] => [
  { id: 'career', title: '职业新起点', description: '完成工作并成长，让任一职业达到 2 级。', target: 2, progress: 1, reward: 1600, completed: false },
  { id: 'civic', title: '城市回应', description: '处理两起城市事件，为居民作出决定。', target: 2, progress: 0, reward: 1800, completed: false },
  { id: 'services', title: '学有所成，安有所依', description: '建设一所社区学校和一座消防站。', target: 2, progress: 0, reward: 2400, completed: false },
];
const freshProgression = (): Progression => ({ career: 'business', careers: { business: { xp: 0, shifts: 0 }, culinary: { xp: 0, shifts: 0 }, community: { xp: 0, shifts: 0 } }, skills: { cooking: 0, logic: 0, charisma: 0 }, totalEarned: 0 });
const ownKey = (object: object, value: unknown): value is string => typeof value === 'string' && Object.hasOwn(object, value);

/** Serializable city rules. Scene objects, controls and camera state live outside this class. */
export class Simulation {
  state: GameState;
  private routes = new Map<number, Point[]>();
  private routeDestinations = new Map<number, number>();
  private commands = new Map<number, { until: number }>();
  private cooldowns = new Map<string, number>();
  private roadMap = new Map<string, Building>();
  private hourlyClock = 0;
  private arrivals = 0;
  private arrests = 0;
  private releases = 0;
  private patrolBonus = 0;

  constructor(saved?: GameState) {
    this.state = this.seed();
    if (saved && this.validSave(saved)) this.state = this.sanitize(saved);
    this.rebuildRoadMap();
    this.refreshConnections();
    this.updateStats();
    this.assignResidents();
    this.updatePrison(0);
    this.restoreVisit();
  }

  private seed(): GameState {
    const buildings: Building[] = [];
    let id = 1;
    const add = (kind: BuildingKind, gx: number, gz: number) => {
      if (!buildings.some(b => b.gx === gx && b.gz === gz)) buildings.push({ id: id++, kind, gx, gz, level: 1, active: true });
    };
    for (const gx of [5, 11, 17]) for (let gz = 3; gz <= 21; gz++) add('road', gx, gz);
    for (const gz of [6, 12, 18]) for (let gx = 2; gx <= 21; gx++) add('road', gx, gz);
    const sites: [BuildingKind, number, number][] = [
      ['home', 4, 5], ['home', 6, 8], ['home', 10, 8], ['home', 16, 5], ['home', 18, 8], ['home', 12, 13],
      ['apartment', 16, 13], ['shop', 10, 11], ['office', 10, 13], ['park', 12, 11], ['park', 18, 17],
      ['power', 4, 19], ['water', 6, 19], ['clinic', 18, 13], ['police', 16, 19],
      ['home', 4, 8], ['home', 6, 10], ['home', 4, 11], ['home', 6, 14],
      ['home', 10, 16], ['home', 12, 16], ['home', 18, 5], ['home', 20, 11],
      ['apartment', 10, 5], ['apartment', 12, 8], ['apartment', 16, 16],
      ['office', 16, 11], ['office', 18, 11],
      ['shop', 6, 5], ['shop', 4, 14], ['shop', 12, 5], ['shop', 18, 20],
      ['power', 4, 20], ['water', 6, 20], ['clinic', 12, 19],
    ];
    for (const [kind, gx, gz] of sites) add(kind, gx, gz);
    const homes = buildings.filter(b => BUILDINGS[b.kind].category === '居住');
    const residents: Resident[] = [];
    const jobs = buildings.filter(b => BUILDINGS[b.kind].jobs > 0);
    for (let i = 0; i < 32; i++) {
      const home = homes[i % homes.length];
      const road = buildings.filter(b => b.kind === 'road').reduce((a, b) =>
        Math.abs(b.gx - home.gx) + Math.abs(b.gz - home.gz) < Math.abs(a.gx - home.gx) + Math.abs(a.gz - home.gz) ? b : a);
      const x = cellToWorld(road.gx) + (i % 2 ? 3.4 : -3.4);
      const z = cellToWorld(road.gz) + ((i % 5) - 2) * 1.3;
      residents.push({ id: id++, name: NAMES[i], x, z, targetX: x, targetZ: z, homeId: home.id,
        jobId: jobs[i % jobs.length].id, color: COLORS[i % COLORS.length], mood: 78, relation: 0, activity: '街区漫步' });
    }
    const missions: Mission[] = [
      { id: 'residents', title: '安居计划', description: '新增住宅与岗位，吸引 48 位居民在栖湾安家。', target: 48, progress: 32, reward: 2400, completed: false },
      { id: 'parks', title: '城市绿肺', description: '让 3 座邻里公园点缀城市。', target: 3, progress: 2, reward: 1200, completed: false },
      { id: 'friends', title: '认识新邻居', description: '进入生活视角，与 3 位不同的居民交谈。', target: 3, progress: 0, reward: 1500, completed: false },
      { id: 'work', title: '第一份薪水', description: '走到商店或商务中心，完成一次工作。', target: 1, progress: 0, reward: 900, completed: false },
      { id: 'justice', title: '安全与新生', description: '建设矫正中心，与警局协作收押 3 人。可到警局巡逻加快进度。', target: 3, progress: 0, reward: 2800, completed: false },
      ...lifeMissions(),
      ...civicMissions(),
    ];
    const event = { id: id++, kind: 'festival' as const, buildingId: buildings.find(b => b.kind === 'park')!.id, createdAt: 0, expiresAt: 120, status: 'pending' as const, choice: null };
    return { version: VERSION, money: 28000, day: 1, hour: 9, speed: 1, tax: 9,
      buildings, residents, player: { x: -5, z: 5, yaw: Math.PI, hunger: 82, energy: 86, social: 64, joy: 72, hygiene: 88,
        money: 320, name: '新市民', job: '自由职业者', homeId: null },
      stats: this.emptyStats(), missions, notices: [{ id: id++, text: '欢迎来到栖湾！建设城市，或切换生活视角认识你的邻居。', kind: 'info', time: 0 }],
      nextId: id, elapsed: 0, weather: '晴朗', homes: [], interior: null,
      prison: { intake: true, regime: 'balanced', unrest: 8, rehabilitation: 40, released: 0, phase: '劳动' },
      progression: freshProgression(), civic: { policies: { green: false, education: false, community: false }, events: [event], effects: [], nextEventAt: 60, sequence: 0, resolved: 0 } };
  }

  private emptyStats(): CityStats {
    return { population: 0, capacity: 0, jobs: 0, employed: 0, happiness: 0, income: 0, expenses: 0,
      power: 0, powerNeed: 0, water: 0, waterNeed: 0, safety: 0, prisoners: 0, prisonCapacity: 0, crime: 0, landValue: 0, education: 20, fireCoverage: 0 };
  }

  tick(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0 || this.state.speed === 0) return;
    // Large intervals are stepped, so immigration, midnight and needs stay deterministic.
    let remaining = Math.min(dt, 3600) * this.state.speed;
    while (remaining > 0) {
      const step = Math.min(remaining, 1);
      remaining -= step;
      this.state.elapsed += step;
      this.tickCivic();
      const hours = step / 10;
      this.state.hour += hours;
      if (this.state.hour >= 24) {
        this.state.hour -= 24;
        this.state.day++;
        this.state.weather = this.state.day % 4 === 0 ? '薄云' : '晴朗';
      }
      this.patrolBonus = Math.max(0, this.patrolBonus - hours * 1.5);
      this.updateStats();
      this.state.money += (this.state.stats.income - this.state.stats.expenses) * hours / 24;
      const p = this.state.player;
      p.hunger = clamp(p.hunger - hours * 1.35);
      p.energy = clamp(p.energy - hours * .8);
      p.social = clamp(p.social - hours * .6);
      p.hygiene = clamp(p.hygiene - hours * .9);
      p.joy = clamp(p.joy - hours * (.5 + (p.hygiene < 25 ? .8 : 0)));
      this.moveResidents(step);
      this.arrivals += hours;
      if (this.arrivals >= 2) {
        this.arrivals -= 2;
        this.immigrate();
      }
      this.updatePrison(hours);
      this.hourlyClock += hours;
      if (this.hourlyClock >= 1) {
        this.hourlyClock %= 1;
        this.assignResidents();
        if (Math.min(p.hunger, p.energy) < 15 && !this.cooldowns.has('needs-warning')) {
          this.notify('有点疲惫了：去商店吃饭，认领住宅后回家休息。', 'info');
          this.cooldowns.set('needs-warning', this.state.elapsed + 120);
        }
        if ((this.cooldowns.get('needs-warning') ?? Infinity) < this.state.elapsed) this.cooldowns.delete('needs-warning');
      }
      this.updateMissions();
    }
    this.updateStats();
  }

  build(kind: BuildingKind, gx: number, gz: number): ActionResult {
    if (!isKind(kind)) return this.result(false, '未知的建筑类型。');
    if (!isLand(gx, gz)) return this.result(false, '这里是城市边界或海岸，请在可建设的陆地上选择位置。');
    if (this.state.buildings.some(b => b.gx === gx && b.gz === gz)) return this.result(false, '这块土地已有建筑，请先选择空地。');
    const def = BUILDINGS[kind];
    if (this.state.money < def.cost) return this.result(false, `市政资金不足，需要 ¥${def.cost.toLocaleString()}。`);
    if (kind !== 'road' && !this.adjacentRoad(gx, gz)) return this.result(false, '建筑需要紧邻道路。先铺一段路，再来建设。');
    this.state.money -= def.cost;
    const building = { id: this.state.nextId++, kind, gx, gz, level: 1, active: true };
    this.state.buildings.push(building);
    this.rebuildRoadMap();
    this.refreshConnections();
    this.assignResidents();
    this.updateStats();
    this.updateMissions();
    return this.result(true, `${def.name} 已建成${kind === 'road' ? '。' : '，欢迎来到新街区。'}`);
  }

  demolish(gx: number, gz: number): ActionResult {
    const index = this.state.buildings.findIndex(b => b.gx === gx && b.gz === gz);
    if (index < 0) return this.result(false, '这里没有可拆除的建筑。');
    const b = this.state.buildings[index];
    if (this.state.interior?.homeId === b.id) this.exitHome();
    this.state.buildings.splice(index, 1);
    const refund = Math.floor(BUILDINGS[b.kind].cost * .45 * b.level);
    this.state.money += refund;
    if (this.state.player.homeId === b.id) this.state.player.homeId = null;
    this.state.homes = this.state.homes.filter(home => home.homeId !== b.id);
    for (const event of this.state.civic.events) if (event.buildingId === b.id) {
      event.buildingId = null;
      if (event.status === 'pending') { event.status = 'expired'; event.choice = null; }
    }
    this.routes.clear();
    this.routeDestinations.clear();
    this.commands.clear();
    this.rebuildRoadMap();
    this.refreshConnections();
    if (this.state.interior && !this.state.buildings.find(home => home.id === this.state.interior!.homeId)?.active) this.exitHome();
    this.assignResidents();
    this.updateStats();
    return this.result(true, `已拆除${BUILDINGS[b.kind].name}，回收 ¥${refund}。`);
  }

  commandResident(id: number, x: number, z: number): ActionResult {
    const resident = this.state.residents.find(r => r.id === id);
    if (!resident) return this.result(false, '请先选择一位居民，再指定目的地。');
    if (!finite(x) || !finite(z) || !isLand(worldToCell(x), worldToCell(z))) return this.result(false, '目的地超出城市陆地范围，请在街区内选择。');
    const start = this.nearestRoad(resident);
    const end = this.nearestRoad({ x, z });
    if (!start || !end) return this.result(false, '请先建设道路，居民才能步行前往。');
    const route = this.pathBetween(start, end, resident.id);
    if (!route.length) return this.result(false, '道路尚未连通，居民暂时无法到达这片街区。');
    this.routes.set(id, route);
    this.routeDestinations.delete(id);
    this.commands.set(id, { until: this.state.elapsed + 30 });
    this.cooldowns.delete(`resident-${id}`);
    this.cooldowns.delete(`walk-${id}`);
    resident.targetX = route[0].x;
    resident.targetZ = route[0].z;
    resident.activity = '前往指定地点';
    return this.result(true, `${resident.name} 正沿道路前往你指定的街区。`);
  }

  enterHome(id: number | undefined = this.state.player.homeId ?? undefined): ActionResult {
    if (this.state.interior) return this.result(false, '你已经在家中，走到门边即可离开。');
    const home = this.state.buildings.find(b => b.id === id && (b.kind === 'home' || b.kind === 'apartment'));
    if (!home || home.id !== this.state.player.homeId) return this.result(false, '请先在附近认领这处住宅，再进入自己的家。');
    if (!home.active) return this.result(false, '这处住宅尚未接通道路，请先恢复街区通行。');
    if (distance(this.state.player, worldPoint(home)) > 18) return this.result(false, '先走到自己家门前，才能进入室内。');
    this.ensureHome(home.id);
    this.state.interior = { homeId: home.id, returnX: this.state.player.x, returnZ: this.state.player.z, guestId: null };
    this.state.player.x = 0;
    this.state.player.z = 5.6;
    this.state.player.yaw = Math.PI;
    this.progressMission('settle');
    return this.result(true, '欢迎回家。走近家具即可使用，也可以选购书桌和书架。');
  }

  setCareer(track: CareerTrack): ActionResult {
    if (!ownKey(CAREERS, track)) return this.result(false, '未知的职业方向。');
    this.state.progression.career = track;
    this.updateJobTitle();
    return this.result(true, `职业方向已调整为「${CAREERS[track].name}」，已有职业经验会保留。`);
  }

  setPolicy(policy: CityPolicy, enabled: boolean): ActionResult {
    if (!ownKey(CITY_POLICIES, policy) || typeof enabled !== 'boolean') return this.result(false, '未知的城市政策或开关状态。');
    this.state.civic.policies[policy] = enabled;
    this.updateStats();
    return this.result(true, `${CITY_POLICIES[policy].name}已${enabled ? '启用' : '停用'}${enabled ? `，每日投入 ¥${CITY_POLICIES[policy].cost}。` : '。'}`);
  }

  resolveEvent(id: number, choice: EventChoice): ActionResult {
    const event = this.state.civic.events.find(e => e.id === id);
    if (!event || event.status !== 'pending') return this.result(false, '这起事件已经结束或不存在。');
    if (event.expiresAt <= this.state.elapsed) { this.tickCivic(); this.updateStats(); return this.result(false, '这起事件已超过处理时间，请查看最新的城市动态。'); }
    if (!CITY_EVENTS[event.kind].choices.some(c => c.id === choice)) return this.result(false, '这个方案不适用于当前事件。');
    const target = this.state.buildings.find(b => b.id === event.buildingId);
    if (choice !== 'decline' && !target?.active) return this.result(false, '活动设施暂不可用，请先恢复道路连接。');
    const costs: Partial<Record<EventChoice, number>> = { sponsor: 1500, repair: 1200, dispatch: 600, emergency: 1500, fund: 900 };
    const cost = costs[choice] ?? 0;
    if (cost > 0 && this.state.money < cost) return this.result(false, `市政资金不足，这个方案需要 ¥${cost.toLocaleString()}。`);
    if (choice === 'dispatch' && !this.count('firestation')) return this.result(false, '需要一座接通道路的消防站，才能派出消防队。');
    if (choice === 'volunteer') {
      if (this.state.interior || !target || distance(this.state.player, worldPoint(target)) > 18) return this.result(false, '请走到活动公园 18 米内，亲自参与邻里节。');
      if (this.state.player.energy < 20) return this.result(false, '参与活动需要 20 点精力，请先休息。');
      this.state.player.energy -= 20;
      this.state.player.social = clamp(this.state.player.social + 25);
      this.addSkillXP('charisma', 25);
    }
    if (choice === 'study') {
      const studied = this.study(target?.id);
      if (!studied.ok) return studied;
    }
    this.state.money -= cost;
    event.status = 'resolved'; event.choice = choice;
    this.state.civic.resolved++;
    if (choice === 'sponsor' || choice === 'volunteer') this.addEffect('celebration', choice === 'sponsor' ? 240 : 120);
    if (choice === 'ration') this.addEffect('rationing', 120);
    if (choice === 'fund') this.addEffect('learning', 240);
    this.updateStats(); this.updateMissions();
    return this.result(true, `「${CITY_EVENTS[event.kind].name}」已处理：${CITY_EVENTS[event.kind].choices.find(c => c.id === choice)!.label}。`);
  }

  private study(targetId?: number): ActionResult {
    if (this.state.interior) return this.result(false, '请先出门，到社区学校参加进修。');
    if (!this.nearest(['school'], 18, targetId)) return this.result(false, '走到一所已接通道路的社区学校 18 米内，再参加进修。');
    if ((this.cooldowns.get('study') ?? 0) > this.state.elapsed) return this.result(false, '先消化刚学到的知识，稍后再来进修。');
    const p = this.state.player;
    if (p.money < 60 || p.energy < 8) return this.result(false, '进修需要个人钱包 ¥60 与 8 点精力。');
    p.money -= 60; p.energy -= 8;
    this.addSkillXP('logic', 45);
    this.cooldowns.set('study', this.state.elapsed + 6);
    return this.result(true, '完成学校进修，基础逻辑经验 +45，个人钱包 −¥60，精力 −8。');
  }

  private addSkillXP(skill: SkillKind, base: number): void {
    let multiplier = this.count('school') ? 1 + Math.max(0, this.state.stats.education - 20) / 400 : 1;
    if (this.state.civic.policies.education) multiplier *= 1.25;
    if (skill === 'charisma' && this.state.civic.policies.community) multiplier *= 1.25;
    if (this.hasEffect('learning')) multiplier *= 1.25;
    this.state.progression.skills[skill] = Math.min(1e7, this.state.progression.skills[skill] + base * multiplier);
    this.updateMissions();
  }

  private addCareerXP(base: number, shift = false): void {
    const career = this.state.progression.careers[this.state.progression.career];
    const before = xpLevel(career.xp);
    career.xp = Math.min(1e7, career.xp + base);
    if (shift) career.shifts++;
    this.updateJobTitle();
    if (xpLevel(career.xp) > before) this.notify(`职业晋升！你现在是${this.state.player.job}，下一次工作将获得更高报酬。`, 'good');
    this.updateMissions();
  }

  private updateJobTitle(): void {
    const progression = this.state.progression;
    this.state.player.job = CAREERS[progression.career].roles[xpLevel(progression.careers[progression.career].xp) - 1];
  }

  private hasEffect(kind: CityEffect['kind']): boolean { return this.state.civic.effects.some(effect => effect.kind === kind && effect.until > this.state.elapsed); }

  private addEffect(kind: CityEffect['kind'], duration: number): void {
    const previous = this.state.civic.effects.find(effect => effect.kind === kind);
    if (previous) previous.until = Math.max(previous.until, this.state.elapsed + duration);
    else this.state.civic.effects.push({ id: this.state.nextId++, kind, until: this.state.elapsed + duration });
    this.state.civic.effects = this.state.civic.effects.slice(-12);
  }

  private tickCivic(): void {
    const civic = this.state.civic;
    civic.effects = civic.effects.filter(effect => effect.until > this.state.elapsed);
    for (const event of civic.events) if (event.status === 'pending' && event.expiresAt <= this.state.elapsed) {
      event.status = 'expired';
      this.addEffect('disruption', 120);
      this.notify(`「${CITY_EVENTS[event.kind].name}」未及时处理，街区将短暂受到干扰。`, 'info');
    }
    while (civic.nextEventAt <= this.state.elapsed) {
      const kinds: CityEventKind[] = ['outage', 'fire', 'training', 'festival'];
      const kind = kinds[civic.sequence % kinds.length];
      civic.sequence++; civic.nextEventAt += 90;
      if (civic.events.filter(e => e.status === 'pending').length >= 3) continue;
      const candidates = this.state.buildings.filter(b => b.active && (kind === 'outage' ? b.kind === 'power' : kind === 'training' ? b.kind === 'school' : kind === 'festival' ? b.kind === 'park' : ['home', 'apartment', 'shop', 'office', 'clinic'].includes(b.kind)));
      const target = candidates[(civic.sequence - 1) % Math.max(1, candidates.length)];
      if (!target) continue;
      civic.events.push({ id: this.state.nextId++, kind, buildingId: target.id, createdAt: this.state.elapsed, expiresAt: this.state.elapsed + 120, status: 'pending', choice: null });
      while (civic.events.length > 12) {
        const terminal = civic.events.findIndex(e => e.status !== 'pending');
        if (terminal < 0) break;
        civic.events.splice(terminal, 1);
      }
      this.notify(`城市新动态：${CITY_EVENTS[kind].name}，请在城市动态中选择处理方案。`, 'info');
    }
  }

  exitHome(): ActionResult {
    const interior = this.state.interior;
    if (!interior) return this.result(false, '你现在已经在城市街区中。');
    this.state.player.x = interior.returnX;
    this.state.player.z = interior.returnZ;
    const guest = this.state.residents.find(r => r.id === interior.guestId);
    if (guest) guest.activity = '结束拜访，返回街区';
    this.state.interior = null;
    return this.result(true, '走出家门，继续探索栖湾。');
  }

  buyFurniture(kind: FurnitureKind): ActionResult {
    if (!isFurnitureKind(kind)) return this.result(false, '没有找到这件家具。');
    const home = this.currentHome();
    if (!home) return this.result(false, '先进入自己家中，再选购与布置家具。');
    if (home.furniture.some(f => f.kind === kind)) return this.result(false, '家中已经有这件家具了，每种家具可以摆放一件。');
    const def = FURNITURE[kind];
    if (this.state.player.money < def.cost) return this.result(false, `个人钱包不足，${def.name}需要 ¥${def.cost}。`);
    this.state.player.money -= def.cost;
    home.furniture.push({ id: this.state.nextId++, kind });
    this.progressMission('decorate');
    return this.result(true, `${def.name} 已送到家中，个人钱包 −¥${def.cost}。`);
  }

  sellFurniture(id: number): ActionResult {
    const home = this.currentHome();
    if (!home) return this.result(false, '请在自己家中管理家具。');
    const index = home.furniture.findIndex(f => f.id === id);
    if (index < 0) return this.result(false, '这件家具不在当前住宅中。');
    const furniture = home.furniture[index];
    const refund = Math.floor(FURNITURE[furniture.kind].cost * .5);
    home.furniture.splice(index, 1);
    this.state.player.money += refund;
    return this.result(true, `已出售${FURNITURE[furniture.kind].name}，个人钱包 +¥${refund}。`);
  }

  useFurniture(id: number): ActionResult {
    const home = this.currentHome();
    const furniture = home?.furniture.find(f => f.id === id);
    if (!furniture) return this.result(false, '请先走进自己家中，再使用这里的家具。');
    const def = FURNITURE[furniture.kind];
    if (distance(this.state.player, def) > (furniture.kind === 'dining' ? 3 : 4.2)) return this.result(false, `再走近${def.name}一点，就可以使用了。`);
    if ((this.cooldowns.get('furniture') ?? 0) > this.state.elapsed || (this.cooldowns.get(`furniture-${id}`) ?? 0) > this.state.elapsed) return this.result(false, '先享受片刻居家时光，稍后就可以继续。');
    const p = this.state.player;
    let message = '';
    if (furniture.kind === 'desk') {
      if (p.energy < 12 || p.hunger < 8) return this.result(false, '远程工作需要 12 点精力与 8 点饱腹，先照顾好自己。');
      const wage = wageFor(this.state.progression, true);
      p.money += wage; p.energy -= 12; p.hunger -= 8;
      this.state.progression.totalEarned += wage;
      this.addCareerXP(15, true); this.addSkillXP('logic', 12);
      message = `完成居家工作，个人钱包 +¥${wage}，精力 −12，饱腹 −8。`;
    } else if (furniture.kind === 'kitchen') {
      const level = xpLevel(this.state.progression.skills.cooking);
      const cost = Math.max(6, 13 - level);
      const hunger = 55 + 5 * (level - 1);
      if (p.money < cost) return this.result(false, `烹饪需要 ¥${cost} 食材费，可以使用书桌远程工作赚取收入。`);
      p.money -= cost; p.hunger = clamp(p.hunger + hunger); this.addSkillXP('cooking', 15);
      message = `做了一顿家常饭，饱腹 +${hunger}，食材费 ¥${cost}。`;
    } else if (furniture.kind === 'bed') {
      p.energy = clamp(p.energy + 60); message = '睡了一个好觉，精力 +60。';
    } else if (furniture.kind === 'sofa') {
      p.joy = clamp(p.joy + 35); message = '窝在沙发里看电视，愉悦 +35。';
    } else if (furniture.kind === 'shower') {
      p.hygiene = clamp(p.hygiene + 75); message = '洗去一天的疲惫，清洁 +75。';
    } else if (furniture.kind === 'bookshelf') {
      p.joy = clamp(p.joy + 25); this.addSkillXP('logic', 20); message = '读了一本喜欢的书，愉悦 +25，基础逻辑经验 +20。';
    } else if (furniture.kind === 'dining') {
      p.social = clamp(p.social + 12); p.energy = clamp(p.energy + 10); message = '喝一杯热茶，社交 +12，精力 +10。';
    } else {
      p.joy = clamp(p.joy + 12); message = '照料窗边的绿植，愉悦 +12。';
    }
    this.cooldowns.set('furniture', this.state.elapsed + 1.2);
    this.cooldowns.set(`furniture-${id}`, this.state.elapsed + (furniture.kind === 'desk' || furniture.kind === 'bed' ? 8 : 4));
    return this.result(true, message);
  }

  socialize(action: SocialAction, id: number): ActionResult {
    if (!['chat', 'compliment', 'gift', 'invite'].includes(action)) return this.result(false, '暂时无法进行这种交流。');
    const resident = this.state.residents.find(r => r.id === id);
    if (!resident) return this.result(false, '这位居民暂时不在城中。');
    const p = this.state.player;
    if (action === 'invite') {
      if (!this.currentHome()) return this.result(false, '先回到自己的家中，再邀请朋友来做客。');
      if (resident.relation < 35) return this.result(false, '先多聊聊天，关系达到 35 后就能邀请这位朋友。');
      if (this.state.interior!.guestId === id) return this.result(false, '这位朋友已经在家中做客了。');
      if ((this.cooldowns.get('invite') ?? 0) > this.state.elapsed) return this.result(false, '先和眼前的朋友坐一会儿，再发出新的邀请。');
      const previous = this.state.residents.find(r => r.id === this.state.interior!.guestId);
      if (previous) previous.activity = '结束拜访，返回街区';
      this.state.interior!.guestId = id;
      this.routes.delete(id); this.commands.delete(id);
      resident.activity = '在朋友家做客';
      p.joy = clamp(p.joy + 10);
      this.cooldowns.set('invite', this.state.elapsed + 10);
      this.progressMission('visitor');
      return this.result(true, `${resident.name}：谢谢邀请！这个家很温馨，我们坐下来聊聊吧。`);
    }
    const isGuest = this.state.interior?.guestId === id;
    if (this.state.interior ? !isGuest : distance(p, resident) > 12) return this.result(false, '走近这位居民，或邀请他到家中，再开始交流。');
    if ((this.cooldowns.get('social') ?? 0) > this.state.elapsed) return this.result(false, '让朋友说完，稍后继续聊天。');
    if (action === 'gift' && p.money < 25) return this.result(false, '一份小礼物需要个人钱包 ¥25。');
    const gain = (action === 'chat' ? 18 : action === 'compliment' ? 12 : 25) + 2 * (xpLevel(this.state.progression.skills.charisma) - 1);
    if (action === 'gift') p.money -= 25;
    resident.relation = clamp(resident.relation + gain);
    resident.mood = clamp(resident.mood + 6);
    resident.activity = isGuest ? '在家中与朋友聊天' : '与邻居聊天';
    this.routes.delete(id); this.commands.delete(id);
    resident.targetX = resident.x; resident.targetZ = resident.z;
    this.cooldowns.set(`resident-${id}`, this.state.elapsed + 8);
    this.cooldowns.set('social', this.state.elapsed + (action === 'chat' ? 1.2 : 2.2));
    p.social = clamp(p.social + (action === 'chat' ? 32 : 24));
    p.joy = clamp(p.joy + (action === 'gift' ? 10 : 7));
    this.addSkillXP('charisma', 10);
    this.updateMissions();
    const lines = action === 'chat'
      ? ['这里的海风很舒服，真希望多一些公园。', '刚来这座城市吗？欢迎你成为我们的邻居！', '我喜欢步行上班，街区连起来就更方便了。', '有机会一起去公园散步吧。']
      : action === 'compliment' ? ['你这样说让我一整天心情都变好了。', '谢谢你注意到这些小事，认识你真好！']
      : ['这是送给我的？你记得我的喜好，谢谢你！', '好用心的小礼物，下次来我家坐坐吧。'];
    return this.result(true, `${resident.name}：${lines[id % lines.length]}  关系 +${gain}${action === 'gift' ? '，礼物 ¥25' : ''}`);
  }

  setPrisonRegime(regime: PrisonRegime): ActionResult {
    if (!isRegime(regime)) return this.result(false, '未知的矫正管理政策。');
    this.state.prison.regime = regime;
    this.updateStats();
    const names = { balanced: '均衡管理', rehabilitation: '教育与康复', strict: '严格管理' };
    return this.result(true, `矫正政策已调整为「${names[regime]}」。维护费用、收押与释放速度将随之变化。`);
  }

  setPrisonIntake(enabled: boolean): ActionResult {
    if (typeof enabled !== 'boolean') return this.result(false, '收押开关状态无效。');
    this.state.prison.intake = enabled;
    return this.result(true, enabled ? '已开放矫正中心收押。' : '已暂停新增收押，现有人员继续服刑与康复。');
  }

  upgradeBuilding(id: number): ActionResult {
    const building = this.state.buildings.find(b => b.id === id);
    if (!building || building.kind === 'road') return this.result(false, '请选择一栋可升级的城市建筑。');
    if (building.level >= 3) return this.result(false, '这栋建筑已经达到最高等级 3。');
    if (!building.active) return this.result(false, '请先接通道路，再升级这栋建筑。');
    const cost = Math.floor(BUILDINGS[building.kind].cost * .65 * building.level);
    if (this.state.money < cost) return this.result(false, `升级需要市政资金 ¥${cost.toLocaleString()}。`);
    this.state.money -= cost;
    building.level++;
    this.assignResidents();
    this.updateStats();
    this.updateMissions();
    return this.result(true, `${BUILDINGS[building.kind].name} 已升至 ${building.level} 级，容量和岗位得到提升。`);
  }

  private ensureHome(homeId: number): HomeInterior {
    let home = this.state.homes.find(h => h.homeId === homeId);
    if (!home) {
      home = { homeId, furniture: STARTER_FURNITURE.map(kind => ({ id: this.state.nextId++, kind })) };
      this.state.homes.push(home);
    }
    return home;
  }

  private currentHome(): HomeInterior | undefined {
    const visit = this.state.interior;
    if (!visit || visit.homeId !== this.state.player.homeId || !this.state.buildings.some(b => b.id === visit.homeId && b.active)) return undefined;
    return this.state.homes.find(home => home.homeId === visit.homeId);
  }

  private progressMission(id: string): void {
    const mission = this.state.missions.find(m => m.id === id);
    if (mission && !mission.completed) mission.progress = Math.min(mission.target, mission.progress + 1);
    this.updateMissions();
  }

  interact(action: Interaction, targetId?: number): ActionResult {
    const p = this.state.player;
    if (action === 'study') return this.study(targetId);
    if (action === 'enter') return this.enterHome(targetId);
    if (action === 'exit') return this.exitHome();
    if (action === 'furniture' || (action === 'rest' && this.state.interior)) {
      const furniture = this.currentHome()?.furniture.filter(f => action !== 'rest' || f.kind === 'bed')
        .filter(f => targetId === undefined || action === 'rest' || f.id === targetId)
        .sort((a, b) => distance(p, FURNITURE[a.kind]) - distance(p, FURNITURE[b.kind]))[0];
      return furniture ? this.useFurniture(furniture.id) : this.result(false, '走近一件家具，再开始你的居家活动。');
    }
    if (this.state.interior && action !== 'talk') return this.result(false, '你正在家中，请先出门再使用城市里的设施。');
    if ((this.cooldowns.get(action) ?? 0) > this.state.elapsed) return this.result(false, '稍作停留，马上就可以继续。');
    if (action === 'talk') {
      const resident = this.state.interior
        ? this.state.residents.find(r => r.id === (targetId ?? this.state.interior!.guestId))
        : targetId === undefined
        ? this.state.residents.filter(r => distance(p, r) <= 12).sort((a, b) => distance(p, a) - distance(p, b))[0]
        : this.state.residents.find(r => r.id === targetId);
      return resident ? this.socialize('chat', resident.id) : this.result(false, '走近一位居民后，就能和他聊聊天。');
    }
    if (action === 'adopt') {
      const home = this.nearest(['home', 'apartment'], 18, targetId);
      if (!home) return this.result(false, '走到住宅或公寓附近，就能在这座城市安家。');
      p.homeId = home.id;
      this.ensureHome(home.id);
      p.joy = clamp(p.joy + 12);
      return this.result(true, '钥匙交到手中！这里就是你的家，随时可以回来休息。');
    }
    if (action === 'eat') {
      if (!this.nearest(['shop'], 18, targetId)) return this.result(false, '前往街角商店，买一份热饭。');
      if (p.money < 35) return this.result(false, '钱包里至少需要 ¥35。附近的商店或商务中心可以工作赚钱。');
      p.money -= 35;
      p.hunger = clamp(p.hunger + 48);
      p.joy = clamp(p.joy + 5);
      this.cooldowns.set(action, this.state.elapsed + 2);
      return this.result(true, '一份暖心简餐，饱腹 +48，花费 ¥35。');
    }
    if (action === 'rest') {
      const home = this.state.buildings.find(b => b.id === p.homeId);
      if (!home) return this.result(false, '先走到住宅附近选择「在此安家」，再回家休息。');
      if (distance(p, worldPoint(home)) > 18) return this.result(false, '回到你认领的家附近，就能休息。');
      p.energy = clamp(p.energy + 52);
      p.joy = clamp(p.joy + 10);
      p.hunger = clamp(p.hunger - 4);
      this.cooldowns.set(action, this.state.elapsed + 4);
      return this.result(true, '在自己的小家休息了一会儿，精力 +52。');
    }
    if (action === 'work') {
      const work = this.nearest(['office', 'shop'], 18, targetId);
      if (!work) return this.result(false, '走到商务中心或街角商店附近，就可以开始工作。');
      if (p.energy < 16 || p.hunger < 12) return this.result(false, '先吃点东西、休息一下，恢复精力再来工作。');
      const wage = wageFor(this.state.progression);
      p.money += wage;
      this.state.progression.totalEarned += wage;
      this.addCareerXP(20, true);
      this.addSkillXP(CAREERS[this.state.progression.career].skill, 12);
      p.energy = clamp(p.energy - 16);
      p.hunger = clamp(p.hunger - 12);
      p.social = clamp(p.social + 8);
      p.joy = clamp(p.joy - 3);
      const mission = this.state.missions.find(m => m.id === 'work');
      if (mission) mission.progress = Math.min(mission.target, mission.progress + 1);
      this.cooldowns.set(action, this.state.elapsed + 6);
      this.updateMissions();
      return this.result(true, `完成一段工作，个人钱包 +¥${wage}。精力 −16，饱腹 −12。`);
    }
    if (action === 'relax') {
      if (!this.nearest(['park'], 20, targetId)) return this.result(false, '去邻里公园散散步，让自己放松下来。');
      p.joy = clamp(p.joy + 36);
      p.energy = clamp(p.energy + 8);
      p.social = clamp(p.social + 6);
      this.cooldowns.set(action, this.state.elapsed + 3);
      return this.result(true, '树荫与海风让人放松，心情 +36。');
    }
    if (action === 'patrol') {
      if (!this.nearest(['police', 'prison'], 20, targetId)) return this.result(false, '走到社区警局或矫正中心，参与一次社区巡逻。');
      if (this.count('police') === 0) return this.result(false, '先建设一座社区警局，才能组织巡逻与收押。');
      if (p.energy < 12) return this.result(false, '巡逻需要 12 点精力，回家休息后再来。');
      p.energy = clamp(p.energy - 12);
      p.money += 65;
      this.state.progression.totalEarned += 65;
      if (this.state.progression.career === 'community') this.addCareerXP(20, true);
      this.addSkillXP('charisma', 12);
      p.social = clamp(p.social + 8);
      this.patrolBonus = Math.min(15, this.patrolBonus + 5);
      if (this.state.prison.intake && this.state.stats.power >= this.state.stats.powerNeed && this.state.stats.water >= this.state.stats.waterNeed
        && this.state.stats.prisoners < this.state.stats.prisonCapacity) this.state.stats.prisoners++;
      this.cooldowns.set(action, this.state.elapsed + 8);
      this.updateStats();
      this.updateMissions();
      return this.result(true, `社区巡逻完成，个人补贴 +¥65，治安提升。${this.state.stats.prisonCapacity ? '矫正中心持续开展收押与康复。' : '建设矫正中心可完善城市矫正服务。'}`);
    }
    return this.result(false, '暂时无法执行这个行动。');
  }

  setSpeed(speed: Speed): void { if (speed === 0 || speed === 1 || speed === 3) this.state.speed = speed; }

  setTax(tax: number): void {
    if (!Number.isFinite(tax)) return;
    this.state.tax = clamp(Math.round(tax), 3, 20);
    this.updateStats();
  }

  save(quiet = false): ActionResult {
    try {
      if (typeof localStorage === 'undefined') return this.result(false, '当前浏览器暂不支持保存，请使用正常浏览器窗口。');
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.state));
      return quiet ? { ok: true, message: '城市与个人生活已自动保存。' } : this.result(true, '城市与个人生活已保存到本机。');
    } catch { return this.result(false, '保存失败：浏览器存储空间不可用。'); }
  }

  load(): ActionResult {
    try {
      if (typeof localStorage === 'undefined') return this.result(false, '当前浏览器暂不支持读取本地存档。');
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return this.result(false, '还没有存档，先保存一次你正在建设的城市吧。');
      const saved: unknown = JSON.parse(raw);
      if (!this.validSave(saved)) return this.result(false, '存档格式不兼容或内容损坏，当前城市已保留。');
      this.state = this.sanitize(saved);
      this.clearTransient();
      this.rebuildRoadMap();
      this.refreshConnections();
      this.updateStats();
      this.assignResidents();
      this.updatePrison(0);
      this.restoreVisit();
      return this.result(true, '存档已载入，欢迎回到栖湾。');
    } catch { return this.result(false, '读取失败：存档不可用，当前城市已保留。'); }
  }

  reset(): void {
    this.state = this.seed();
    this.clearTransient();
    this.rebuildRoadMap();
    this.updateStats();
    this.assignResidents();
    this.updatePrison(0);
    this.notify('新的栖湾故事开始了。', 'good');
  }

  notify(text: string, kind: 'good' | 'info' | 'bad' = 'info'): void {
    this.state.notices.push({ id: this.state.nextId++, text, kind, time: this.state.elapsed });
    if (this.state.notices.length > 7) this.state.notices.shift();
  }

  private result(ok: boolean, message: string): ActionResult {
    this.notify(message, ok ? 'good' : 'bad');
    return { ok, message };
  }

  private count(kind: BuildingKind): number { return this.state.buildings.filter(b => b.kind === kind && b.active).length; }
  private units(kind: BuildingKind): number { return this.state.buildings.filter(b => b.kind === kind && b.active).reduce((n, b) => n + b.level, 0); }
  private capacity(b: Building): number { return BUILDINGS[b.kind].capacity * b.level; }
  private jobs(b: Building): number { return BUILDINGS[b.kind].jobs * b.level; }

  private adjacentRoad(gx: number, gz: number): boolean {
    return [[gx + 1, gz], [gx - 1, gz], [gx, gz + 1], [gx, gz - 1]].some(([x, z]) => this.roadMap.has(cellKey(x, z)));
  }

  private rebuildRoadMap(): void {
    this.roadMap = new Map(this.state.buildings.filter(b => b.kind === 'road').map(b => [cellKey(b.gx, b.gz), b]));
  }

  private refreshConnections(): void {
    for (const b of this.state.buildings) b.active = b.kind === 'road' || this.adjacentRoad(b.gx, b.gz);
  }

  private nearest(kinds: BuildingKind[], limit: number, targetId?: number): Building | undefined {
    return this.state.buildings.filter(b => b.active && kinds.includes(b.kind) && (targetId === undefined || targetId === b.id))
      .sort((a, b) => distance(this.state.player, worldPoint(a)) - distance(this.state.player, worldPoint(b)))
      .find(b => distance(this.state.player, worldPoint(b)) <= limit);
  }

  private updateStats(): void {
    const active = this.state.buildings.filter(b => b.active);
    const population = this.state.residents.length;
    const capacity = active.reduce((n, b) => n + (b.kind === 'home' || b.kind === 'apartment' ? this.capacity(b) : 0), 0);
    const jobs = active.reduce((n, b) => n + this.jobs(b), 0);
    const civic = this.state.civic;
    const pendingFires = civic.events.filter(e => e.status === 'pending' && e.kind === 'fire').length;
    const power = Math.round(this.units('power') * BUILDINGS.power.capacity * (civic.events.some(e => e.status === 'pending' && e.kind === 'outage') ? .75 : 1));
    const water = this.units('water') * BUILDINGS.water.capacity;
    const structureLoad = active.filter(b => b.kind !== 'road').reduce((n, b) => n + b.level, 0);
    const demand = civic.policies.green ? .9 : 1;
    const powerNeed = Math.round((population * 1.2 + structureLoad * 2 + this.state.stats.prisoners * .6) * demand);
    const waterNeed = Math.round((population + structureLoad + this.state.stats.prisoners * .8) * demand);
    const supplied = Math.min(1, power / Math.max(1, powerNeed), water / Math.max(1, waterNeed));
    const employed = Math.min(population, jobs);
    const prisonCapacity = this.units('prison') * BUILDINGS.prison.capacity;
    const prisoners = clamp(this.state.stats.prisoners, 0, prisonCapacity);
    const policy = PRISON_RULES[this.state.prison.regime];
    const policySafety = prisonCapacity > 0 ? 10 + policy.safety - this.state.prison.unrest * .18 + this.state.prison.rehabilitation * .02 : 0;
    const safety = clamp(55 + this.units('police') * 24 + policySafety + this.patrolBonus - population * .075 + (civic.policies.community ? 4 : 0)
      - pendingFires * 3 - (this.hasEffect('disruption') ? 2 : 0), 5, 100);
    const crime = Math.round(clamp(44 - safety * .35 + Math.max(0, population - jobs) * .5 + Math.max(0, this.state.tax - 12) * 1.2, 2, 80));
    const happiness = Math.round(clamp(53 + Math.min(18, this.units('park') * 6) + Math.min(8, this.units('clinic') * 8)
      + (population ? employed / population * 12 : 8) + safety * .08 - Math.max(0, this.state.tax - 9) * 3
      - (1 - supplied) * 36 - Math.max(0, population - capacity) * 4 + (civic.policies.green ? 3 : 0) + (this.hasEffect('celebration') ? 8 : 0)
      + (this.hasEffect('learning') ? 3 : 0) - (this.hasEffect('rationing') ? 5 : 0) - (this.hasEffect('disruption') ? 4 : 0) - pendingFires * 3, 5, 99));
    const income = Math.round((population * (this.state.tax * 3.5) + employed * 18 + this.units('shop') * 120 + this.units('office') * 180 + prisoners * policy.grant) * (this.hasEffect('rationing') ? .9 : 1));
    const policyCost = (Object.keys(CITY_POLICIES) as CityPolicy[]).reduce((n, key) => n + (civic.policies[key] ? CITY_POLICIES[key].cost : 0), 0);
    const expenses = Math.round(active.reduce((n, b) => n + BUILDINGS[b.kind].upkeep * (1 + .6 * (b.level - 1)) * (b.kind === 'prison' ? policy.upkeep : 1), 0) + prisoners * policy.perPerson + policyCost);
    const education = Math.round(clamp(20 + this.units('school') * BUILDINGS.school.capacity / Math.max(1, population) * 50));
    const fireCoverage = Math.min(100, this.units('firestation') * 35);
    Object.assign(this.state.stats, { population, capacity, jobs, employed, happiness, income, expenses, power, powerNeed,
      water, waterNeed, safety: Math.round(safety), prisoners, prisonCapacity, crime, education, fireCoverage, landValue: Math.round(620 + happiness * 12 + this.count('park') * 80) });
    for (const r of this.state.residents) r.mood = happiness;
  }

  private updatePrison(hours: number): void {
    const prison = this.state.prison;
    const hour = this.state.hour;
    prison.phase = hour >= 6 && hour < 8 ? '早餐' : hour >= 8 && hour < 12 ? '劳动' : hour >= 12 && hour < 16 ? '课程' : hour >= 16 && hour < 19 ? '放风' : '休息';
    const stats = this.state.stats;
    if (!stats.prisonCapacity || !hours) return;
    const rules = PRISON_RULES[prison.regime];
    const occupancy = stats.prisoners / stats.prisonCapacity;
    if (stats.prisoners > 0) {
      prison.rehabilitation = clamp(prison.rehabilitation + hours * (rules.rehabilitation + (prison.phase === '课程' ? .18 : 0)));
      prison.unrest = clamp(prison.unrest + hours * (rules.unrest + occupancy * .5 - prison.rehabilitation * .004));
    } else prison.unrest = clamp(prison.unrest - hours * .6);
    const operational = this.count('police') > 0 && stats.power >= stats.powerNeed && stats.water >= stats.waterNeed;
    if (prison.intake && operational) {
      this.arrests += hours * (.16 + stats.crime / 250) * rules.arrest;
      if (this.arrests >= 1) {
        const added = Math.min(Math.floor(this.arrests), stats.prisonCapacity - stats.prisoners);
        stats.prisoners += added;
        this.arrests %= 1;
        if (added > 0) this.notify(`矫正中心收押 ${added} 人，正在进行职业与社区康复。`, 'info');
      }
    }
    if (stats.prisoners > 0) {
      this.releases += hours / rules.sentence * (.65 + prison.rehabilitation / 100);
      if (this.releases >= 1) {
        const released = Math.min(stats.prisoners, Math.floor(this.releases));
        this.releases %= 1;
        stats.prisoners -= released;
        prison.released += released;
        this.state.money += released * 200;
        this.notify(`${released} 名居民完成矫正重返社区，市政获得补助 ¥${released * 200}。`, 'good');
      }
    } else this.releases = 0;
  }

  private assignResidents(): void {
    const homes = this.state.buildings.filter(b => b.active && (b.kind === 'home' || b.kind === 'apartment'));
    const workplaces = this.state.buildings.filter(b => b.active && BUILDINGS[b.kind].jobs > 0);
    const homeUsed = new Map<number, number>();
    const jobsUsed = new Map<number, number>();
    const homeless: Resident[] = [];
    for (const resident of this.state.residents) {
      const home = homes.find(b => b.id === resident.homeId);
      if (home && (homeUsed.get(home.id) ?? 0) < this.capacity(home)) homeUsed.set(home.id, (homeUsed.get(home.id) ?? 0) + 1);
      else homeless.push(resident);
      const job = workplaces.find(b => b.id === resident.jobId);
      if (job && (jobsUsed.get(job.id) ?? 0) < this.jobs(job)) jobsUsed.set(job.id, (jobsUsed.get(job.id) ?? 0) + 1);
      else resident.jobId = null;
    }
    for (const r of homeless) {
      const home = homes.find(b => (homeUsed.get(b.id) ?? 0) < this.capacity(b));
      r.homeId = home?.id ?? -1;
      if (home) homeUsed.set(home.id, (homeUsed.get(home.id) ?? 0) + 1);
    }
    for (const r of this.state.residents.filter(r => r.jobId === null)) {
      const job = workplaces.find(b => (jobsUsed.get(b.id) ?? 0) < this.jobs(b));
      if (job) { r.jobId = job.id; jobsUsed.set(job.id, (jobsUsed.get(job.id) ?? 0) + 1); }
    }
  }

  private immigrate(): void {
    const stats = this.state.stats;
    if (stats.population >= stats.capacity || stats.happiness < 55 || stats.power < stats.powerNeed || stats.water < stats.waterNeed) return;
    const homes = this.state.buildings.filter(b => b.active && (b.kind === 'home' || b.kind === 'apartment'));
    const home = homes.find(b => this.state.residents.filter(r => r.homeId === b.id).length < this.capacity(b));
    if (!home) return;
    const road = this.nearestRoad(worldPoint(home));
    if (!road) return;
    const id = this.state.nextId++;
    const x = cellToWorld(road.gx) + (id % 2 ? 3.4 : -3.4);
    const z = cellToWorld(road.gz);
    this.state.residents.push({ id, name: NAMES[id % NAMES.length] + (id > 200 ? '·邻居' : ''), x, z, targetX: x, targetZ: z,
      homeId: home.id, jobId: null, color: COLORS[id % COLORS.length], mood: stats.happiness, relation: 0, activity: '搬入新家' });
    this.assignResidents();
    if (this.state.residents.length % 5 === 0) this.notify(`又有新邻居搬来了！城市人口达到 ${this.state.residents.length} 人。`, 'good');
  }

  private nearestRoad(p: Point): Building | undefined {
    let best: Building | undefined;
    let bestD = Infinity;
    for (const road of this.roadMap.values()) {
      const d = distance(p, worldPoint(road));
      if (d < bestD) { bestD = d; best = road; }
    }
    return best;
  }

  private routeFor(resident: Resident): Point[] {
    const start = this.nearestRoad(resident);
    if (!start) return [];
    const places = this.state.buildings.filter(b => b.active && b.kind !== 'road');
    const phase = Math.floor(this.state.elapsed / 24 + resident.id * 1.7) % 5;
    let destination: Building | undefined;
    if (phase === 0 || this.state.hour < 6 || this.state.hour >= 21) {
      destination = places.find(b => b.id === resident.homeId);
      resident.activity = '回家休息';
    } else if (phase <= 2 && this.state.hour >= 8 && this.state.hour < 18) {
      destination = places.find(b => b.id === resident.jobId);
      resident.activity = '步行上班';
    } else {
      const leisure = places.filter(b => b.kind === 'park' || b.kind === 'shop');
      destination = leisure[(resident.id + phase) % Math.max(1, leisure.length)];
      resident.activity = destination?.kind === 'park' ? '去公园散步' : '街角购物';
    }
    const end = destination ? this.nearestRoad(worldPoint(destination)) : Array.from(this.roadMap.values())[(resident.id + phase * 17) % this.roadMap.size];
    if (!end) return [];
    this.routeDestinations.set(resident.id, destination?.id ?? end.id);
    const route = this.pathBetween(start, end, resident.id);
    if (!route.length) resident.activity = '等待道路连接';
    return route;
  }

  private pathBetween(start: Building, end: Building, residentId: number): Point[] {
    const sourceKey = cellKey(start.gx, start.gz);
    const targetKey = cellKey(end.gx, end.gz);
    const previous = new Map<string, string | null>([[sourceKey, null]]);
    const queue = [start];
    for (let i = 0; i < queue.length; i++) {
      const b = queue[i];
      const key = cellKey(b.gx, b.gz);
      if (key === targetKey) break;
      for (const [gx, gz] of [[b.gx + 1, b.gz], [b.gx - 1, b.gz], [b.gx, b.gz + 1], [b.gx, b.gz - 1]]) {
        const nextKey = cellKey(gx, gz);
        const next = this.roadMap.get(nextKey);
        if (next && !previous.has(nextKey)) { previous.set(nextKey, key); queue.push(next); }
      }
    }
    if (!previous.has(targetKey)) return [];
    const cells: Building[] = [];
    let key: string | null = targetKey;
    while (key !== null) {
      const road = this.roadMap.get(key);
      if (road) cells.unshift(road);
      key = previous.get(key) ?? null;
    }
    const side = residentId % 2 ? 3.25 : -3.25;
    const points = cells.map((cell, i) => {
      const next = cells[i + 1] ?? cells[i - 1] ?? cell;
      return { x: cellToWorld(cell.gx) + (next.gz !== cell.gz ? side : 0), z: cellToWorld(cell.gz) + (next.gx !== cell.gx ? side : 0) };
    });
    if (points.length === 1) points.push({ x: points[0].x + (residentId % 3 - 1) * 2, z: points[0].z + (residentId % 2 ? 2 : -2) });
    return points;
  }

  private moveResidents(seconds: number): void {
    for (const resident of this.state.residents) {
      if (this.state.interior?.guestId === resident.id) continue;
      if ((this.cooldowns.get(`resident-${resident.id}`) ?? 0) > this.state.elapsed) continue;
      let route = this.routes.get(resident.id);
      if (!route?.length) {
        const command = this.commands.get(resident.id);
        if (command && command.until > this.state.elapsed) { resident.activity = '在指定地点停留'; continue; }
        this.commands.delete(resident.id);
        if ((this.cooldowns.get(`walk-${resident.id}`) ?? 0) > this.state.elapsed) continue;
        route = this.routeFor(resident);
        this.routes.set(resident.id, route);
      }
      const target = route[0];
      if (!target) continue;
      resident.targetX = target.x;
      resident.targetZ = target.z;
      const d = distance(resident, target);
      const step = Math.min(d, seconds * (1.25 + resident.id % 7 * .08));
      if (d > .001) { resident.x += (target.x - resident.x) / d * step; resident.z += (target.z - resident.z) / d * step; }
      if (d <= step + .01) {
        route.shift();
        if (!route.length) {
          const command = this.commands.get(resident.id);
          if (command) {
            command.until = this.state.elapsed + 30;
            resident.activity = '在指定地点停留';
            continue;
          }
          const destination = this.state.buildings.find(b => b.id === this.routeDestinations.get(resident.id));
          resident.activity = destination?.kind === 'park' ? '在公园放松' : destination?.id === resident.homeId ? '在家附近休息' : destination?.id === resident.jobId ? '工作中' : '欣赏街景';
          this.cooldowns.set(`walk-${resident.id}`, this.state.elapsed + 5 + resident.id % 9);
        }
      }
    }
  }

  private updateMissions(): void {
    for (const mission of this.state.missions) {
      if (mission.completed) continue;
      if (mission.id === 'residents') mission.progress = this.state.residents.length;
      if (mission.id === 'parks') mission.progress = this.count('park');
      if (mission.id === 'friends') mission.progress = this.state.residents.filter(r => r.relation > 0).length;
      if (mission.id === 'justice') mission.progress = this.state.stats.prisoners;
      if (mission.id === 'career') mission.progress = Math.max(...Object.values(this.state.progression.careers).map(c => xpLevel(c.xp)));
      if (mission.id === 'civic') mission.progress = this.state.civic.resolved;
      if (mission.id === 'services') mission.progress = Number(this.count('school') > 0) + Number(this.count('firestation') > 0);
      mission.progress = Math.min(mission.target, mission.progress);
      if (mission.progress >= mission.target) {
        mission.completed = true;
        this.state.money += mission.reward;
        this.notify(`目标达成「${mission.title}」！市政奖励 +¥${mission.reward.toLocaleString()}。`, 'good');
      }
    }
  }

  private clearTransient(): void {
    this.routes.clear(); this.routeDestinations.clear(); this.commands.clear(); this.cooldowns.clear();
    this.hourlyClock = 0; this.arrivals = 0; this.arrests = 0; this.releases = 0; this.patrolBonus = 0;
  }

  private restoreVisit(): void {
    if (!this.state.interior) return;
    if (!this.currentHome()) { this.exitHome(); return; }
    const guest = this.state.residents.find(r => r.id === this.state.interior!.guestId);
    if (guest) guest.activity = '在朋友家做客';
  }

  private validSave(value: unknown): value is GameState {
    if (!value || typeof value !== 'object') return false;
    const s = value as GameState;
    if (![1, 2, VERSION].includes(s.version) || !finite(s.money) || Math.abs(s.money) > 1e12 || !finite(s.day) || s.day < 1 || !finite(s.hour) || s.hour < 0 || s.hour >= 24
      || !finite(s.tax) || s.tax < 3 || s.tax > 20 || ![0, 1, 3].includes(s.speed) || !finite(s.elapsed) || s.elapsed < 0 || s.elapsed > 1e9
      || !Number.isSafeInteger(s.nextId) || s.nextId < 1 || s.nextId > 1e12 || !Array.isArray(s.buildings) || s.buildings.length > 530
      || !Array.isArray(s.residents) || s.residents.length > 1200 || !Array.isArray(s.missions) || s.missions.length > 20
      || !Array.isArray(s.notices) || s.notices.length > 20 || !s.stats || !s.player) return false;
    const occupied = new Set<string>();
    const ids = new Set<number>();
    for (const b of s.buildings) {
      if (!b || !Number.isInteger(b.id) || b.id < 1 || ids.has(b.id) || !isKind(b.kind) || !isLand(b.gx, b.gz)
        || !Number.isInteger(b.level) || b.level < 1 || b.level > 3 || (b.kind === 'road' && b.level !== 1)
        || typeof b.active !== 'boolean' || occupied.has(cellKey(b.gx, b.gz))) return false;
      occupied.add(cellKey(b.gx, b.gz)); ids.add(b.id);
    }
    const validWorld = (x: unknown, z: unknown) => finite(x) && finite(z) && Math.abs(x) <= 150 && Math.abs(z) <= 150;
    const homeIds = new Set(s.buildings.filter(b => b.kind === 'home' || b.kind === 'apartment').map(b => b.id));
    const jobIds = new Set(s.buildings.filter(b => BUILDINGS[b.kind].jobs > 0).map(b => b.id));
    for (const r of s.residents) {
      if (!r || !Number.isInteger(r.id) || r.id < 1 || ids.has(r.id) || typeof r.name !== 'string' || r.name.length > 40
        || !validWorld(r.x, r.z) || !validWorld(r.targetX, r.targetZ) || !finite(r.mood) || r.mood < 0 || r.mood > 100
        || !finite(r.relation) || r.relation < 0 || r.relation > 100 || !Number.isInteger(r.homeId)
        || (r.homeId !== -1 && !homeIds.has(r.homeId)) || (r.jobId !== null && !jobIds.has(r.jobId))
        || typeof r.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(r.color) || typeof r.activity !== 'string' || r.activity.length > 80) return false;
      ids.add(r.id);
    }
    const p = s.player;
    if (!validWorld(p.x, p.z) || !finite(p.yaw) || !finite(p.money) || p.money < 0 || p.money > 1e12 || typeof p.name !== 'string' || p.name.length > 40
      || typeof p.job !== 'string' || p.job.length > 40 || (p.homeId !== null && !homeIds.has(p.homeId))
      || ![p.hunger, p.energy, p.social, p.joy].every(n => finite(n) && n >= 0 && n <= 100)) return false;
    if (!Object.values(s.stats).every(finite) || !finite(s.stats.prisoners) || s.stats.prisoners < 0) return false;
    if (s.version >= 2) {
      if (!finite(p.hygiene) || p.hygiene < 0 || p.hygiene > 100 || !Array.isArray(s.homes) || s.homes.length > homeIds.size) return false;
      const interiors = new Set<number>();
      for (const home of s.homes) {
        if (!home || !homeIds.has(home.homeId) || interiors.has(home.homeId) || !Array.isArray(home.furniture) || home.furniture.length > 8) return false;
        interiors.add(home.homeId);
        const kinds = new Set<FurnitureKind>();
        for (const furniture of home.furniture) {
          if (!furniture || !Number.isInteger(furniture.id) || furniture.id < 1 || ids.has(furniture.id) || !isFurnitureKind(furniture.kind) || kinds.has(furniture.kind)) return false;
          kinds.add(furniture.kind); ids.add(furniture.id);
        }
      }
      if (p.homeId !== null && !interiors.has(p.homeId)) return false;
      if (s.interior !== null) {
        const visit = s.interior;
        if (!visit || visit.homeId !== p.homeId || !interiors.has(visit.homeId) || !validWorld(visit.returnX, visit.returnZ)
          || Math.abs(p.x) > 12 || Math.abs(p.z) > 12
          || (visit.guestId !== null && !s.residents.some(r => r.id === visit.guestId && r.relation >= 35))) return false;
      }
      const prison = s.prison;
      if (!prison || typeof prison.intake !== 'boolean' || !isRegime(prison.regime)
        || ![prison.unrest, prison.rehabilitation].every(n => finite(n) && n >= 0 && n <= 100)
        || !Number.isInteger(prison.released) || prison.released < 0
        || !['早餐', '劳动', '课程', '放风', '休息'].includes(prison.phase) || !Number.isInteger(s.stats.prisoners)) return false;
    }
    if (s.version === VERSION) {
      const progression = s.progression;
      const validXP = (xp: unknown) => finite(xp) && xp >= 0 && xp <= 1e7;
      if (!progression || !ownKey(CAREERS, progression.career) || !progression.careers || !progression.skills
        || !finite(progression.totalEarned) || progression.totalEarned < 0 || progression.totalEarned > 1e12) return false;
      for (const track of Object.keys(CAREERS) as CareerTrack[]) {
        const progress = progression.careers[track];
        if (!progress || !validXP(progress.xp) || !Number.isInteger(progress.shifts) || progress.shifts < 0 || progress.shifts > 1e7) return false;
      }
      if (!(['logic', 'cooking', 'charisma'] as SkillKind[]).every(skill => validXP(progression.skills[skill]))) return false;
      if (!finite(s.stats.education) || s.stats.education < 0 || s.stats.education > 100 || !finite(s.stats.fireCoverage) || s.stats.fireCoverage < 0 || s.stats.fireCoverage > 100) return false;
      const civic = s.civic;
      if (!civic || !civic.policies || !Object.keys(CITY_POLICIES).every(key => typeof civic.policies[key as CityPolicy] === 'boolean')
        || !Array.isArray(civic.events) || civic.events.length > 12 || !Array.isArray(civic.effects) || civic.effects.length > 12
        || !finite(civic.nextEventAt) || civic.nextEventAt <= s.elapsed || civic.nextEventAt > s.elapsed + 90.001
        || !Number.isSafeInteger(civic.sequence) || civic.sequence < 0 || civic.sequence > 1e9
        || civic.sequence > Math.floor(s.elapsed / 90) + 1
        || !Number.isSafeInteger(civic.resolved) || civic.resolved < 0 || civic.resolved > 1e9
        || civic.resolved > civic.sequence + 1
        || civic.events.filter(event => event?.status === 'pending').length > 3) return false;
      for (const event of civic.events) {
        if (!event || !Number.isSafeInteger(event.id) || event.id < 1 || ids.has(event.id) || !ownKey(CITY_EVENTS, event.kind)
          || !finite(event.createdAt) || event.createdAt < 0 || event.createdAt > s.elapsed
          || !finite(event.expiresAt) || event.expiresAt <= event.createdAt || event.expiresAt > event.createdAt + 180
          || !['pending', 'resolved', 'expired'].includes(event.status)
          || (event.status === 'resolved' ? !CITY_EVENTS[event.kind].choices.some(choice => choice.id === event.choice) : event.choice !== null)
          || (event.status === 'pending' && (event.expiresAt <= s.elapsed || event.buildingId === null))) return false;
        if (event.buildingId !== null) {
          const target = s.buildings.find(building => building.id === event.buildingId);
          if (!target || (event.kind === 'outage' ? target.kind !== 'power' : event.kind === 'festival' ? target.kind !== 'park' : event.kind === 'training' ? target.kind !== 'school' : !['home', 'apartment', 'shop', 'office', 'clinic'].includes(target.kind))) return false;
        }
        ids.add(event.id);
      }
      for (const effect of civic.effects) {
        if (!effect || !Number.isSafeInteger(effect.id) || effect.id < 1 || ids.has(effect.id)
          || !['celebration', 'rationing', 'learning', 'disruption'].includes(effect.kind)
          || !finite(effect.until) || effect.until <= s.elapsed || effect.until > s.elapsed + (effect.kind === 'celebration' || effect.kind === 'learning' ? 240.001 : 120.001)) return false;
        ids.add(effect.id);
      }
    }
    const missionIds = new Set<string>();
    for (const m of s.missions) {
      if (!m || typeof m.id !== 'string' || !['residents', 'parks', 'friends', 'work', 'justice', 'settle', 'decorate', 'visitor', 'career', 'civic', 'services'].includes(m.id) || missionIds.has(m.id)
        || typeof m.title !== 'string' || m.title.length > 80 || typeof m.description !== 'string' || m.description.length > 300
        || !finite(m.target) || m.target <= 0 || !finite(m.progress) || m.progress < 0 || !finite(m.reward) || m.reward < 0 || m.reward > 10000 || typeof m.completed !== 'boolean') return false;
      missionIds.add(m.id);
    }
    return !Array.from(ids).some(id => id >= s.nextId);
  }

  private sanitize(saved: GameState): GameState {
    // Copy only the schema's fields: foreign objects and renderer details never enter live state.
    const copy = saved;
    const legacy = copy.version === 1;
    let nextId = copy.nextId;
    const homes = legacy ? [] : copy.homes.map(home => ({ homeId: home.homeId, furniture: home.furniture.map(f => ({ id: f.id, kind: f.kind })) }));
    if (legacy && copy.player.homeId !== null) homes.push({ homeId: copy.player.homeId, furniture: STARTER_FURNITURE.map(kind => ({ id: nextId++, kind })) });
    const missions = copy.missions.map(m => ({ id: m.id, title: m.title, description: m.description,
      target: m.target, progress: m.progress, reward: m.reward, completed: m.completed }));
    for (const mission of [...lifeMissions(), ...civicMissions()]) if (!missions.some(m => m.id === mission.id)) missions.push(mission);
    const progression: Progression = copy.version < 3 ? freshProgression() : {
      career: copy.progression.career,
      careers: { business: { xp: copy.progression.careers.business.xp, shifts: copy.progression.careers.business.shifts },
        culinary: { xp: copy.progression.careers.culinary.xp, shifts: copy.progression.careers.culinary.shifts },
        community: { xp: copy.progression.careers.community.xp, shifts: copy.progression.careers.community.shifts } },
      skills: { logic: copy.progression.skills.logic, cooking: copy.progression.skills.cooking, charisma: copy.progression.skills.charisma }, totalEarned: copy.progression.totalEarned };
    const park = copy.buildings.find(b => b.kind === 'park');
    const civic: GameState['civic'] = copy.version < 3
      ? { policies: { green: false, education: false, community: false }, events: park ? [{ id: nextId++, kind: 'festival', buildingId: park.id, createdAt: copy.elapsed, expiresAt: copy.elapsed + 120, status: 'pending', choice: null }] : [],
        effects: [], nextEventAt: copy.elapsed + 60, sequence: 0, resolved: 0 }
      : { policies: { green: copy.civic.policies.green, education: copy.civic.policies.education, community: copy.civic.policies.community },
        events: copy.civic.events.map(event => ({ id: event.id, kind: event.kind, buildingId: event.buildingId, createdAt: event.createdAt, expiresAt: event.expiresAt, status: event.status, choice: event.choice })),
        effects: copy.civic.effects.map(effect => ({ id: effect.id, kind: effect.kind, until: effect.until })), nextEventAt: copy.civic.nextEventAt, sequence: copy.civic.sequence, resolved: copy.civic.resolved };
    return { version: VERSION, money: copy.money, day: Math.floor(copy.day), hour: copy.hour, speed: copy.speed, tax: copy.tax,
      buildings: copy.buildings.map(b => ({ id: b.id, kind: b.kind, gx: b.gx, gz: b.gz, level: b.level, active: b.active })),
      residents: copy.residents.map(r => ({ id: r.id, name: r.name, x: r.x, z: r.z, targetX: r.x, targetZ: r.z, homeId: r.homeId,
        jobId: r.jobId, color: r.color, mood: r.mood, relation: r.relation, activity: '街区漫步' })),
      player: { x: copy.player.x, z: copy.player.z, yaw: copy.player.yaw, hunger: copy.player.hunger, energy: copy.player.energy,
        social: copy.player.social, joy: copy.player.joy, hygiene: legacy ? 88 : copy.player.hygiene,
        money: copy.player.money, name: copy.player.name, job: copy.player.job, homeId: copy.player.homeId },
      stats: { ...this.emptyStats(), prisoners: Math.floor(copy.stats.prisoners) }, missions,
      notices: [], nextId, elapsed: copy.elapsed, weather: copy.weather === '薄云' ? '薄云' : '晴朗', homes,
      interior: !legacy && copy.interior ? { homeId: copy.interior.homeId, returnX: copy.interior.returnX,
        returnZ: copy.interior.returnZ, guestId: copy.interior.guestId } : null,
      prison: legacy ? { intake: true, regime: 'balanced', unrest: 8, rehabilitation: 40, released: 0, phase: '劳动' }
        : { intake: copy.prison.intake, regime: copy.prison.regime, unrest: copy.prison.unrest,
          rehabilitation: copy.prison.rehabilitation, released: copy.prison.released, phase: copy.prison.phase }, progression, civic };
  }
}
