import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/simulation.ts';
import { getTransitNetwork, getTransitPath, transitPathLength } from '../src/transit.ts';
import { BUILDINGS, cellToWorld, worldToCell, type Building, type BuildingKind, type GameState } from '../src/types.ts';

const key = 'haven-city-save-v1';
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function busCity() {
  const sim = new Simulation();
  assert.equal(sim.build('busstop', 6, 7).ok, true);
  assert.equal(sim.build('busstop', 18, 7).ok, true);
  const [from, to] = sim.state.buildings.filter(b => b.kind === 'busstop');
  sim.state.player.x = cellToWorld(from.gx); sim.state.player.z = cellToWorld(from.gz);
  return { sim, from, to };
}
function mockStorage() {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (name: string) => data.get(name) ?? null,
    setItem: (name: string, value: string) => data.set(name, value),
    removeItem: (name: string) => data.delete(name),
  } });
  return data;
}
function layout(sites: [BuildingKind, number, number][]): GameState {
  const state = copy(new Simulation().state);
  state.buildings = sites.map(([kind, gx, gz], i): Building => ({ id: i + 1, kind, gx, gz, level: 1, active: true }));
  state.residents = [];
  return state;
}

test('bus stops are affordable public buildings without changing the initial district', () => {
  const sim = new Simulation();
  assert.equal(sim.state.buildings.filter(b => b.kind !== 'road').length, 35);
  assert.equal(BUILDINGS.busstop.cost, 850); assert.equal(BUILDINGS.busstop.upkeep, 8); assert.equal(BUILDINGS.busstop.jobs, 0);
  const money = sim.state.money;
  assert.equal(sim.build('busstop', 6, 7).ok, true);
  assert.equal(sim.state.money, money - 850);
  assert.equal(getTransitNetwork(sim.state).routes.length, 0);
  assert.equal(getTransitNetwork(sim.state).stops[0].served, false);
  assert.equal(sim.state.stats.transitIncome, 0);
  assert.equal(sim.state.stats.transitExpenses, 8);
});

test('network BFS follows bent roads, returns a closed loop and never cuts across a block', () => {
  const state = layout([['road', 5, 5], ['road', 5, 6], ['road', 5, 7], ['road', 6, 7], ['road', 7, 7], ['busstop', 4, 5], ['busstop', 8, 7]]);
  const network = getTransitNetwork(state);
  assert.equal(network.routes.length, 1);
  assert.ok(network.stops.every(stop => stop.served));
  const route = network.routes[0];
  assert.deepEqual(route.path[0], route.path.at(-1));
  assert.equal(route.length, 80);
  const roads = new Set(state.buildings.filter(b => b.kind === 'road').map(b => `${b.gx},${b.gz}`));
  for (let i = 0; i < route.path.length; i++) {
    const p = route.path[i]; assert.ok(roads.has(`${worldToCell(p.x)},${worldToCell(p.z)}`));
    if (i) assert.equal(Math.abs(p.x - route.path[i - 1].x) + Math.abs(p.z - route.path[i - 1].z), 10);
  }
  assert.equal(transitPathLength(getTransitPath(state, 6, 7)!), 40);
});

test('separate road components have separate lines and a singleton cannot serve passengers', () => {
  const state = layout([['road', 5, 5], ['road', 5, 6], ['busstop', 4, 5], ['busstop', 4, 6],
    ['road', 15, 15], ['road', 15, 16], ['busstop', 16, 15], ['busstop', 16, 16], ['road', 20, 4], ['busstop', 21, 4]]);
  const network = getTransitNetwork(state);
  assert.equal(network.routes.length, 2);
  assert.equal(network.stops.filter(stop => stop.served).length, 4);
  assert.equal(getTransitPath(state, 3, 7), null);
  assert.equal(network.stops.find(stop => stop.id === 10)!.served, false);
  state.buildings = state.buildings.filter(b => b.id !== 2);
  const disconnected = getTransitNetwork(state);
  assert.equal(disconnected.routes.length, 1, 'layout changes invalidate the cached road search');
  assert.equal(getTransitPath(state, 3, 4), null);
});

test('forecasts follow live population, fares and operating policy with no double station upkeep', () => {
  const { sim } = busCity();
  const initial = getTransitNetwork(sim.state);
  assert.ok(initial.coverage > 0); assert.ok(initial.riders > 0); assert.equal(initial.income, initial.riders * 4);
  assert.deepEqual([sim.state.stats.transitCoverage, sim.state.stats.transitRiders, sim.state.stats.transitIncome, sim.state.stats.transitExpenses],
    [initial.coverage, initial.riders, initial.income, initial.expenses]);
  sim.setTransitFare(2); const cheap = getTransitNetwork(sim.state);
  sim.setTransitFare(6); const expensive = getTransitNetwork(sim.state);
  assert.ok(cheap.riders >= expensive.riders);
  assert.equal(expensive.income, expensive.riders * 6);
  assert.equal(sim.setTransitFare(3).ok, false); assert.equal(sim.state.transit.fare, 6);
  const happiness = sim.state.stats.happiness;
  const allIncome = sim.state.stats.income, allExpenses = sim.state.stats.expenses;
  sim.setTransitEnabled(false);
  assert.equal(sim.state.stats.transitCoverage, 0); assert.equal(sim.state.stats.transitRiders, 0); assert.equal(sim.state.stats.transitIncome, 0);
  assert.equal(sim.state.stats.transitExpenses, 16);
  assert.equal(allIncome - sim.state.stats.income, expensive.income);
  assert.equal(allExpenses - sim.state.stats.expenses, expensive.expenses - 16);
  assert.ok(sim.state.stats.happiness < happiness);
  sim.state.residents = [];
  assert.equal(getTransitNetwork(sim.state).riders, 0);
});

test('boarding rejects bad destinations, insufficient money, distance, indoor visits and stopped service without charging', () => {
  const { sim, from, to } = busCity();
  const wallet = sim.state.player.money, treasury = sim.state.money;
  assert.equal(sim.rideTransit(-1).ok, false); assert.equal(sim.rideTransit(from.id).ok, false);
  sim.state.player.x = cellToWorld(from.gx) - 18;
  assert.equal(sim.rideTransit(to.id).ok, false, 'the boarding radius is strictly below eighteen metres');
  sim.state.player.x = cellToWorld(from.gx);
  sim.setTransitEnabled(false); assert.equal(sim.rideTransit(to.id).ok, false); sim.setTransitEnabled(true);
  sim.state.player.money = 3; assert.equal(sim.rideTransit(to.id).ok, false); sim.state.player.money = wallet;
  assert.equal(sim.state.money, treasury);
  const home = sim.state.buildings.find(b => b.kind === 'home')!;
  sim.state.player.x = cellToWorld(home.gx); sim.state.player.z = cellToWorld(home.gz);
  sim.interact('adopt', home.id); sim.enterHome();
  const indoorTreasury = sim.state.money;
  assert.equal(sim.rideTransit(to.id).ok, false);
  assert.equal(sim.state.player.money, wallet); assert.equal(sim.state.money, indoorTreasury);
  assert.equal(sim.state.transit.journey, null);
});

test('a served destination on another road network cannot be used as a teleport', () => {
  const { sim } = busCity();
  for (const gz of [1, 2]) { assert.equal(sim.build('road', 0, gz).ok, true); assert.equal(sim.build('busstop', 1, gz).ok, true); }
  const remote = sim.state.buildings.find(b => b.kind === 'busstop' && b.gx === 1)!;
  assert.equal(getTransitNetwork(sim.state).stops.find(stop => stop.id === remote.id)!.served, true);
  const position = { x: sim.state.player.x, z: sim.state.player.z }, money = sim.state.player.money, treasury = sim.state.money;
  assert.equal(sim.rideTransit(remote.id).ok, false);
  assert.deepEqual({ x: sim.state.player.x, z: sim.state.player.z }, position);
  assert.equal(sim.state.player.money, money); assert.equal(sim.state.money, treasury);
});

test('a ride charges one fare immediately, moves along its path and awards arrival benefits exactly once', () => {
  const { sim, to } = busCity();
  sim.state.player.energy = 40;
  const wallet = sim.state.player.money, treasury = sim.state.money;
  assert.equal(sim.rideTransit(to.id).ok, true);
  assert.equal(sim.state.player.money, wallet - 4); assert.equal(sim.state.money, treasury + 4);
  assert.equal(sim.rideTransit(to.id).ok, false);
  const trip = sim.state.transit.journey!; const duration = trip.distance / 20;
  sim.tick(.2);
  assert.ok(Math.abs(trip.travelled - 4) < 1e-9);
  assert.ok(Number.isFinite(sim.state.player.yaw));
  sim.tick(duration - .2 + .001);
  assert.equal(sim.state.transit.journey, null); assert.equal(sim.state.transit.totalTrips, 1);
  assert.equal(sim.state.player.money, wallet - 4);
  assert.ok(Math.hypot(sim.state.player.x - cellToWorld(to.gx), sim.state.player.z - cellToWorld(to.gz)) < 18);
  assert.ok(Math.abs(sim.state.player.energy - (48 - (duration + .001) * .08)) < 1e-7);
  sim.tick(.5); assert.equal(sim.state.transit.totalTrips, 1);
});

test('pause freezes a journey and simulation speed never multiplies the bus real-time movement twice', () => {
  const a = busCity(), b = busCity();
  a.sim.rideTransit(a.to.id); b.sim.rideTransit(b.to.id);
  a.sim.setSpeed(0); const before = copy(a.sim.state.transit.journey);
  a.sim.tick(20); assert.deepEqual(a.sim.state.transit.journey, before);
  a.sim.setSpeed(1); b.sim.setSpeed(3);
  a.sim.tick(.5); b.sim.tick(.5);
  assert.ok(Math.abs(a.sim.state.transit.journey!.travelled - 10) < 1e-8);
  assert.ok(Math.abs(b.sim.state.transit.journey!.travelled - 10) < 1e-8);
  assert.equal(a.sim.state.player.x, b.sim.state.player.x); assert.equal(a.sim.state.player.z, b.sim.state.player.z);
});

test('fare changes preserve the already-paid ticket and stopping service safely ends the trip', () => {
  const { sim, to } = busCity();
  const wallet = sim.state.player.money;
  sim.rideTransit(to.id); sim.setTransitFare(6);
  assert.equal(sim.state.transit.journey!.fare, 4); assert.equal(sim.state.player.money, wallet - 4);
  sim.tick(.5); sim.setTransitEnabled(false);
  assert.equal(sim.state.transit.journey, null); assert.equal(sim.state.transit.totalTrips, 0);
  assert.equal(sim.state.player.money, wallet - 4);
  assert.equal(sim.state.stats.transitCoverage, 0);
});

test('passengers cannot earn wages, socialize, enter homes, use furniture or chain another ride', () => {
  const { sim, to } = busCity();
  sim.rideTransit(to.id);
  const before = { money: sim.state.player.money, xp: copy(sim.state.progression), energy: sim.state.player.energy };
  for (const action of ['work', 'rest', 'eat', 'adopt', 'talk', 'study', 'patrol', 'enter', 'exit', 'furniture'] as const) assert.equal(sim.interact(action).ok, false);
  assert.equal(sim.socialize('gift', sim.state.residents[0].id).ok, false);
  assert.equal(sim.enterHome().ok, false); assert.equal(sim.exitHome().ok, false);
  assert.equal(sim.buyFurniture('desk').ok, false); assert.equal(sim.sellFurniture(1).ok, false); assert.equal(sim.useFurniture(1).ok, false);
  assert.equal(sim.rideTransit(to.id).ok, false);
  assert.deepEqual({ money: sim.state.player.money, xp: sim.state.progression, energy: sim.state.player.energy }, before);
});

test('station removal or loss of road access safely ends a ride without changing unrelated personal data', () => {
  for (const removeRoad of [false, true]) {
    const { sim, from, to } = busCity();
    sim.state.player.name = '保留居民'; sim.state.progression.skills.logic = 44;
    sim.rideTransit(to.id); sim.tick(.25);
    if (removeRoad) {
      sim.demolish(17, 7); sim.demolish(18, 6);
    } else sim.demolish(to.gx, to.gz);
    assert.equal(sim.state.transit.journey, null);
    assert.equal(sim.state.transit.totalTrips, 0);
    assert.equal(sim.state.player.name, '保留居民'); assert.equal(sim.state.progression.skills.logic, 44);
    assert.ok(Number.isFinite(sim.state.player.x) && Number.isFinite(sim.state.player.z));
    assert.ok(sim.state.buildings.some(b => b.id === from.id));
  }
});

test('daily transit revenue and costs accrue through the actual city budget', () => {
  const { sim } = busCity();
  const disabled = new Simulation(copy(sim.state)); disabled.setTransitEnabled(false);
  const money = sim.state.money - disabled.state.money;
  const expected = (sim.state.stats.transitIncome - sim.state.stats.transitExpenses + disabled.state.stats.transitExpenses) / 24;
  sim.tick(10); disabled.tick(10);
  assert.ok(Math.abs((sim.state.money - disabled.state.money) - money - expected) < 1e-7);
});

test('mid-journey saves resume from canonical roads without charging or crediting the fare again', t => {
  const storage = mockStorage(); t.after(() => { delete (globalThis as { localStorage?: Storage }).localStorage; });
  const { sim, to } = busCity(); sim.rideTransit(to.id); sim.tick(.75);
  const wallet = sim.state.player.money, treasury = sim.state.money, travelled = sim.state.transit.journey!.travelled;
  sim.save(true);
  const loaded = new Simulation(JSON.parse(storage.get(key)!));
  assert.equal(loaded.state.transit.journey!.travelled, travelled);
  assert.equal(loaded.state.player.money, wallet); assert.equal(loaded.state.money, treasury);
  loaded.tick(20);
  assert.equal(loaded.state.transit.journey, null); assert.equal(loaded.state.transit.totalTrips, 1);
  assert.equal(loaded.state.player.money, wallet);
});

test('versions one, two and three migrate to schema four without losing wallet, city or progression', () => {
  for (const version of [1, 2, 3]) {
    const legacy = copy(new Simulation().state) as GameState & Record<string, unknown>;
    legacy.version = version; legacy.money = 12345; legacy.player.money = 777;
    legacy.progression.skills.logic = 110;
    delete legacy.transit;
    if (version < 3) { delete legacy.progression; delete legacy.civic; }
    if (version < 2) { delete legacy.homes; delete legacy.interior; delete legacy.prison; delete legacy.player.hygiene; }
    const loaded = new Simulation(legacy);
    assert.equal(loaded.state.version, 4); assert.equal(loaded.state.money, 12345); assert.equal(loaded.state.player.money, 777);
    assert.deepEqual(loaded.state.transit, { enabled: true, fare: 4, totalTrips: 0, journey: null });
    assert.equal(loaded.state.buildings.length, legacy.buildings.length);
    if (version === 3) assert.equal(loaded.state.progression.skills.logic, 110);
  }
});

test('untrusted transit saves reject forged paths, distances, positions, references and unbounded progress', t => {
  mockStorage(); t.after(() => { delete (globalThis as { localStorage?: Storage }).localStorage; });
  const { sim, to } = busCity(); sim.rideTransit(to.id); sim.tick(.25);
  const good = sim.exportSave(), original = copy(sim.state);
  const changes = [
    (s: GameState) => { s.transit.fare = 5; },
    (s: GameState) => { s.transit.enabled = 1 as never; },
    (s: GameState) => { s.transit.totalTrips = -1; },
    (s: GameState) => { s.transit.journey!.toId = -5; },
    (s: GameState) => { s.transit.journey!.path[1].x += 1; },
    (s: GameState) => { s.transit.journey!.path = Array.from({ length: 531 }, () => ({ x: 0, z: 0 })); },
    (s: GameState) => { s.transit.journey!.distance += 1; },
    (s: GameState) => { s.transit.journey!.travelled = s.transit.journey!.distance; },
    (s: GameState) => { s.player.x += 10; },
    (s: GameState) => { s.transit.journey = undefined as never; },
  ];
  for (const change of changes) {
    const state: GameState = JSON.parse(good); change(state);
    assert.equal(sim.importSave(JSON.stringify(state)).ok, false);
    assert.deepEqual(sim.state, original);
  }
});

test('export is side-effect free and importing a backup atomically replaces and persists the city', t => {
  const storage = mockStorage(); t.after(() => { delete (globalThis as { localStorage?: Storage }).localStorage; });
  const source = busCity().sim;
  const home = source.state.buildings.find(b => b.kind === 'home')!;
  source.state.player.x = cellToWorld(home.gx); source.state.player.z = cellToWorld(home.gz);
  source.interact('adopt', home.id); source.enterHome(); source.buyFurniture('desk');
  const guest = source.state.residents[0]; guest.relation = 40; source.socialize('invite', guest.id);
  source.state.progression.skills.logic = 110; source.state.player.money = 543;
  const sourceBefore = copy(source.state), backup = source.exportSave();
  assert.deepEqual(source.state, sourceBefore); assert.equal(storage.size, 0);
  const target = new Simulation(); target.state.money = 9000; target.save(true);
  assert.equal(target.importSave(backup).ok, true);
  assert.equal(target.state.player.money, 543); assert.equal(target.state.progression.skills.logic, 110);
  assert.equal(target.state.buildings.filter(b => b.kind === 'busstop').length, 2);
  assert.equal(target.state.interior!.guestId, guest.id);
  assert.equal(target.state.homes[0].furniture.some(f => f.kind === 'desk'), true);
  assert.equal(JSON.parse(storage.get(key)!).player.money, 543);
  const document: GameState = JSON.parse(backup); document.player.name = '外部修改';
  assert.notEqual(target.state.player.name, document.player.name);
});

test('bad, oversized, future and unwritable backups preserve the current city and existing local save', t => {
  const storage = mockStorage(); t.after(() => { delete (globalThis as { localStorage?: Storage }).localStorage; });
  const sim = new Simulation(); sim.state.player.money = 432; sim.save(true);
  const state = copy(sim.state), persisted = storage.get(key);
  const future = copy(sim.state); future.version = 99;
  for (const backup of ['{invalid', '{}', ' '.repeat(2 * 1024 * 1024 + 1), JSON.stringify(future)]) {
    assert.equal(sim.importSave(backup).ok, false); assert.deepEqual(sim.state, state); assert.equal(storage.get(key), persisted);
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (name: string) => storage.get(name) ?? null,
    setItem: () => { throw new Error('quota'); },
  } });
  const valid = new Simulation(); valid.state.player.money = 99;
  assert.equal(sim.importSave(valid.exportSave()).ok, false);
  assert.deepEqual(sim.state, state); assert.equal(storage.get(key), persisted);
});
