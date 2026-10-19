import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/simulation.ts';
import { BUILDINGS, CITY_POLICIES, FURNITURE, cellToWorld, wageFor, xpLevel, type CityEventKind, type GameState } from '../src/types.ts';

const at = (sim: Simulation, kind: string) => {
  const b = sim.state.buildings.find(b => b.kind === kind)!;
  sim.state.player.x = cellToWorld(b.gx);
  sim.state.player.z = cellToWorld(b.gz);
  return b;
};

test('seed starts with a funded, connected and inhabited city', () => {
  const sim = new Simulation();
  assert.equal(sim.state.money, 28000);
  assert.equal(sim.state.stats.population, 32);
  assert.equal(sim.state.stats.capacity, 180);
  assert.equal(sim.state.buildings.filter(b => b.kind !== 'road').length, 35);
  assert.equal(sim.state.buildings.filter(b => b.kind === 'apartment' || b.kind === 'office').length, 7);
  assert.ok(sim.state.stats.jobs >= 32);
  assert.ok(sim.state.stats.power >= sim.state.stats.powerNeed);
  assert.ok(sim.state.stats.water >= sim.state.stats.waterNeed);
  assert.ok(sim.state.stats.happiness > 60);
});

test('economy advances across midnight, attracts population, and stops when paused', () => {
  const sim = new Simulation();
  const money = sim.state.money;
  sim.tick(240);
  assert.equal(sim.state.day, 2);
  assert.ok(Math.abs(sim.state.hour - 9) < 1e-6);
  assert.ok(sim.state.money > money);
  assert.ok(sim.state.stats.population > 32);
  sim.setSpeed(0);
  const snapshot = JSON.stringify(sim.state);
  sim.tick(120);
  assert.equal(JSON.stringify(sim.state), snapshot);
});

test('construction validates roads, occupancy, coast and municipal budget', () => {
  const sim = new Simulation();
  const before = sim.state.money;
  assert.equal(sim.build('home', 0, 1).ok, false);
  assert.equal(sim.build('home', 23, 12).ok, false);
  assert.equal(sim.build('home', 5, 6).ok, false);
  assert.equal(sim.state.money, before);
  assert.equal(sim.build('home', 4, 9).ok, true);
  assert.equal(sim.state.money, before - BUILDINGS.home.cost);
  const home = sim.state.buildings.find(b => b.gx === 4 && b.gz === 9)!;
  assert.equal(home.active, true);
  assert.equal(sim.demolish(5, 9).ok, true);
  assert.equal(home.active, false);
  assert.equal(sim.build('road', 5, 9).ok, true);
  assert.equal(home.active, true);
  sim.state.money = 0;
  assert.equal(sim.build('office', 12, 9).ok, false);
});

test('utilities and excessive taxation affect city happiness', () => {
  const sim = new Simulation();
  const initial = sim.state.stats.happiness;
  sim.setTax(20);
  assert.ok(sim.state.stats.happiness < initial);
  sim.setTax(9);
  for (const water of sim.state.buildings.filter(b => b.kind === 'water')) sim.demolish(water.gx, water.gz);
  assert.equal(sim.state.stats.water, 0);
  assert.ok(sim.state.stats.happiness < initial - 20);
  const pop = sim.state.residents.length;
  sim.tick(60);
  assert.equal(sim.state.residents.length, pop);
  assert.equal(sim.build('water', 6, 19).ok, true);
  sim.tick(21);
  assert.ok(sim.state.residents.length > pop);
});

test('life interactions require proximity and separate wallet from treasury', () => {
  const sim = new Simulation();
  sim.state.player.x = 110;
  sim.state.player.z = 110;
  assert.equal(sim.interact('eat').ok, false);
  at(sim, 'shop');
  sim.state.player.hunger = 20;
  const wallet = sim.state.player.money;
  const treasury = sim.state.money;
  assert.equal(sim.interact('eat').ok, true);
  assert.equal(sim.state.player.money, wallet - 35);
  assert.equal(sim.state.player.hunger, 68);
  assert.equal(sim.state.money, treasury);
  at(sim, 'home');
  assert.equal(sim.interact('rest').ok, false);
  assert.equal(sim.interact('adopt').ok, true);
  sim.state.player.energy = 20;
  assert.equal(sim.interact('rest').ok, true);
  assert.equal(sim.state.player.energy, 72);
  at(sim, 'office');
  assert.equal(sim.interact('work').ok, true);
  assert.equal(sim.state.player.money, wallet - 35 + 160);
  assert.equal(sim.state.missions.find(m => m.id === 'work')!.completed, true);
  assert.equal(sim.interact('work').ok, false);
});

test('friendship requires nearby residents and mission rewards are issued once', () => {
  const sim = new Simulation();
  const treasury = sim.state.money;
  for (const r of sim.state.residents.slice(0, 3)) {
    sim.state.player.x = r.x;
    sim.state.player.z = r.z;
    assert.equal(sim.interact('talk', r.id).ok, true);
    assert.equal(r.relation, 18);
    sim.tick(1.3);
  }
  assert.equal(sim.state.missions.find(m => m.id === 'friends')!.completed, true);
  assert.ok(sim.state.money >= treasury + 1500);
  const before = sim.state.money;
  const r = sim.state.residents[0];
  sim.state.player.x = r.x; sim.state.player.z = r.z;
  sim.interact('talk', r.id);
  assert.equal(sim.state.money, before);
});

test('police and prison support patrol, bounded prisoners and justice progression', () => {
  const sim = new Simulation();
  assert.equal(sim.build('prison', 18, 19).ok, true);
  assert.equal(sim.state.stats.prisonCapacity, 16);
  at(sim, 'police');
  const safety = sim.state.stats.safety;
  for (let i = 0; i < 3; i++) {
    assert.equal(sim.interact('patrol').ok, true);
    sim.tick(8.1);
  }
  assert.ok(sim.state.stats.prisoners >= 3);
  assert.ok(sim.state.stats.safety >= safety);
  assert.equal(sim.state.missions.find(m => m.id === 'justice')!.completed, true);
  sim.tick(600);
  assert.ok(sim.state.stats.prisoners <= 16);
  const prison = sim.state.buildings.find(b => b.kind === 'prison')!;
  sim.demolish(prison.gx, prison.gz);
  assert.equal(sim.state.stats.prisoners, 0);
});

test('residents walk continuously and never jump between destinations', () => {
  const sim = new Simulation();
  const old = sim.state.residents.map(r => ({ id: r.id, x: r.x, z: r.z }));
  sim.tick(.5);
  let moving = 0;
  for (const before of old) {
    const r = sim.state.residents.find(r => r.id === before.id)!;
    const d = Math.hypot(r.x - before.x, r.z - before.z);
    assert.ok(d <= 1.1, `resident ${r.id} moved ${d}`);
    if (d > 0) moving++;
  }
  assert.ok(moving > 20);
});

test('god view commands follow connected roads, hold their destination and reject disconnected or invalid orders', () => {
  const sim = new Simulation();
  const resident = sim.state.residents[0];
  const before = { x: resident.x, z: resident.z };
  const goal = { x: cellToWorld(5), z: cellToWorld(9) };
  assert.equal(sim.commandResident(resident.id, goal.x, goal.z).ok, true);
  assert.equal(resident.activity, '前往指定地点');
  assert.deepEqual({ x: resident.x, z: resident.z }, before);
  for (let i = 0; i < 140 && resident.activity !== '在指定地点停留'; i++) {
    const prev = { x: resident.x, z: resident.z };
    sim.tick(.5);
    assert.ok(Math.hypot(resident.x - prev.x, resident.z - prev.z) < 1.1);
  }
  assert.equal(resident.activity, '在指定地点停留');
  assert.ok(Math.hypot(resident.x - goal.x, resident.z - goal.z) < 5);
  const arrived = { x: resident.x, z: resident.z };
  sim.tick(20);
  assert.deepEqual({ x: resident.x, z: resident.z }, arrived);
  assert.equal(sim.commandResident(resident.id, NaN, 0).ok, false);
  assert.equal(sim.commandResident(-1, 0, 0).ok, false);
  assert.equal(sim.commandResident(resident.id, 1000, 0).ok, false);
  sim.build('road', 0, 1);
  assert.equal(sim.commandResident(resident.id, cellToWorld(0), cellToWorld(1)).ok, false);
  assert.deepEqual({ x: resident.x, z: resident.z }, arrived);
});

test('save/load roundtrip restores game state and rejects corrupt snapshots', () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  } });
  const sim = new Simulation();
  sim.build('park', 12, 9);
  sim.state.player.money = 987;
  assert.equal(sim.save().ok, true);
  const buildings = sim.state.buildings.length;
  sim.state.money = 1;
  sim.state.player.money = 1;
  assert.equal(sim.load().ok, true);
  assert.equal(sim.state.player.money, 987);
  assert.equal(sim.state.buildings.length, buildings);
  assert.ok(sim.state.money > 1);
  const good = JSON.stringify(sim.state);
  const bad = JSON.parse(good);
  bad.buildings.push({ ...bad.buildings[0], id: 9999 });
  storage.set('haven-city-save-v1', JSON.stringify(bad));
  const before = sim.state.money;
  assert.equal(sim.load().ok, false);
  assert.equal(sim.state.money, before);
  storage.set('haven-city-save-v1', '{bad json');
  assert.equal(sim.load().ok, false);
  const unknownKind = JSON.parse(good);
  unknownKind.buildings[0].kind = '__proto__';
  storage.set('haven-city-save-v1', JSON.stringify(unknownKind));
  assert.equal(sim.load().ok, false);
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

test('loaded prisoners survive derived-stat recalculation and constructor strips foreign state', () => {
  const original = new Simulation();
  original.build('prison', 18, 19);
  at(original, 'police');
  original.interact('patrol');
  original.tick(8.1);
  original.interact('patrol');
  const saved = structuredClone(original.state);
  const foreign: Record<string, unknown> = { mesh: true };
  foreign.circular = foreign;
  (saved as unknown as Record<string, unknown>).renderer = foreign;
  const restored = new Simulation(saved);
  assert.equal(restored.state.stats.prisoners, 2);
  restored.tick(1);
  assert.equal(restored.state.stats.prisoners, 2);
  assert.equal('renderer' in restored.state, false);
  saved.player.money = -1;
  assert.notEqual(restored.state.player.money, -1);
});

const moveToFurniture = (sim: Simulation, kind: keyof typeof FURNITURE) => {
  const item = sim.state.homes.find(home => home.homeId === sim.state.interior?.homeId)!.furniture.find(f => f.kind === kind)!;
  sim.state.player.x = FURNITURE[kind].x;
  sim.state.player.z = FURNITURE[kind].z;
  return item;
};

const moveIn = (sim: Simulation) => {
  const home = at(sim, 'home');
  assert.equal(sim.interact('adopt', home.id).ok, true);
  assert.equal(sim.enterHome(home.id).ok, true);
  return home;
};

test('home entry checks ownership, road access and proximity and exit restores outdoor position', () => {
  const sim = new Simulation();
  const home = at(sim, 'home');
  assert.equal(sim.enterHome(home.id).ok, false);
  sim.interact('adopt', home.id);
  assert.equal(sim.state.homes[0].furniture.length, 6);
  const starters = sim.state.homes[0].furniture.map(f => f.id);
  sim.interact('adopt', home.id);
  assert.deepEqual(sim.state.homes[0].furniture.map(f => f.id), starters);
  sim.state.player.x = 100; sim.state.player.z = 100;
  assert.equal(sim.enterHome(home.id).ok, false);
  at(sim, 'home');
  sim.state.player.x += 5;
  const outdoor = { x: sim.state.player.x, z: sim.state.player.z };
  assert.equal(sim.interact('enter', home.id).ok, true);
  assert.equal(sim.state.interior!.homeId, home.id);
  assert.deepEqual({ x: sim.state.player.x, z: sim.state.player.z }, { x: 0, z: 5.6 });
  assert.equal(sim.state.player.yaw, Math.PI);
  const wallet = sim.state.player.money;
  assert.equal(sim.interact('work').ok, false);
  assert.equal(sim.interact('eat').ok, false);
  assert.equal(sim.interact('patrol').ok, false);
  assert.equal(sim.state.player.money, wallet);
  assert.equal(sim.interact('rest').ok, false);
  sim.state.player.energy = 10;
  moveToFurniture(sim, 'bed');
  assert.equal(sim.interact('rest').ok, true);
  assert.equal(sim.state.player.energy, 70);
  assert.equal(sim.interact('exit').ok, true);
  assert.deepEqual({ x: sim.state.player.x, z: sim.state.player.z }, outdoor);
  home.active = false;
  assert.equal(sim.enterHome(home.id).ok, false);
});

test('furniture purchases, sales, use distance and work have personal-wallet costs and cooldowns', () => {
  const sim = new Simulation();
  assert.equal(sim.buyFurniture('desk').ok, false);
  moveIn(sim);
  const treasury = sim.state.money;
  const wallet = sim.state.player.money;
  assert.equal(sim.buyFurniture('desk').ok, true);
  assert.equal(sim.state.player.money, wallet - 180);
  assert.equal(sim.state.money, treasury);
  assert.equal(sim.buyFurniture('desk').ok, false);
  const desk = sim.state.homes[0].furniture.find(f => f.kind === 'desk')!;
  assert.equal(sim.useFurniture(desk.id).ok, false);
  moveToFurniture(sim, 'desk');
  const energy = sim.state.player.energy;
  const hunger = sim.state.player.hunger;
  assert.equal(sim.interact('furniture', desk.id).ok, true);
  assert.equal(sim.state.player.money, wallet - 180 + 90);
  assert.equal(sim.state.player.energy, energy - 12);
  assert.equal(sim.state.player.hunger, hunger - 8);
  assert.equal(sim.useFurniture(desk.id).ok, false);
  assert.equal(sim.sellFurniture(desk.id).ok, true);
  assert.equal(sim.state.player.money, wallet);
  assert.equal(sim.sellFurniture(desk.id).ok, false);
  sim.tick(2);
  const kitchen = moveToFurniture(sim, 'kitchen');
  sim.state.player.hunger = 10;
  const before = sim.state.player.money;
  assert.equal(sim.useFurniture(kitchen.id).ok, true);
  assert.equal(sim.state.player.hunger, 65);
  assert.equal(sim.state.player.money, before - 12);
  sim.tick(5);
  const dining = moveToFurniture(sim, 'dining');
  sim.state.player.x += 3.1;
  assert.equal(sim.useFurniture(dining.id).ok, false);
  sim.state.player.x -= .2;
  assert.equal(sim.useFurniture(dining.id).ok, true);
});

test('hygiene declines over time, affects joy and shower restores it', () => {
  const clean = new Simulation();
  const dirty = new Simulation();
  dirty.state.player.hygiene = 0;
  clean.tick(10); dirty.tick(10);
  assert.ok(clean.state.player.hygiene < 88);
  assert.ok(dirty.state.player.joy < clean.state.player.joy);
  moveIn(dirty);
  const shower = moveToFurniture(dirty, 'shower');
  assert.equal(dirty.useFurniture(shower.id).ok, true);
  assert.equal(dirty.state.player.hygiene, 75);
});

test('social actions differ, gifts cost money and invitations require friendship and an owned interior', () => {
  const sim = new Simulation();
  const resident = sim.state.residents[0];
  assert.equal(sim.socialize('invite', resident.id).ok, false);
  sim.state.player.x = resident.x; sim.state.player.z = resident.z;
  const wallet = sim.state.player.money;
  assert.equal(sim.socialize('compliment', resident.id).ok, true);
  assert.equal(resident.relation, 12);
  assert.equal(sim.socialize('gift', resident.id).ok, false);
  sim.tick(2.3);
  assert.equal(sim.socialize('gift', resident.id).ok, true);
  assert.equal(resident.relation, 37);
  assert.equal(sim.state.player.money, wallet - 25);
  moveIn(sim);
  const stranger = sim.state.residents[1];
  assert.equal(sim.socialize('invite', stranger.id).ok, false);
  assert.equal(sim.socialize('invite', resident.id).ok, true);
  assert.equal(sim.state.interior!.guestId, resident.id);
  assert.equal(sim.state.missions.find(m => m.id === 'visitor')!.completed, true);
  const outdoors = { x: resident.x, z: resident.z };
  sim.tick(3);
  assert.deepEqual({ x: resident.x, z: resident.z }, outdoors);
  assert.equal(sim.socialize('chat', stranger.id).ok, false);
  assert.equal(sim.interact('talk', resident.id).ok, true);
  assert.equal(resident.relation, 55);
  sim.exitHome();
  assert.equal(sim.state.interior, null);
});

test('prison policies change budget, safety, intake, rehabilitation and releases', () => {
  const base = new Simulation();
  base.build('prison', 18, 19);
  base.state.stats.prisoners = 8;
  base.setPrisonIntake(false);
  const strict = new Simulation(structuredClone(base.state));
  const rehab = new Simulation(structuredClone(base.state));
  strict.setPrisonRegime('strict');
  rehab.setPrisonRegime('rehabilitation');
  assert.ok(strict.state.stats.safety > rehab.state.stats.safety);
  assert.ok(rehab.state.stats.expenses > strict.state.stats.expenses);
  strict.tick(240); rehab.tick(240);
  assert.ok(rehab.state.prison.rehabilitation > strict.state.prison.rehabilitation);
  assert.ok(strict.state.prison.unrest > rehab.state.prison.unrest);
  assert.ok(rehab.state.prison.released > strict.state.prison.released);
  assert.equal(rehab.state.stats.prisoners, 8 - rehab.state.prison.released);
  assert.equal(strict.state.stats.prisoners, 8 - strict.state.prison.released);
  const closed = new Simulation();
  closed.build('prison', 18, 19);
  closed.setPrisonIntake(false);
  at(closed, 'police');
  closed.interact('patrol');
  closed.tick(100);
  assert.equal(closed.state.stats.prisoners, 0);
  closed.setPrisonIntake(true);
  closed.tick(100);
  assert.ok(closed.state.stats.prisoners > 0);
  closed.state.hour = 6.5; closed.tick(.1); assert.equal(closed.state.prison.phase, '早餐');
  closed.state.hour = 13; closed.tick(.1); assert.equal(closed.state.prison.phase, '课程');
  closed.state.hour = 17; closed.tick(.1); assert.equal(closed.state.prison.phase, '放风');
  closed.state.hour = 22; closed.tick(.1); assert.equal(closed.state.prison.phase, '休息');
});

test('upgrades cost municipal funds, scale capacity, jobs, utilities and upkeep and stop at level three', () => {
  const sim = new Simulation();
  const home = sim.state.buildings.find(b => b.kind === 'home')!;
  const money = sim.state.money;
  const capacity = sim.state.stats.capacity;
  const upkeep = sim.state.stats.expenses;
  assert.equal(sim.upgradeBuilding(home.id).ok, true);
  assert.equal(home.level, 2);
  assert.equal(sim.state.money, money - Math.floor(BUILDINGS.home.cost * .65));
  assert.equal(sim.state.stats.capacity, capacity + 6);
  assert.ok(sim.state.stats.expenses > upkeep);
  assert.equal(sim.upgradeBuilding(home.id).ok, true);
  assert.equal(sim.state.stats.capacity, capacity + 12);
  assert.equal(sim.upgradeBuilding(home.id).ok, false);
  const office = sim.state.buildings.find(b => b.kind === 'office')!;
  const jobs = sim.state.stats.jobs;
  sim.upgradeBuilding(office.id);
  assert.equal(sim.state.stats.jobs, jobs + 24);
  const power = sim.state.buildings.find(b => b.kind === 'power')!;
  const supply = sim.state.stats.power;
  sim.upgradeBuilding(power.id);
  assert.equal(sim.state.stats.power, supply + 120);
  sim.build('prison', 18, 19);
  const prison = sim.state.buildings.find(b => b.kind === 'prison')!;
  sim.upgradeBuilding(prison.id);
  assert.equal(sim.state.stats.prisonCapacity, 32);
  assert.equal(sim.upgradeBuilding(sim.state.buildings.find(b => b.kind === 'road')!.id).ok, false);
});

test('demolishing an occupied owned home restores outdoors and cleans furniture, player and resident references', () => {
  const sim = new Simulation();
  const home = moveIn(sim);
  const outdoors = { x: sim.state.interior!.returnX, z: sim.state.interior!.returnZ };
  sim.demolish(home.gx, home.gz);
  assert.equal(sim.state.interior, null);
  assert.equal(sim.state.player.homeId, null);
  assert.deepEqual({ x: sim.state.player.x, z: sim.state.player.z }, outdoors);
  assert.equal(sim.state.homes.some(h => h.homeId === home.id), false);
  assert.equal(sim.state.residents.some(r => r.homeId === home.id), false);
});

test('version one saves migrate in place, keep progress and receive default home furniture and new missions', () => {
  const original = new Simulation();
  const home = at(original, 'home');
  original.interact('adopt', home.id);
  original.state.money = 12345;
  original.state.missions.find(m => m.id === 'work')!.completed = true;
  original.state.missions.find(m => m.id === 'work')!.progress = 1;
  const legacy = JSON.parse(JSON.stringify(original.state));
  legacy.version = 1;
  delete legacy.homes; delete legacy.interior; delete legacy.prison; delete legacy.player.hygiene;
  legacy.missions = legacy.missions.filter((m: { id: string }) => !['settle', 'decorate', 'visitor'].includes(m.id));
  const migrated = new Simulation(legacy as GameState);
  assert.equal(migrated.state.version, 5);
  assert.equal(migrated.state.money, 12345);
  assert.equal(migrated.state.player.homeId, home.id);
  assert.equal(migrated.state.player.hygiene, 88);
  assert.equal(migrated.state.missions.find(m => m.id === 'work')!.completed, true);
  assert.equal(migrated.state.missions.length, 11);
  assert.equal(migrated.state.homes[0].furniture.length, 6);
  assert.equal(migrated.enterHome().ok, true);
});

test('version two saves persist furniture, indoor guests and prison progress while rejecting corrupt new references', () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  } });
  const sim = new Simulation();
  const guest = sim.state.residents[0]; guest.relation = 40;
  moveIn(sim); sim.buyFurniture('desk'); sim.socialize('invite', guest.id);
  sim.state.prison.released = 7;
  sim.setPrisonRegime('rehabilitation');
  const notices = sim.state.notices.length;
  assert.equal(sim.save(true).ok, true);
  assert.equal(sim.state.notices.length, notices);
  const good = storage.get('haven-city-save-v1')!;
  sim.reset(); assert.equal(sim.load().ok, true);
  assert.equal(sim.state.interior!.guestId, guest.id);
  assert.equal(sim.state.homes[0].furniture.some(f => f.kind === 'desk'), true);
  assert.equal(sim.state.prison.released, 7);
  assert.equal(sim.state.prison.regime, 'rehabilitation');
  assert.equal(sim.state.player.hygiene, 88);
  for (const corrupt of [
    (data: GameState) => { data.interior!.guestId = -1; },
    (data: GameState) => { data.homes[0].furniture[0].kind = '__proto__' as never; },
    (data: GameState) => { data.homes[0].furniture.push({ ...data.homes[0].furniture[0], id: data.nextId++ }); },
    (data: GameState) => { data.homes[0].homeId = -1; },
    (data: GameState) => { data.prison.released = -1; },
    (data: GameState) => { data.player.hygiene = 101; },
  ]) {
    const data: GameState = JSON.parse(good); corrupt(data);
    storage.set('haven-city-save-v1', JSON.stringify(data));
    assert.equal(sim.load().ok, false);
    assert.equal(sim.state.prison.released, 7);
  }
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

test('career shifts earn initial salary, promote, raise wages and preserve independent tracks', () => {
  const sim = new Simulation(); at(sim, 'office');
  const wallet = sim.state.player.money;
  assert.equal(sim.interact('work').ok, true);
  assert.equal(sim.state.player.money, wallet + 160);
  sim.tick(6.1); sim.interact('work');
  assert.equal(sim.state.progression.careers.business.xp, 40);
  assert.equal(sim.state.progression.careers.business.shifts, 2);
  assert.equal(xpLevel(sim.state.progression.careers.business.xp), 2);
  assert.equal(sim.state.player.job, '项目专员');
  assert.equal(wageFor(sim.state.progression), 195);
  sim.tick(6.1); sim.interact('work');
  assert.equal(sim.state.progression.totalEarned, 160 + 160 + 195);
  assert.equal(sim.state.missions.find(m => m.id === 'career')!.completed, true);
  assert.equal(sim.setCareer('culinary').ok, true);
  assert.equal(wageFor(sim.state.progression), 160);
  assert.equal(sim.state.progression.careers.business.xp, 60);
  assert.equal(sim.setCareer('__proto__' as never).ok, false);
  assert.equal(xpLevel(380), 5); assert.equal(xpLevel(1e7), 5);
});

test('skills improve cooking, friendship gains and matching career wages', () => {
  const sim = new Simulation();
  sim.state.progression.skills.cooking = 40;
  sim.setCareer('culinary');
  assert.equal(wageFor(sim.state.progression), 165);
  moveIn(sim); const kitchen = moveToFurniture(sim, 'kitchen');
  sim.state.player.hunger = 10;
  const wallet = sim.state.player.money;
  sim.useFurniture(kitchen.id);
  assert.equal(sim.state.player.money, wallet - 11);
  assert.equal(sim.state.player.hunger, 70);
  assert.equal(sim.state.progression.skills.cooking, 55);
  sim.exitHome();
  sim.state.progression.skills.charisma = 110;
  const resident = sim.state.residents[0];
  sim.state.player.x = resident.x; sim.state.player.z = resident.z;
  sim.socialize('chat', resident.id);
  assert.equal(resident.relation, 22);
  assert.equal(sim.state.progression.skills.charisma, 120);
});

test('remote work and community patrol award their intended career and skill experience', () => {
  const sim = new Simulation(); moveIn(sim); sim.buyFurniture('desk');
  const desk = moveToFurniture(sim, 'desk');
  sim.useFurniture(desk.id);
  assert.equal(sim.state.progression.totalEarned, 90);
  assert.equal(sim.state.progression.careers.business.xp, 15);
  assert.equal(sim.state.progression.skills.logic, 12);
  sim.exitHome(); at(sim, 'police'); sim.setCareer('community');
  sim.interact('patrol');
  assert.equal(sim.state.progression.careers.community.xp, 20);
  assert.equal(sim.state.progression.skills.charisma, 12);
  assert.equal(sim.state.progression.totalEarned, 155);
});

test('policies change daily budget, utility demand, safety and skill multipliers without upfront city charges', () => {
  const base = new Simulation(); const sim = new Simulation();
  const money = sim.state.money;
  for (const policy of ['green', 'education', 'community'] as const) assert.equal(sim.setPolicy(policy, true).ok, true);
  assert.equal(sim.state.money, money);
  assert.equal(sim.state.stats.expenses - base.state.stats.expenses, Object.values(CITY_POLICIES).reduce((n, p) => n + p.cost, 0));
  assert.ok(sim.state.stats.powerNeed < base.state.stats.powerNeed);
  assert.ok(sim.state.stats.waterNeed < base.state.stats.waterNeed);
  assert.ok(sim.state.stats.happiness > base.state.stats.happiness);
  assert.equal(sim.state.stats.safety, base.state.stats.safety + 4);
  const resident = sim.state.residents[0]; sim.state.player.x = resident.x; sim.state.player.z = resident.z;
  sim.socialize('chat', resident.id);
  assert.equal(sim.state.progression.skills.charisma, 10 * 1.25 * 1.25);
  assert.equal(sim.setPolicy('toString' as never, true).ok, false);
});

test('schools provide education and nearby paid study with cooldown while fire stations add coverage', () => {
  const sim = new Simulation();
  assert.equal(sim.state.stats.education, 20); assert.equal(sim.state.stats.fireCoverage, 0);
  assert.equal(sim.interact('study').ok, false);
  assert.equal(sim.build('school', 12, 9).ok, true);
  assert.equal(sim.build('firestation', 12, 10).ok, true);
  assert.ok(sim.state.stats.education > 20); assert.equal(sim.state.stats.fireCoverage, 35);
  assert.equal(sim.state.missions.find(m => m.id === 'services')!.completed, true);
  assert.equal(sim.interact('study').ok, false);
  at(sim, 'school'); const wallet = sim.state.player.money; const energy = sim.state.player.energy;
  assert.equal(sim.interact('study').ok, true);
  assert.equal(sim.state.player.money, wallet - 60); assert.equal(sim.state.player.energy, energy - 8);
  assert.ok(sim.state.progression.skills.logic > 45);
  assert.equal(sim.interact('study').ok, false);
  const school = sim.state.buildings.find(b => b.kind === 'school')!;
  sim.demolish(school.gx, school.gz); sim.tick(6.1);
  assert.equal(sim.interact('study').ok, false);
});

const addEvent = (sim: Simulation, kind: CityEventKind) => {
  const type = kind === 'festival' ? 'park' : kind === 'outage' ? 'power' : kind === 'training' ? 'school' : 'home';
  const event: GameState['civic']['events'][number] = { id: sim.state.nextId++, kind,
    buildingId: sim.state.buildings.find(b => b.kind === type)!.id, createdAt: sim.state.elapsed,
    expiresAt: sim.state.elapsed + 120, status: 'pending', choice: null };
  sim.state.civic.events.push(event); return event;
};

test('event choices charge their correct treasury, enforce constraints and cannot resolve twice', () => {
  const sim = new Simulation(); const festival = sim.state.civic.events[0];
  const money = sim.state.money; const wallet = sim.state.player.money;
  assert.equal(sim.resolveEvent(festival.id, 'repair').ok, false);
  sim.state.player.x = 100; sim.state.player.z = 100;
  assert.equal(sim.resolveEvent(festival.id, 'volunteer').ok, false);
  assert.equal(sim.state.money, money);
  assert.equal(sim.resolveEvent(festival.id, 'sponsor').ok, true);
  assert.equal(sim.state.money, money - 1500); assert.equal(sim.state.player.money, wallet);
  assert.equal(sim.state.civic.effects[0].kind, 'celebration'); assert.equal(sim.state.civic.effects[0].until, 240);
  assert.equal(sim.resolveEvent(festival.id, 'sponsor').ok, false);
  assert.equal(sim.state.money, money - 1500);
  const fire = addEvent(sim, 'fire');
  assert.equal(sim.resolveEvent(fire.id, 'dispatch').ok, false);
  sim.build('firestation', 12, 9);
  sim.state.money = 599;
  assert.equal(sim.resolveEvent(fire.id, 'dispatch').ok, false);
  sim.state.money = 600;
  assert.equal(sim.resolveEvent(fire.id, 'dispatch').ok, true);
  assert.equal(fire.status, 'resolved');
  assert.equal(sim.state.civic.resolved, 2);
  assert.equal(sim.state.money, 1800); // ¥600 dispatch was offset by the second-event mission's ¥1800 reward.
});

test('volunteering requires physical attendance and grants social and charisma experience', () => {
  const sim = new Simulation(); const event = sim.state.civic.events[0];
  at(sim, 'park'); sim.state.player.energy = 19;
  assert.equal(sim.resolveEvent(event.id, 'volunteer').ok, false);
  sim.state.player.energy = 30; sim.state.player.social = 10;
  assert.equal(sim.resolveEvent(event.id, 'volunteer').ok, true);
  assert.equal(sim.state.player.energy, 10); assert.equal(sim.state.player.social, 35);
  assert.equal(sim.state.progression.skills.charisma, 25);
  assert.equal(sim.state.civic.effects.find(effect => effect.kind === 'celebration')!.until, 120);
});

test('outages reduce power and rationing restores supply with a temporary economic tradeoff', () => {
  const sim = new Simulation(); const before = sim.state.stats.power;
  sim.tick(60);
  const outage = sim.state.civic.events.find(e => e.kind === 'outage')!;
  assert.ok(outage); assert.equal(sim.state.stats.power, before * .75);
  const income = sim.state.stats.income;
  assert.equal(sim.resolveEvent(outage.id, 'ration').ok, true);
  assert.equal(sim.state.stats.power, before);
  assert.ok(Math.abs(sim.state.stats.income - Math.round(income * .9)) <= 1);
  assert.ok(sim.state.civic.effects.some(effect => effect.kind === 'rationing'));
});

test('events expire without destroying buildings, effects expire, journals stay bounded and demolished targets are cleared', () => {
  const sim = new Simulation(); const event = sim.state.civic.events[0]; const target = sim.state.buildings.find(b => b.id === event.buildingId)!;
  sim.tick(121);
  assert.equal(event.status, 'expired');
  assert.ok(sim.state.buildings.some(b => b.id === target.id));
  assert.ok(sim.state.civic.effects.some(effect => effect.kind === 'disruption'));
  sim.demolish(target.gx, target.gz);
  assert.equal(event.buildingId, null);
  const outage = sim.state.civic.events.find(e => e.kind === 'outage')!;
  const power = sim.state.buildings.find(b => b.id === outage.buildingId)!;
  sim.demolish(power.gx, power.gz);
  assert.equal(outage.status, 'expired'); assert.equal(outage.buildingId, null);
  sim.tick(1500);
  assert.ok(sim.state.civic.events.length <= 12);
  assert.ok(sim.state.civic.events.filter(e => e.status === 'pending').length <= 3);
  assert.ok(sim.state.civic.effects.every(effect => effect.until > sim.state.elapsed));
  assert.ok(sim.state.civic.nextEventAt > sim.state.elapsed);
});

test('learning events fund education and study choices use personal tuition with school proximity', () => {
  const sim = new Simulation(); sim.build('school', 12, 9);
  const training = addEvent(sim, 'training'); const money = sim.state.money;
  assert.equal(sim.resolveEvent(training.id, 'study').ok, false);
  assert.equal(sim.resolveEvent(training.id, 'fund').ok, true);
  assert.equal(sim.state.money, money - 900);
  assert.ok(sim.state.civic.effects.some(effect => effect.kind === 'learning'));
  const nextTraining = addEvent(sim, 'training'); at(sim, 'school');
  const wallet = sim.state.player.money;
  assert.equal(sim.resolveEvent(nextTraining.id, 'study').ok, true);
  assert.equal(sim.state.player.money, wallet - 60);
  assert.ok(sim.state.progression.skills.logic >= 45 * 1.25);
});

test('version two migration preserves homes, guests, prison policy and progress while adding default careers and civic events', () => {
  const old = new Simulation(); old.state.residents[0].relation = 40; moveIn(old); old.buyFurniture('desk');
  old.socialize('invite', old.state.residents[0].id); old.setPrisonRegime('strict'); old.setPrisonIntake(false);
  old.state.money = 19456;
  const v2 = JSON.parse(JSON.stringify(old.state)); v2.version = 2; delete v2.progression; delete v2.civic;
  v2.missions = v2.missions.filter((m: { id: string }) => !['career', 'civic', 'services'].includes(m.id));
  const migrated = new Simulation(v2);
  assert.equal(migrated.state.version, 5); assert.equal(migrated.state.money, 19456);
  assert.equal(migrated.state.interior!.guestId, old.state.interior!.guestId);
  assert.equal(migrated.state.homes[0].furniture.length, 7);
  assert.equal(migrated.state.prison.regime, 'strict'); assert.equal(migrated.state.prison.intake, false);
  assert.equal(migrated.state.progression.career, 'business'); assert.equal(migrated.state.progression.totalEarned, 0);
  assert.equal(migrated.state.civic.events[0].kind, 'festival'); assert.equal(migrated.state.civic.nextEventAt, migrated.state.elapsed + 60);
});

test('v3 saves persist progress and reject invalid policy, experience, event IDs, choices and future timestamps', () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } });
  const sim = new Simulation(); sim.setCareer('community'); sim.setPolicy('green', true);
  sim.state.progression.skills.logic = 110; sim.state.progression.totalEarned = 333;
  assert.equal(sim.save(true).ok, true); const good = storage.get('haven-city-save-v1')!;
  sim.reset(); assert.equal(sim.load().ok, true);
  assert.equal(sim.state.progression.career, 'community'); assert.equal(sim.state.progression.skills.logic, 110);
  assert.equal(sim.state.civic.policies.green, true); assert.equal(sim.state.progression.totalEarned, 333);
  for (const corrupt of [
    (s: GameState) => { s.progression.skills.logic = -1; },
    (s: GameState) => { s.progression.career = '__proto__' as never; },
    (s: GameState) => { s.civic.policies.green = 1 as never; },
    (s: GameState) => { s.civic.events[0].buildingId = -1; },
    (s: GameState) => { s.civic.events[0].id = s.buildings[0].id; },
    (s: GameState) => { s.civic.events[0].createdAt = s.elapsed + 30; },
    (s: GameState) => { s.civic.events[0].expiresAt = s.elapsed + 99999; },
    (s: GameState) => { s.civic.events[0].choice = 'emergency'; },
    (s: GameState) => { s.civic.nextEventAt = s.elapsed + 1000; },
    (s: GameState) => { s.civic.sequence = 999999; },
    (s: GameState) => { s.elapsed = 1e20; s.civic.nextEventAt = 1e20; },
  ]) {
    const data: GameState = JSON.parse(good); corrupt(data); storage.set('haven-city-save-v1', JSON.stringify(data));
    assert.equal(sim.load().ok, false); assert.equal(sim.state.progression.totalEarned, 333);
  }
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

test('free event responses stay available in city debt and policy fees accrue in daily fractions', () => {
  const sim = new Simulation(); sim.state.money = -200;
  assert.equal(sim.resolveEvent(sim.state.civic.events[0].id, 'decline').ok, true);
  const outage = addEvent(sim, 'outage');
  assert.equal(sim.resolveEvent(outage.id, 'ration').ok, true);
  const base = new Simulation(); const policy = new Simulation();
  policy.setPolicy('education', true);
  base.tick(10); policy.tick(10);
  assert.ok(Math.abs(base.state.money - policy.state.money - CITY_POLICIES.education.cost / 24) < 1e-7);
});

test('resolved events keep their outcome after target demolition and remain valid saves', () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } });
  const sim = new Simulation(); const event = sim.state.civic.events[0];
  const park = sim.state.buildings.find(b => b.id === event.buildingId)!;
  sim.resolveEvent(event.id, 'sponsor'); sim.demolish(park.gx, park.gz);
  assert.equal(event.status, 'resolved'); assert.equal(event.choice, 'sponsor'); assert.equal(event.buildingId, null);
  sim.save(true); assert.equal(sim.load().ok, true);
  assert.equal(sim.state.civic.events[0].status, 'resolved'); assert.equal(sim.state.civic.events[0].buildingId, null);
  sim.tick(241);
  assert.equal(sim.state.civic.effects.some(effect => effect.kind === 'celebration'), false);
  sim.save(true); assert.equal(sim.load().ok, true);
  delete (globalThis as { localStorage?: Storage }).localStorage;
});
