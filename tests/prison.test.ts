import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/simulation.ts';
import { cellToWorld, type GameState, type PrisonFacility, type PrisonStaff } from '../src/types.ts';
import { getPrisonOperations, PRISON_FACILITIES, PRISON_SERVICES, PRISON_STAFF } from '../src/prison.ts';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const center = (prisoners = 8) => {
  const sim = new Simulation();
  assert.equal(sim.build('prison', 18, 19).ok, true);
  const id = sim.state.buildings.find(b => b.kind === 'prison')!.id;
  for (const mission of sim.state.missions) mission.completed = true;
  sim.state.stats.prisoners = prisoners;
  sim.setPrisonIntake(false);
  sim.setPrisonStaff(id, 'guards', 2);
  sim.state.player.x = cellToWorld(18); sim.state.player.z = cellToWorld(19);
  return { sim, id };
};

test('centers own distinct configurations, building upgrades preserve investments and demolition removes their site', () => {
  const { sim, id } = center();
  assert.deepEqual(sim.state.corrections.sites[0].staff, { guards: 2, counselors: 0 });
  assert.equal(sim.state.buildings.filter(b => b.kind !== 'road').length, 36);
  sim.upgradePrisonFacility(id, 'classroom');
  sim.setPrisonStaff(id, 'counselors', 1);
  assert.equal(sim.build('prison', 16, 20).ok, true);
  const other = sim.state.corrections.sites.find(s => s.buildingId !== id)!;
  assert.equal(other.facilities.classroom, 0); assert.equal(other.staff.counselors, 0);
  assert.equal(sim.upgradeBuilding(id).ok, true);
  assert.equal(sim.state.stats.prisonCapacity, 48);
  const summary = getPrisonOperations(sim.state).sites.find(s => s.buildingId === id)!;
  assert.equal(summary.capacity, 32); assert.equal(summary.intakeCapacity, 16);
  assert.equal(summary.facilities.classroom, 1); assert.equal(summary.counselors, 1);
  assert.equal(getPrisonOperations(sim.state).sites.reduce((sum, site) => sum + site.prisoners, 0), 8);
  sim.demolish(18, 19);
  assert.equal(sim.state.corrections.sites.length, 1);
  assert.equal(sim.state.corrections.sites[0].buildingId, other.buildingId);
  assert.equal(sim.upgradePrisonFacility(id, 'classroom').ok, false);
});

test('facility procurement has escalating city costs, bounded levels and no side effects on rejected input', () => {
  const { sim, id } = center();
  const money = sim.state.money, wallet = sim.state.player.money, baseline = sim.state.stats.expenses;
  assert.equal(sim.upgradePrisonFacility(id, 'workshop').ok, true);
  assert.equal(sim.upgradePrisonFacility(id, 'workshop').ok, true);
  assert.equal(sim.state.money, money - PRISON_FACILITIES.workshop.cost * 3);
  assert.equal(sim.state.player.money, wallet);
  assert.equal(sim.state.stats.expenses, baseline + PRISON_FACILITIES.workshop.upkeep * 2);
  const before = sim.exportSave();
  assert.equal(sim.upgradePrisonFacility(id, 'workshop').ok, false);
  assert.equal(sim.upgradePrisonFacility(id, '__proto__' as PrisonFacility).ok, false);
  assert.equal(sim.upgradePrisonFacility(-1, 'classroom').ok, false);
  // Rejections may append notices, but cannot change money, staffing or facilities.
  const snapshot = JSON.parse(before) as GameState;
  assert.deepEqual(sim.state.corrections, snapshot.corrections); assert.equal(sim.state.money, snapshot.money);
  sim.state.money = 0;
  assert.equal(sim.upgradePrisonFacility(id, 'infirmary').ok, false);
  assert.equal(sim.state.corrections.sites[0].facilities.infirmary, 0);
});

test('staff wages enter daily expenses; zero guards stops patrol and automatic intake without deleting inmates', () => {
  const { sim, id } = center(4);
  const baseline = sim.state.stats.expenses;
  sim.setPrisonStaff(id, 'counselors', 2);
  assert.equal(sim.state.stats.expenses, baseline + PRISON_STAFF.counselors.wage * 2);
  const roster = copy(sim.state.corrections.sites[0].staff);
  for (const n of [-1, .5, 9, NaN, Infinity]) assert.equal(sim.setPrisonStaff(id, 'guards', n).ok, false);
  assert.equal(sim.setPrisonStaff(id, 'toString' as PrisonStaff, 1).ok, false);
  assert.deepEqual(sim.state.corrections.sites[0].staff, roster);
  sim.setPrisonStaff(id, 'guards', 0); sim.setPrisonIntake(true);
  assert.equal(sim.state.stats.prisoners, 4);
  assert.equal(getPrisonOperations(sim.state).intakeCapacity, 0);
  assert.equal(sim.interact('patrol').ok, true); assert.equal(sim.state.stats.prisoners, 4);
  sim.tick(25); assert.equal(sim.state.stats.prisoners, 4);
  sim.setPrisonStaff(id, 'guards', 2);
  assert.equal(sim.interact('patrol').ok, true); assert.equal(sim.state.stats.prisoners, 5);
});

test('guard reductions limit new admissions but retain inmates already above staffed capacity', () => {
  const { sim, id } = center(12);
  sim.setPrisonStaff(id, 'guards', 1); sim.setPrisonIntake(true);
  assert.equal(getPrisonOperations(sim.state).intakeCapacity, 8);
  assert.equal(sim.state.stats.prisoners, 12);
  sim.interact('patrol'); sim.tick(5);
  assert.equal(sim.state.stats.prisoners, 12);
});

test('scheduled labour changes real workshop revenue, lessons improve rehabilitation and recreation reduces unrest', () => {
  const { sim, id } = center();
  sim.upgradePrisonFacility(id, 'workshop');
  const income = sim.state.stats.income;
  assert.equal(getPrisonOperations(sim.state).workIncome, 24);
  sim.setPrisonSchedule(id, 'morning', 'education');
  assert.equal(sim.state.stats.income, income - 24);
  sim.upgradePrisonFacility(id, 'classroom'); sim.setPrisonStaff(id, 'counselors', 1);
  sim.state.hour = 9;
  const education = new Simulation(copy(sim.state));
  const recreation = new Simulation(copy(sim.state));
  recreation.setPrisonSchedule(id, 'morning', 'recreation');
  education.tick(1); recreation.tick(1);
  assert.ok(education.state.prison.rehabilitation > recreation.state.prison.rehabilitation);
  assert.ok(recreation.state.prison.unrest < education.state.prison.unrest);
  assert.equal(education.state.prison.phase, '课程'); assert.equal(recreation.state.prison.phase, '放风');
  sim.state.hour = 6.5; sim.tick(.01); assert.equal(sim.state.prison.phase, '早餐');
  sim.state.hour = 22; sim.tick(.01); assert.equal(sim.state.prison.phase, '休息');
});

test('medical rooms lower unrest and teachers are necessary for specialist classroom gains', () => {
  const { sim, id } = center();
  sim.state.hour = 13;
  const baseline = getPrisonOperations(sim.state).rehabilitationRate;
  sim.upgradePrisonFacility(id, 'classroom');
  assert.equal(getPrisonOperations(sim.state).rehabilitationRate, baseline);
  sim.setPrisonStaff(id, 'counselors', 1);
  assert.ok(getPrisonOperations(sim.state).rehabilitationRate > baseline);
  const before = getPrisonOperations(sim.state).unrestRate;
  sim.upgradePrisonFacility(id, 'infirmary');
  assert.ok(getPrisonOperations(sim.state).unrestRate < before);
});

test('facility income and payroll accrue in actual daily budget fractions and pause freezes operations', () => {
  const { sim, id } = center();
  sim.upgradePrisonFacility(id, 'workshop'); sim.setPrisonStaff(id, 'counselors', 1);
  const operations = getPrisonOperations(sim.state);
  assert.equal(operations.workIncome, 24);
  assert.equal(operations.totalExpenses, 2 * 12 + 18 + 10);
  const money = sim.state.money;
  const expected = (sim.state.stats.income - sim.state.stats.expenses) * .1 / 24;
  sim.tick(1);
  assert.ok(Math.abs(sim.state.money - money - expected) < 1e-8);
  sim.setSpeed(0);
  const snapshot = sim.exportSave(); sim.tick(60);
  assert.equal(sim.exportSave(), snapshot);
});

test('road outages keep inmates and wages but stop extra production, learning and personal service', () => {
  const { sim, id } = center();
  sim.upgradePrisonFacility(id, 'workshop'); sim.upgradePrisonFacility(id, 'classroom'); sim.setPrisonStaff(id, 'counselors', 1);
  sim.state.hour = 13;
  const expenses = getPrisonOperations(sim.state).totalExpenses;
  // The center touches both the vertical avenue and horizontal cross street.
  sim.demolish(17, 19); sim.demolish(18, 18);
  const operations = getPrisonOperations(sim.state);
  assert.equal(sim.state.stats.prisoners, 8); assert.equal(sim.state.stats.prisonCapacity, 16);
  assert.equal(operations.sites[0].prisoners, 8); assert.equal(operations.sites[0].active, false);
  assert.equal(operations.intakeCapacity, 0); assert.equal(operations.workIncome, 0);
  assert.equal(operations.rehabilitationRate, 0); assert.equal(operations.totalExpenses, expenses);
  assert.ok(operations.unrestRate > 0); assert.equal(sim.servePrison(id, 'counsel').ok, false);
  sim.build('road', 17, 19);
  assert.equal(getPrisonOperations(sim.state).sites[0].operational, true);
  assert.equal(sim.state.stats.prisoners, 8);
});

test('utility shortage suppresses facility benefits while payroll remains due', () => {
  const { sim, id } = center();
  sim.upgradePrisonFacility(id, 'workshop');
  const payroll = getPrisonOperations(sim.state).totalExpenses;
  for (const water of [...sim.state.buildings.filter(b => b.kind === 'water')]) sim.demolish(water.gx, water.gz);
  const operation = getPrisonOperations(sim.state);
  assert.equal(operation.sites[0].supplied, false); assert.equal(operation.workIncome, 0);
  assert.equal(operation.totalExpenses, payroll); assert.equal(operation.intakeCapacity, 0);
  assert.equal(sim.state.stats.prisoners, 8);
});

test('personal services transfer city wages, consume energy, teach skills and enforce persistent shared cooldown', () => {
  const { sim, id } = center();
  const city = sim.state.money, wallet = sim.state.player.money, energy = sim.state.player.energy;
  const rehabilitation = sim.state.prison.rehabilitation, unrest = sim.state.prison.unrest;
  assert.equal(sim.servePrison(id, 'counsel').ok, true);
  assert.equal(sim.state.money, city - 85); assert.equal(sim.state.player.money, wallet + 85);
  assert.equal(sim.state.player.energy, energy - 18);
  assert.equal(sim.state.prison.rehabilitation, rehabilitation + 2); assert.equal(sim.state.prison.unrest, unrest - 4);
  assert.equal(sim.state.progression.careers.community.xp, 20); assert.equal(sim.state.progression.skills.charisma, 18);
  assert.equal(sim.state.corrections.sites[0].serviceVisits, 1);
  const loaded = new Simulation(copy(sim.state));
  assert.equal(loaded.state.corrections.sites[0].nextServiceAt, 20);
  assert.equal(loaded.servePrison(id, 'counsel').ok, false);
  loaded.setSpeed(0); loaded.tick(25);
  assert.equal(loaded.servePrison(id, 'counsel').ok, false);
  loaded.setSpeed(1); loaded.tick(20);
  assert.equal(loaded.servePrison(id, 'counsel').ok, true);
});

test('teaching requires inmates, room, scheduled class, proximity, energy, city funding and being outdoors', () => {
  const { sim, id } = center();
  assert.equal(sim.servePrison(id, 'teach').ok, false);
  sim.upgradePrisonFacility(id, 'classroom');
  assert.equal(sim.servePrison(id, 'teach').ok, false);
  sim.setPrisonSchedule(id, 'morning', 'education');
  sim.state.player.x += 21; assert.equal(sim.servePrison(id, 'teach').ok, false); sim.state.player.x -= 21;
  sim.state.player.energy = 17; assert.equal(sim.servePrison(id, 'teach').ok, false); sim.state.player.energy = 90;
  const funds = sim.state.money; sim.state.money = 99; assert.equal(sim.servePrison(id, 'teach').ok, false); sim.state.money = funds;
  const home = sim.state.buildings.find(b => b.kind === 'home')!;
  sim.state.interior = { homeId: home.id, returnX: 0, returnZ: 0, guestId: null };
  assert.equal(sim.servePrison(id, 'teach').ok, false); sim.state.interior = null;
  sim.state.transit.journey = { fromId: 1, toId: 2, path: [{ x: 0, z: 0 }, { x: 10, z: 0 }], distance: 10, travelled: 0, fare: 4 };
  assert.equal(sim.servePrison(id, 'teach').ok, false); sim.state.transit.journey = null;
  assert.equal(sim.servePrison(id, 'teach').ok, true);
  assert.equal(sim.state.progression.skills.logic, PRISON_SERVICES.teach.skillXP);
  const empty = center(0); assert.equal(empty.sim.servePrison(empty.id, 'counsel').ok, false);
});

test('schema one through four migrate prison sites and preserve funds, inmates, policy and upgraded bed counts', () => {
  const { sim, id } = center(7);
  sim.upgradeBuilding(id); sim.setPrisonRegime('strict');
  for (const version of [1, 2, 3, 4]) {
    const legacy = copy(sim.state) as GameState & Record<string, unknown>;
    legacy.version = version; delete legacy.corrections;
    if (version < 4) delete legacy.transit;
    if (version < 3) { delete legacy.progression; delete legacy.civic; }
    if (version < 2) { delete legacy.homes; delete legacy.interior; delete legacy.prison; delete legacy.player.hygiene; }
    const loaded = new Simulation(legacy);
    assert.equal(loaded.state.version, 5); assert.equal(loaded.state.money, sim.state.money);
    assert.equal(loaded.state.player.money, sim.state.player.money); assert.equal(loaded.state.stats.prisoners, 7);
    assert.equal(loaded.state.stats.prisonCapacity, 32);
    assert.equal(loaded.state.corrections.sites[0].staff.guards, 4);
    assert.equal(loaded.state.corrections.intakeProgress, 0); assert.equal(loaded.state.corrections.releaseProgress, 0);
    if (version >= 2) assert.equal(loaded.state.prison.regime, 'strict');
  }
});

test('save roundtrip preserves fractional intake, release and detached center data', () => {
  const { sim, id } = center();
  sim.upgradePrisonFacility(id, 'infirmary'); sim.setPrisonStaff(id, 'counselors', 2);
  sim.setPrisonIntake(true); sim.tick(8);
  assert.ok(sim.state.corrections.intakeProgress > 0); assert.ok(sim.state.corrections.releaseProgress > 0);
  const saved = copy(sim.state);
  (saved.corrections.sites[0] as unknown as Record<string, unknown>).foreign = { secret: 123 };
  (saved.corrections.sites[0].staff as unknown as Record<string, unknown>).foreign = { secret: 123 };
  const loaded = new Simulation(saved);
  assert.equal(loaded.state.corrections.intakeProgress, sim.state.corrections.intakeProgress);
  assert.equal(loaded.state.corrections.releaseProgress, sim.state.corrections.releaseProgress);
  assert.equal('foreign' in loaded.state.corrections.sites[0], false);
  assert.equal('foreign' in loaded.state.corrections.sites[0].staff, false);
  saved.corrections.sites[0].facilities.infirmary = 2;
  assert.equal(loaded.state.corrections.sites[0].facilities.infirmary, 1);
  const uninterrupted = new Simulation(copy(sim.state));
  loaded.tick(12); uninterrupted.tick(12);
  assert.equal(loaded.state.stats.prisoners, uninterrupted.state.stats.prisoners);
  assert.equal(loaded.state.prison.released, uninterrupted.state.prison.released);
  assert.equal(loaded.state.corrections.releaseProgress, uninterrupted.state.corrections.releaseProgress);
});

test('corrupt corrections imports reject atomically, including missing/duplicate refs and impossible cooldowns', () => {
  const { sim, id } = center();
  const storage = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } });
  try {
    assert.equal(sim.save(true).ok, true);
    const pristine = copy(sim.state);
    const mutators: ((value: GameState) => void)[] = [
      s => { s.version = 6; },
      s => { s.corrections.sites = []; },
      s => { s.corrections.sites.push(copy(s.corrections.sites[0])); },
      s => { s.corrections.sites[0].buildingId = s.buildings.find(b => b.kind === 'home')!.id; },
      s => { s.corrections.sites[0].facilities.classroom = 3; },
      s => { s.corrections.sites[0].staff.guards = .5; },
      s => { s.corrections.sites[0].schedule.morning = 'invalid' as never; },
      s => { s.corrections.sites[0].serviceVisits = -1; },
      s => { s.corrections.sites[0].nextServiceAt = s.elapsed + 999; },
      s => { s.corrections.intakeProgress = 1; },
      s => { s.corrections.releaseProgress = -1; },
      s => { s.stats.prisoners = 17; },
    ];
    for (const mutate of mutators) {
      const bad = copy(pristine); mutate(bad);
      const oldStorage = storage.get('haven-city-save-v1');
      assert.equal(sim.importSave(JSON.stringify(bad)).ok, false);
      assert.equal(sim.state.money, pristine.money); assert.equal(sim.state.player.money, pristine.player.money);
      assert.deepEqual(sim.state.corrections, pristine.corrections); assert.equal(storage.get('haven-city-save-v1'), oldStorage);
    }
    assert.equal(sim.state.corrections.sites[0].buildingId, id);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete (globalThis as Record<string, unknown>).localStorage;
  }
});
