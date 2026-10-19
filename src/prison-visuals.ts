import * as THREE from 'three';
import { getPrisonOperations, type PrisonSiteOperations } from './prison';
import type { GameState } from './types';

type DisplayActivity = PrisonSiteOperations['activity'] | 'idle';
type ActorRole = 'prisoner' | 'guard' | 'counselor';
interface SiteRecord { operation: PrisonSiteOperations; group: THREE.Group }
interface ActorInfo { buildingId: number; role: ActorRole; x: number; y: number; z: number; yaw: number; pose: string }
interface SiteInfo {
  buildingId: number; geometryId: string; floors: number; level: number; x: number; z: number;
  facilities: PrisonSiteOperations['facilities']; guards: number; counselors: number; prisoners: number;
  operational: boolean; supplied: boolean; status: string; phase: string; activity: PrisonSiteOperations['activity'];
  displayActivity: DisplayActivity; actorCount: number; visiblePrisoners: number; visibleGuards: number; visibleCounselors: number;
  warning: 'none' | 'watch' | 'alert' | 'offline';
}

const patrol = [[-2.09, .25], [.79, .25], [1.24, 1.61], [2.49, 2.55], [2.49, 3.66], [-2.09, 3.66], [-2.09, .25]];
const lengths = [0];
for (let i = 1; i < patrol.length; i++) lengths.push(lengths[i - 1] + Math.hypot(patrol[i][0] - patrol[i - 1][0], patrol[i][1] - patrol[i - 1][1]));
const patrolLength = lengths.at(-1)!;
function onPatrol(distance: number) {
  const d = ((distance % patrolLength) + patrolLength) % patrolLength;
  let i = 1; while (i < patrol.length - 1 && lengths[i] < d) i++;
  const from = patrol[i - 1], to = patrol[i], t = (d - lengths[i - 1]) / (lengths[i] - lengths[i - 1]);
  return { x: THREE.MathUtils.lerp(from[0], to[0], t), z: THREE.MathUtils.lerp(from[1], to[1], t), yaw: Math.atan2(to[0] - from[0], to[1] - from[1]) };
}

/** A view of aggregate operations, with representative actors rather than simulated residents. */
export class PrisonVisuals {
  private layer = new THREE.Group();
  private sources: THREE.InstancedMesh[];
  private people: THREE.InstancedMesh[] = [];
  private books: THREE.InstancedMesh;
  private signals: THREE.InstancedMesh;
  private bookGeometry = new THREE.BoxGeometry(.29, .045, .23);
  private bookMaterial = new THREE.MeshStandardMaterial({ color: '#d4c9a8', roughness: .9 });
  private signalGeometry = new THREE.SphereGeometry(.095, 8, 6);
  private signalMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
  private capacity = 0;
  private records: SiteRecord[] = [];
  private sites: SiteInfo[] = [];
  private actors: ActorInfo[] = [];
  private time = 0;
  private dummy = new THREE.Object3D();
  private position = new THREE.Vector3();
  private color = new THREE.Color();
  private bookCount = 0;
  private actorCount = 0;
  private signalCount = 0;

  constructor(scene: THREE.Scene, personSources: THREE.InstancedMesh[]) {
    this.sources = personSources;
    this.books = new THREE.InstancedMesh(this.bookGeometry, this.bookMaterial, 1);
    this.signals = new THREE.InstancedMesh(this.signalGeometry, this.signalMaterial, 1);
    this.layer.name = 'Correction center activities and staff'; scene.add(this.layer);
    this.resize(8);
  }

  private resize(required: number) {
    if (required <= this.capacity) return;
    this.people.forEach(mesh => { mesh.removeFromParent(); mesh.dispose(); });
    this.books.removeFromParent(); this.books.dispose(); this.signals.removeFromParent(); this.signals.dispose();
    this.capacity = Math.max(8, required, this.capacity * 2);
    this.people = this.sources.map(source => new THREE.InstancedMesh(source.geometry, source.material, this.capacity));
    this.books = new THREE.InstancedMesh(this.bookGeometry, this.bookMaterial, this.capacity);
    this.signals = new THREE.InstancedMesh(this.signalGeometry, this.signalMaterial, this.capacity);
    for (const mesh of [...this.people, this.books, this.signals]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; mesh.count = 0; mesh.visible = false;
      mesh.raycast = () => {}; this.layer.add(mesh);
    }
    this.people.forEach(mesh => { mesh.castShadow = true; mesh.receiveShadow = true; });
    this.books.castShadow = true;
  }

  sync(state: GameState, buildings: ReadonlyMap<number, THREE.Group>) {
    this.records = getPrisonOperations(state).sites.flatMap(operation => {
      const group = buildings.get(operation.buildingId);
      return group ? [{ operation, group }] : [];
    });
    this.resize(this.records.length * 7);
    // Deletions also clear instance counts immediately, before the next animation frame.
    this.update(0, state);
  }

  update(dt: number, state: GameState) {
    const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.time += step * state.speed;
    this.actorCount = 0; this.bookCount = 0; this.signalCount = 0; this.actors = []; this.sites = [];
    for (const { operation: op, group } of this.records) {
      const activity: DisplayActivity = !op.operational ? 'idle' : op.activity === 'work' && op.facilities.workshop === 0 ? 'recreation' : op.activity;
      const inmates = activity !== 'rest' && activity !== 'idle' ? Math.min(4, op.prisoners) : 0;
      const guards = Math.min(op.operational ? 2 : 1, op.guards);
      const counselors = op.operational && activity !== 'rest' ? Math.min(1, op.counselors) : 0;
      for (let i = 0; i < inmates; i++) {
        if (activity === 'education' || activity === 'meal') {
          this.actor(op.buildingId, group, 'prisoner', i, i % 2 ? .2 : -.95, i < 2 ? 1.49 : 2.94, i < 2 ? 0 : Math.PI, 'seated', activity === 'education');
        } else if (activity === 'work') {
          this.actor(op.buildingId, group, 'prisoner', i, i < 2 ? 1.52 : 1.35, i < 2 ? .4 + i * .6 : 1.85 + (i - 2) * .59, Math.PI / 2, i < 2 ? 'working' : 'standing');
        } else {
          const at = onPatrol(this.time * .43 + i * patrolLength / Math.max(1, inmates) + 1.6);
          this.actor(op.buildingId, group, 'prisoner', i, at.x, at.z, at.yaw, 'walking');
        }
      }
      for (let i = 0; i < guards; i++) {
        const at = op.operational ? onPatrol(this.time * .74 + i * patrolLength / Math.max(1, guards) + .8) : { x: -.77, z: 3.59, yaw: 0 };
        this.actor(op.buildingId, group, 'guard', i, at.x, at.z, at.yaw, op.operational ? 'walking' : 'standing');
      }
      for (let i = 0; i < counselors; i++) this.actor(op.buildingId, group, 'counselor', i, -1.64, .68, .5, activity === 'education' ? 'teaching' : 'standing', activity === 'education');
      const warning = state.prison.unrest >= 65 ? 'alert' : !op.operational ? 'offline' : state.prison.unrest >= 35 || op.guardCoverage < 1 ? 'watch' : 'none';
      this.color.set(warning === 'alert' ? '#e98764' : warning === 'watch' || warning === 'offline' ? '#d8b569' : '#90bfa2');
      const pulse = warning === 'alert' ? .82 + Math.sin(this.time * 4.6) * .25 : warning === 'watch' ? .93 + Math.sin(this.time * 2.4) * .12 : 1;
      for (const [x, y, z] of [[-.87, 2.77, 4.46], [.87, 2.77, 4.46], [3.55, 6.43, 3.42]]) {
        this.position.set(x, y, z).applyMatrix4(group.matrixWorld); this.dummy.position.copy(this.position); this.dummy.rotation.set(0, 0, 0); this.dummy.scale.setScalar(pulse); this.dummy.updateMatrix();
        this.signals.setMatrixAt(this.signalCount, this.dummy.matrix); this.signals.setColorAt(this.signalCount++, this.color);
      }
      this.sites.push({ buildingId: op.buildingId, geometryId: group.uuid, floors: group.userData.prisonFloors ?? op.level + 1, level: op.level, x: group.position.x, z: group.position.z,
        facilities: { ...op.facilities }, guards: op.guards, counselors: op.counselors, prisoners: op.prisoners,
        operational: op.operational, supplied: op.supplied, status: op.status, phase: op.phase, activity: op.activity,
        displayActivity: activity, actorCount: inmates + guards + counselors, visiblePrisoners: inmates, visibleGuards: guards, visibleCounselors: counselors, warning });
    }
    for (const mesh of this.people) this.commit(mesh, this.actorCount);
    this.commit(this.books, this.bookCount); this.commit(this.signals, this.signalCount);
  }

  private actor(buildingId: number, group: THREE.Group, role: ActorRole, offset: number, x: number, z: number, yaw: number, pose: string, reading = false) {
    const standing = pose !== 'seated', base = standing ? .31 : -.06, s = role === 'prisoner' ? .78 : .82;
    const stride = pose === 'walking' ? Math.sin(this.time * 6.7 + offset * 2.1) * .35 : 0;
    const arm = pose === 'working' ? -.95 + Math.sin(this.time * 3.3 + offset) * .12 : reading ? -.93 : 0;
    const offsets = [[0, 1.12, 0], [0, 1.67, 0], [0, 1.81, -.02], [-.135, .88, 0], [.135, .88, 0], [-.32, 1.39, 0], [.32, 1.39, 0]];
    const buildingYaw = group.rotation.y;
    this.position.set(x, base, z).applyMatrix4(group.matrixWorld);
    this.actors.push({ buildingId, role, x: this.position.x, y: this.position.y, z: this.position.z, yaw: yaw + buildingYaw, pose });
    for (let j = 0; j < this.people.length; j++) {
      const [ox, oy, oz] = offsets[j];
      this.position.set(x + (ox * Math.cos(yaw) + oz * Math.sin(yaw)) * s, base + oy * s, z + (-ox * Math.sin(yaw) + oz * Math.cos(yaw)) * s).applyMatrix4(group.matrixWorld);
      this.dummy.position.copy(this.position);
      const angle = j < 3 ? 0 : j < 5 ? standing ? (j % 2 ? stride : -stride) : -1.38 : reading || pose === 'working' ? arm : (j % 2 ? stride : -stride) * .68;
      this.dummy.rotation.set(angle, yaw + buildingYaw, 0); this.dummy.scale.setScalar(s); this.dummy.updateMatrix(); this.people[j].setMatrixAt(this.actorCount, this.dummy.matrix);
    }
    this.color.set(role === 'guard' ? '#526c7a' : role === 'counselor' ? '#91a38b' : '#b68b67');
    this.people[0].setColorAt(this.actorCount, this.color); this.actorCount++;
    if (reading) {
      this.position.set(x + Math.sin(yaw) * .28, base + 1.18 * s, z + Math.cos(yaw) * .28).applyMatrix4(group.matrixWorld);
      this.dummy.position.copy(this.position); this.dummy.rotation.set(-.3, yaw + buildingYaw, 0); this.dummy.scale.setScalar(.85); this.dummy.updateMatrix(); this.books.setMatrixAt(this.bookCount++, this.dummy.matrix);
    }
  }

  private commit(mesh: THREE.InstancedMesh, count: number) {
    mesh.count = count; mesh.visible = count > 0; mesh.instanceMatrix.needsUpdate = true; mesh.boundingSphere = null;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  getDiagnostics() { return { actorCount: this.actorCount, bookCount: this.bookCount, signalCount: this.signalCount, clock: this.time,
    sites: this.sites.map(site => ({ ...site, facilities: { ...site.facilities } })), actors: this.actors.map(actor => ({ ...actor })) }; }

  dispose() {
    this.people.forEach(mesh => mesh.dispose()); this.books.dispose(); this.signals.dispose();
    this.bookGeometry.dispose(); this.bookMaterial.dispose(); this.signalGeometry.dispose(); this.signalMaterial.dispose();
    this.layer.removeFromParent(); this.records = []; this.sites = []; this.actors = [];
  }
}
