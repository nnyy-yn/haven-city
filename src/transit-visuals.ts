import * as THREE from 'three';
import { getTransitNetwork, type TransitPoint, type TransitRoute } from './transit';
import { cellToWorld, type CameraMode, type GameState } from './types';

interface RenderRoute { stopIds: number[]; path: TransitPoint[]; cumulative: number[]; length: number }
export function prepareTransitRoute(route: TransitRoute): RenderRoute {
  const cumulative = [0];
  for (let i = 1; i < route.path.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot(route.path[i].x - route.path[i - 1].x, route.path[i].z - route.path[i - 1].z));
  return { stopIds: route.stopIds, path: route.path, cumulative, length: cumulative.at(-1) ?? 0 };
}

/** Exact polyline sampling keeps every bus on the BFS road path, including U turns. */
export function sampleTransitRoute(route: RenderRoute, distance: number, loop = true) {
  if (route.path.length < 2 || route.length <= 0) return { x: route.path[0]?.x ?? 0, z: route.path[0]?.z ?? 0, yaw: 0 };
  const travelled = Number.isFinite(distance) ? distance : 0;
  const d = loop ? ((travelled % route.length) + route.length) % route.length : THREE.MathUtils.clamp(travelled, 0, route.length);
  let index = 1;
  while (index < route.path.length - 1 && route.cumulative[index] <= d) index++;
  const from = route.path[index - 1], to = route.path[index], length = route.cumulative[index] - route.cumulative[index - 1];
  const fraction = length > 0 ? THREE.MathUtils.clamp((d - route.cumulative[index - 1]) / length, 0, 1) : 0;
  return { x: THREE.MathUtils.lerp(from.x, to.x, fraction), z: THREE.MathUtils.lerp(from.z, to.z, fraction), yaw: Math.atan2(to.x - from.x, to.z - from.z) };
}

export class TransitVisuals {
  private layer = new THREE.Group();
  private operating: THREE.InstancedMesh[] = [];
  private passenger: THREE.Group;
  private template: THREE.Group;
  private overlay = new THREE.Group();
  private overlayLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#86d4bd', transparent: true, opacity: .8, depthWrite: false }));
  private stopRing = new THREE.Mesh(new THREE.RingGeometry(5.5, 5.63, 64), new THREE.MeshBasicMaterial({ color: '#8ed3b1', transparent: true, opacity: .7, depthWrite: false }));
  private routes: RenderRoute[] = [];
  private stops: ReturnType<typeof getTransitNetwork>['stops'] = [];
  private selectedId: number | null = null;
  private routeSignature = '';
  private overlaySignature = '';
  private progress = 0;
  private capacity = 0;
  private dummy = new THREE.Object3D();
  private busLocations: { x: number; z: number; yaw: number }[] = [];

  constructor(scene: THREE.Scene, template: THREE.Group) {
    this.template = template; this.passenger = template.clone(); this.passenger.visible = false;
    this.layer.name = 'Road network public transit'; this.passenger.name = 'Passenger journey bus';
    this.stopRing.rotation.x = -Math.PI / 2; this.stopRing.position.y = .28;
    this.overlay.add(this.overlayLine, this.stopRing); this.overlay.visible = false;
    this.overlayLine.raycast = () => {}; this.stopRing.raycast = () => {};
    this.layer.add(this.passenger, this.overlay); scene.add(this.layer);
  }

  sync(state: GameState) {
    const network = getTransitNetwork(state);
    const signature = network.routes.map(route => `${route.stopIds.join(',')}:${route.path.map(p => `${p.x},${p.z}`).join(';')}`).join('|');
    this.stops = network.stops;
    if (signature !== this.routeSignature) {
      this.routeSignature = signature; this.routes = network.routes.map(prepareTransitRoute).filter(route => route.length > 0);
      if (this.routes.length > this.capacity) this.resize(this.routes.length);
    }
    this.highlight(this.selectedId);
  }

  private resize(count: number) {
    for (const mesh of this.operating) { this.layer.remove(mesh); mesh.dispose(); }
    this.operating = []; this.capacity = Math.max(4, count);
    for (const child of this.template.children) {
      const part = child as THREE.Mesh;
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, this.capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true; mesh.raycast = () => {};
      this.layer.add(mesh); this.operating.push(mesh);
    }
  }

  update(dt: number, state: GameState, mode: CameraMode) {
    const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    if (state.transit.enabled) this.progress += step * state.speed * 6.2;
    this.busLocations = [];
    if (state.transit.enabled) this.routes.forEach((route, i) => {
      const at = sampleTransitRoute(route, this.progress + route.length * (.19 + i * .23));
      const lane = 1.08;
      at.x += Math.cos(at.yaw) * lane; at.z -= Math.sin(at.yaw) * lane;
      this.busLocations.push(at); this.dummy.position.set(at.x, .13, at.z); this.dummy.rotation.set(0, at.yaw, 0); this.dummy.scale.setScalar(1); this.dummy.updateMatrix();
      this.operating.forEach(mesh => mesh.setMatrixAt(i, this.dummy.matrix));
    });
    this.operating.forEach(mesh => { mesh.count = this.busLocations.length; mesh.visible = state.transit.enabled; mesh.instanceMatrix.needsUpdate = true; mesh.boundingSphere = null; });
    const journey = state.transit.journey;
    this.passenger.visible = !!journey && mode !== 'first';
    if (journey) { this.passenger.position.set(state.player.x, .13, state.player.z); this.passenger.rotation.y = state.player.yaw; }
    this.overlay.visible = mode === 'city' && this.selectedId !== null && this.stops.some(stop => stop.id === this.selectedId);
  }

  highlight(id: number | null) {
    const stop = this.stops.find(candidate => candidate.id === id);
    this.selectedId = stop ? id : null;
    if (!stop) { this.overlay.visible = false; return; }
    const signature = `${id}:${stop.gx},${stop.gz}:${stop.served}:${this.routeSignature}`;
    if (signature === this.overlaySignature) return;
    this.overlaySignature = signature;
    this.stopRing.position.set(cellToWorld(stop.gx), .28, cellToWorld(stop.gz));
    (this.stopRing.material as THREE.MeshBasicMaterial).color.set(stop.served ? '#8ed3b1' : '#d0b17a');
    const route = this.routes.find(candidate => candidate.stopIds.includes(stop.id));
    this.overlayLine.geometry.dispose();
    this.overlayLine.geometry = new THREE.BufferGeometry().setFromPoints((route?.path ?? []).map(p => new THREE.Vector3(p.x, .29, p.z)));
    this.overlayLine.visible = !!route;
  }

  getDiagnostics() { return { routes: this.routes.length, operatingBuses: this.busLocations.map(bus => ({ ...bus })), passengerVisible: this.passenger.visible, passengerPosition: this.passenger.position.toArray(), selectedStop: this.selectedId }; }

  dispose() {
    const geometries = new Set<THREE.BufferGeometry>();
    this.template.traverse(object => { if ((object as THREE.Mesh).geometry) geometries.add((object as THREE.Mesh).geometry); });
    geometries.forEach(geometry => geometry.dispose());
    this.operating.forEach(mesh => mesh.dispose()); this.overlayLine.geometry.dispose(); this.overlayLine.material.dispose();
    this.stopRing.geometry.dispose(); this.stopRing.material.dispose(); this.layer.removeFromParent();
  }
}
