import { BUILDINGS } from './types.ts';
import type { Building, GameState, PrisonActivity, PrisonFacility, PrisonService, PrisonSite, PrisonSlot, PrisonStaff, SkillKind } from './types.ts';

export const PRISON_FACILITIES: Record<PrisonFacility, { name: string; description: string; cost: number; upkeep: number; maxLevel: number; icon: string }> = {
  classroom: { name: '康复教室', description: '课程期间每级额外康复 +0.12/小时，需要辅导员；解锁亲自授课。', cost: 950, upkeep: 8, maxLevel: 2, icon: 'help' },
  workshop: { name: '职业工坊', description: '每级、每位参与者按四小时劳动每日创收 ¥3，受狱警覆盖影响。', cost: 1250, upkeep: 10, maxLevel: 2, icon: 'work' },
  infirmary: { name: '医疗室', description: '正常运营时每级使不安变化降低 0.12/小时。', cost: 1100, upkeep: 12, maxLevel: 2, icon: 'heart' },
};
export const PRISON_STAFF: Record<PrisonStaff, { name: string; description: string; wage: number; maxCount: number }> = {
  guards: { name: '狱警', description: '每人保障 8 床收押能力；缺员提高不安，停运期间仍支付工资。', wage: 12, maxCount: 8 },
  counselors: { name: '辅导员', description: '每人服务 16 位在押人员，改善课程和教室的康复效果。', wage: 18, maxCount: 8 },
};
export const PRISON_ACTIVITIES: Record<PrisonActivity, { name: string; description: string }> = {
  work: { name: '劳动', description: '使用职业工坊学习劳动技能，为城市创造收入。' },
  education: { name: '课程', description: '基础课程促进康复；辅导员和教室进一步提升效果。' },
  recreation: { name: '放风', description: '正常运营时使不安变化降低 0.18/小时。' },
};
export const PRISON_SLOTS: Record<PrisonSlot, { name: string; start: number; end: number }> = {
  morning: { name: '上午', start: 8, end: 12 },
  afternoon: { name: '下午', start: 12, end: 16 },
  evening: { name: '傍晚', start: 16, end: 19 },
};
export const PRISON_SERVICES: Record<PrisonService, { name: string; description: string; wage: number; energy: number; cooldown: number; facility: PrisonFacility | null; activity: PrisonActivity | null; skill: SkillKind; skillXP: number; rehabilitation: number; unrest: number }> = {
  counsel: { name: '亲自辅导', description: '与在押人员沟通；市政支付个人服务工资。', wage: 85, energy: 18, cooldown: 20, facility: null, activity: null, skill: 'charisma', skillXP: 18, rehabilitation: 2, unrest: -4 },
  teach: { name: '亲自授课', description: '在课程时段使用康复教室授课；市政支付个人服务工资。', wage: 100, energy: 18, cooldown: 20, facility: 'classroom', activity: 'education', skill: 'logic', skillXP: 22, rehabilitation: 4, unrest: -2 },
};

export interface PrisonSiteOperations {
  buildingId: number; gx: number; gz: number; level: number;
  active: boolean; supplied: boolean; operational: boolean; status: string;
  capacity: number; prisoners: number; intakeCapacity: number;
  guards: number; counselors: number; guardCoverage: number; counselorCoverage: number;
  facilities: PrisonSite['facilities']; schedule: PrisonSite['schedule'];
  activity: PrisonActivity | 'meal' | 'rest'; phase: string;
  expenses: number; workIncome: number; effectiveness: number;
  rehabilitationRate: number; unrestRate: number; serviceVisits: number; nextServiceAt: number;
}
export interface PrisonOperations {
  sites: PrisonSiteOperations[]; totalExpenses: number; workIncome: number;
  effectiveness: number; intakeCapacity: number; rehabilitationRate: number; unrestRate: number; phase: string;
}

/** Existing buildings include a basic classroom and two guards; purchased rooms add specialist facilities. */
export const createPrisonSite = (buildingId: number, level = 1): PrisonSite => ({
  buildingId, facilities: { classroom: 0, workshop: 0, infirmary: 0 },
  staff: { guards: Math.min(8, level * 2), counselors: 0 },
  schedule: { morning: 'work', afternoon: 'education', evening: 'recreation' },
  serviceVisits: 0, nextServiceAt: 0,
});

const limit = (value: number) => Math.min(1, Math.max(0, value));
const currentActivity = (site: PrisonSite, hour: number): PrisonSiteOperations['activity'] => {
  for (const [key, slot] of Object.entries(PRISON_SLOTS)) if (hour >= slot.start && hour < slot.end) return site.schedule[key as PrisonSlot];
  return hour >= 6 && hour < 8 ? 'meal' : 'rest';
};
const phaseName = (activity: PrisonSiteOperations['activity']) => activity === 'meal' ? '早餐' : activity === 'rest' ? '休息' : PRISON_ACTIVITIES[activity].name;

/** Pure operating forecast. Extra wages/maintenance are daily, including disconnected sites.
 * Workshop daily income is amortized over the day from the configured labour hours.
 * Rehabilitation/unrest are current per-game-hour changes, weighted by housed prisoners.
 * No prisoner total or simulation state is changed here. */
export function getPrisonOperations(state: GameState): PrisonOperations {
  const buildings = new Map(state.buildings.filter(b => b.kind === 'prison').map(b => [b.id, b]));
  const entries = state.corrections.sites.map(site => ({ site, building: buildings.get(site.buildingId) })).filter((entry): entry is { site: PrisonSite; building: Building } => !!entry.building).sort((a, b) => a.building.id - b.building.id);
  const physicalCapacity = entries.reduce((sum, { building }) => sum + BUILDINGS.prison.capacity * building.level, 0);
  const totalPrisoners = Math.min(physicalCapacity, Math.max(0, Math.floor(state.stats.prisoners)));
  // Deterministic proportional allocation keeps inmates aggregate while avoiding duplicate head counts.
  const allocations = entries.map(({ building }) => physicalCapacity ? Math.floor(totalPrisoners * BUILDINGS.prison.capacity * building.level / physicalCapacity) : 0);
  let remainder = totalPrisoners - allocations.reduce((sum, n) => sum + n, 0);
  for (let i = 0; i < entries.length && remainder > 0; i++) { allocations[i]++; remainder--; }
  const supplied = state.stats.power >= state.stats.powerNeed && state.stats.water >= state.stats.waterNeed;
  const sites = entries.map(({ site, building }, index): PrisonSiteOperations => {
    const capacity = BUILDINGS.prison.capacity * building.level;
    const prisoners = allocations[index];
    const guards = site.staff.guards, counselors = site.staff.counselors;
    const guardCoverage = limit(guards * 8 / capacity);
    const counselorCoverage = limit(counselors * 16 / Math.max(1, prisoners));
    const operational = building.active && supplied && guards > 0;
    const activity = currentActivity(site, state.hour);
    const expenses = guards * PRISON_STAFF.guards.wage + counselors * PRISON_STAFF.counselors.wage
      + (Object.keys(PRISON_FACILITIES) as PrisonFacility[]).reduce((sum, key) => sum + site.facilities[key] * PRISON_FACILITIES[key].upkeep, 0);
    const workHours = (Object.keys(PRISON_SLOTS) as PrisonSlot[]).reduce((sum, key) => sum + (site.schedule[key] === 'work' ? PRISON_SLOTS[key].end - PRISON_SLOTS[key].start : 0), 0);
    const workIncome = operational ? prisoners * 3 * site.facilities.workshop * workHours / 4 * guardCoverage : 0;
    const rehabilitationRate = operational && activity === 'education'
      ? guardCoverage * (.18 + counselorCoverage * (.10 + site.facilities.classroom * .12)) : 0;
    const unrestRate = !building.active ? .30 : !supplied ? .65
      : .8 * (1 - guardCoverage) - (operational ? site.facilities.infirmary * .12 + (activity === 'recreation' ? .18 * guardCoverage : 0) : 0);
    return {
      buildingId: building.id, gx: building.gx, gz: building.gz, level: building.level,
      active: building.active, supplied, operational,
      status: !building.active ? '道路未接通' : !supplied ? '水电不足' : !guards ? '缺少狱警' : guardCoverage < 1 ? '狱警不足' : '正常运营',
      capacity, prisoners, intakeCapacity: operational ? Math.min(capacity, guards * 8) : 0,
      guards, counselors, guardCoverage, counselorCoverage,
      facilities: { ...site.facilities }, schedule: { ...site.schedule }, activity, phase: phaseName(activity),
      expenses, workIncome, effectiveness: operational ? guardCoverage * (.75 + counselorCoverage * .15 + (site.facilities.classroom + site.facilities.workshop + site.facilities.infirmary) / 6 * .10) : 0,
      rehabilitationRate, unrestRate, serviceVisits: site.serviceVisits, nextServiceAt: site.nextServiceAt,
    };
  });
  const weight = totalPrisoners || physicalCapacity || 1;
  const weighted = (getValue: (site: PrisonSiteOperations) => number) => sites.reduce((sum, site) => sum + getValue(site) * (totalPrisoners ? site.prisoners : site.capacity), 0) / weight;
  const dominant = [...sites].sort((a, b) => b.prisoners - a.prisoners || Number(b.active) - Number(a.active) || a.buildingId - b.buildingId)[0];
  const fallback = currentActivity(createPrisonSite(0), state.hour);
  return {
    sites, totalExpenses: sites.reduce((sum, site) => sum + site.expenses, 0),
    workIncome: sites.reduce((sum, site) => sum + site.workIncome, 0),
    effectiveness: weighted(site => site.effectiveness), intakeCapacity: sites.reduce((sum, site) => sum + site.intakeCapacity, 0),
    rehabilitationRate: weighted(site => site.rehabilitationRate), unrestRate: weighted(site => site.unrestRate),
    phase: dominant?.phase ?? phaseName(fallback),
  };
}
