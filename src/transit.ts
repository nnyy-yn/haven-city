import { BUILDINGS, cellToWorld, TILE } from './types.ts';
import type { Building, GameState } from './types.ts';

export interface TransitPoint { x: number; z: number }
export interface TransitStop { id: number; name: string; gx: number; gz: number; served: boolean }
export interface TransitRoute { stopIds: number[]; path: TransitPoint[]; length: number }
export interface TransitNetwork { stops: TransitStop[]; routes: TransitRoute[]; coverage: number; riders: number; income: number; expenses: number }
interface Layout { signature: string; roads: Map<string, Building>; anchors: Map<number, string>; components: Map<string, number>; stops: TransitStop[]; routes: TransitRoute[]; paths: Map<string, TransitPoint[]> }
const layouts = new WeakMap<GameState, Layout>();
const key = (x: number, z: number) => `${x},${z}`;
const adjacent = (road: Building) => [key(road.gx + 1, road.gz), key(road.gx - 1, road.gz), key(road.gx, road.gz + 1), key(road.gx, road.gz - 1)];
const point = (road: Building): TransitPoint => ({ x: cellToWorld(road.gx), z: cellToWorld(road.gz) });
export const transitPathLength = (path: TransitPoint[]) => path.reduce((total, p, i) => total + (i ? Math.hypot(p.x - path[i - 1].x, p.z - path[i - 1].z) : 0), 0);

function shortest(layout: Layout, from: string, to: string): TransitPoint[] {
  const cached = layout.paths.get(`${from}>${to}`);
  if (cached) return cached;
  if (!layout.roads.has(from) || !layout.roads.has(to) || layout.components.get(from) !== layout.components.get(to)) return [];
  const previous = new Map<string, string | null>([[from, null]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    if (current === to) break;
    for (const next of adjacent(layout.roads.get(current)!)) if (layout.roads.has(next) && !previous.has(next)) {
      previous.set(next, current); queue.push(next);
    }
  }
  if (!previous.has(to)) return [];
  const path: TransitPoint[] = [];
  let current: string | null = to;
  while (current !== null) { path.push(point(layout.roads.get(current)!)); current = previous.get(current) ?? null; }
  path.reverse();
  // Two stops may share one road tile; this short turn stays inside that tile.
  if (path.length === 1) path.push({ x: path[0].x + 2, z: path[0].z }, { ...path[0] });
  layout.paths.set(`${from}>${to}`, path);
  return path;
}

function layoutFor(state: GameState): Layout {
  const infrastructure = state.buildings.filter(b => b.kind === 'road' || b.kind === 'busstop');
  const signature = infrastructure.map(b => `${b.id}:${b.kind}:${b.gx},${b.gz}:${Number(b.active)}`).join('|');
  const cached = layouts.get(state);
  if (cached?.signature === signature) return cached;
  const roads = new Map(infrastructure.filter(b => b.kind === 'road' && b.active).map(b => [key(b.gx, b.gz), b]));
  const layout: Layout = { signature, roads, anchors: new Map(), components: new Map(), stops: [], routes: [], paths: new Map() };
  const componentSizes: number[] = [];
  for (const origin of roads.keys()) {
    if (layout.components.has(origin)) continue;
    const component = componentSizes.length, queue = [origin];
    layout.components.set(origin, component);
    for (let i = 0; i < queue.length; i++) for (const next of adjacent(roads.get(queue[i])!)) {
      if (roads.has(next) && !layout.components.has(next)) { layout.components.set(next, component); queue.push(next); }
    }
    componentSizes.push(queue.length);
  }
  const groups = new Map<number, TransitStop[]>();
  for (const building of infrastructure.filter(b => b.kind === 'busstop')) {
    const stop: TransitStop = { id: building.id, name: `街区公交站 · ${building.gx + 1}-${building.gz + 1}`, gx: building.gx, gz: building.gz, served: false };
    layout.stops.push(stop);
    if (!building.active) continue;
    const candidates = adjacent(building).filter(k => roads.has(k));
    // A stop is attached to one road component; it cannot connect two broken roads.
    candidates.sort((a, b) => componentSizes[layout.components.get(b)!] - componentSizes[layout.components.get(a)!] || layout.components.get(a)! - layout.components.get(b)!);
    const anchor = candidates[0];
    if (!anchor) continue;
    layout.anchors.set(stop.id, anchor);
    const component = layout.components.get(anchor)!;
    const group = groups.get(component) ?? [];
    group.push(stop); groups.set(component, group);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.gx - b.gx || a.gz - b.gz || a.id - b.id);
    const path: TransitPoint[] = [];
    for (let i = 0; i < group.length; i++) {
      group[i].served = true;
      const section = shortest(layout, layout.anchors.get(group[i].id)!, layout.anchors.get(group[(i + 1) % group.length].id)!);
      path.push(...(path.length ? section.slice(1) : section));
    }
    layout.routes.push({ stopIds: group.map(stop => stop.id), path, length: transitPathLength(path) });
  }
  layouts.set(state, layout);
  return layout;
}

/** Cached road BFS; population, fare and the operating switch are recalculated on each call. */
export function getTransitNetwork(state: GameState): TransitNetwork {
  const layout = layoutFor(state);
  const served = state.transit.enabled ? layout.stops.filter(stop => stop.served) : [];
  const homes = new Map(state.buildings.filter(b => b.active && (b.kind === 'home' || b.kind === 'apartment')).map(b => [b.id, b]));
  const covered = (home: Building) => served.some(stop => Math.hypot((home.gx - stop.gx) * TILE, (home.gz - stop.gz) * TILE) <= 42);
  const population = state.residents.length;
  const reachable = state.residents.filter(resident => { const home = homes.get(resident.homeId); return home && covered(home); }).length;
  const coverage = population ? Math.round(reachable / population * 100) : homes.size ? Math.round([...homes.values()].filter(covered).length / homes.size * 100) : 0;
  const riders = Math.round(reachable * .8 * (1 - (state.transit.fare - 2) * .075));
  const income = riders * state.transit.fare;
  const stopUpkeep = state.buildings.filter(b => b.kind === 'busstop').reduce((sum, b) => sum + BUILDINGS.busstop.upkeep * (1 + .6 * (b.level - 1)), 0);
  const operating = state.transit.enabled ? layout.routes.reduce((sum, route) => sum + 36 + route.length * .06 + route.stopIds.length * 4, 0) : 0;
  return { stops: layout.stops.map(stop => ({ ...stop })), routes: layout.routes.map(route => ({ stopIds: [...route.stopIds], path: route.path.map(p => ({ ...p })), length: route.length })),
    coverage, riders, income, expenses: Math.round(stopUpkeep + operating) };
}

/** Canonical shortest path for a passenger, independent of untrusted saved waypoints. */
export function getTransitPath(state: GameState, fromId: number, toId: number): TransitPoint[] | null {
  if (fromId === toId) return null;
  const layout = layoutFor(state);
  if (!layout.stops.some(stop => stop.id === fromId && stop.served) || !layout.stops.some(stop => stop.id === toId && stop.served)) return null;
  const from = layout.anchors.get(fromId), to = layout.anchors.get(toId);
  if (!from || !to || layout.components.get(from) !== layout.components.get(to)) return null;
  const path = shortest(layout, from, to);
  return path.length > 1 ? path.map(p => ({ ...p })) : null;
}
