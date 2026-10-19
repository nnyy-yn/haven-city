import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { type CityEventKind, type GameState } from './types';

interface MarkerRecord { id: number; kind: CityEventKind; buildingId: number; key: string; root: THREE.Group; badge: THREE.Group; flames?: THREE.InstancedMesh; cores?: THREE.InstancedMesh; smoke?: THREE.InstancedMesh }
export interface EventMarkerInfo { readonly id: number; readonly kind: CityEventKind; readonly buildingId: number; readonly x: number; readonly y: number; readonly z: number }
const palette: Record<CityEventKind, string> = { fire: '#d96545', outage: '#d5a34f', festival: '#5a9b78', training: '#6599b5' };

/** View-only event adapters. Templates share geometry/materials; pending records own transforms. */
export class CityEventVisuals {
  private layer = new THREE.Group();
  private records = new Map<number, MarkerRecord>();
  private templates = new Map<CityEventKind, THREE.Group>();
  private geometries = new Set<THREE.BufferGeometry>();
  private materials = new Set<THREE.Material>();
  private clock = 0;
  private dummy = new THREE.Object3D();
  private box = new THREE.Box3();
  private puff = this.geometry(new THREE.IcosahedronGeometry(1, 1));
  private flameMaterial = this.material(new THREE.MeshBasicMaterial({ color: '#e87635', transparent: true, opacity: .8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  private coreMaterial = this.material(new THREE.MeshBasicMaterial({ color: '#f3d17e', transparent: true, opacity: .86, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  private smokeMaterial = this.material(new THREE.MeshStandardMaterial({ color: '#718079', transparent: true, opacity: .24, roughness: 1, depthWrite: false }));

  constructor(private scene: THREE.Scene) { this.layer.name = 'City event markers'; this.scene.add(this.layer); }
  private geometry<T extends THREE.BufferGeometry>(g: T) { this.geometries.add(g); return g; }
  private material<T extends THREE.Material>(m: T) { this.materials.add(m); return m; }

  private template(kind: CityEventKind) {
    let template = this.templates.get(kind); if (template) return template;
    template = new THREE.Group();
    const color = new THREE.Color(palette[kind]);
    const shell = this.material(new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .28, roughness: .44, metalness: .1 }));
    const white = this.material(new THREE.MeshBasicMaterial({ color: '#fff1d2', toneMapped: false }));
    const body = new THREE.IcosahedronGeometry(1.2, 2).translate(0, .3, 0);
    const tipSource = new THREE.ConeGeometry(.42, 1.12, 10), tip = tipSource.toNonIndexed().rotateX(Math.PI).translate(0, -.96, 0); tipSource.dispose();
    const shellGeometry = this.geometry(mergeGeometries([body, tip], false)!); body.dispose(); tip.dispose(); template.add(new THREE.Mesh(shellGeometry, shell));
    const iconPieces: THREE.BufferGeometry[] = [];
    const piece = (g: THREE.BufferGeometry, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rz = 0) => {
      const raw = g.index ? g.toNonIndexed() : g.clone(); g.dispose();
      raw.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rz)), new THREE.Vector3(sx, sy, sz))); iconPieces.push(raw);
    };
    const shape = new THREE.Shape();
    if (kind === 'outage') {
      shape.moveTo(.12, .99); shape.lineTo(-.5, .22); shape.lineTo(-.08, .22); shape.lineTo(-.2, -.5); shape.lineTo(.52, .42); shape.lineTo(.1, .42); shape.closePath();
      piece(new THREE.ExtrudeGeometry(shape, { depth: .055, bevelEnabled: false }), 0, 0, 1.06);
    } else if (kind === 'fire') {
      shape.moveTo(0, -.36); shape.bezierCurveTo(-.64, -.26, -.58, .2, -.2, .58); shape.quadraticCurveTo(-.16, .13, .06, .35); shape.quadraticCurveTo(.35, .7, .12, 1.0); shape.bezierCurveTo(.86, .34, .64, -.23, 0, -.36); shape.closePath();
      piece(new THREE.ExtrudeGeometry(shape, { depth: .055, bevelEnabled: false, curveSegments: 8 }), 0, -.04, 1.06);
    } else if (kind === 'festival') {
      for (const [x, y, r] of [[0, .66, .2], [-.48, .42, .15], [.48, .42, .15]]) { piece(new THREE.SphereGeometry(r, 8, 6), x, y, 1.08); piece(new THREE.CapsuleGeometry(r * .7, .2, 3, 6), x, y - .42, 1.08); }
    } else {
      piece(new THREE.BoxGeometry(.54, .77, .07), -.3, .3, 1.07, 1, 1, 1, .13); piece(new THREE.BoxGeometry(.54, .77, .07), .3, .3, 1.07, 1, 1, 1, -.13);
      piece(new THREE.BoxGeometry(.04, .75, .09), 0, .25, 1.11);
    }
    // Repeat the icon on the back so first-person approaches remain legible.
    const front = mergeGeometries(iconPieces, false)!; iconPieces.forEach(g => g.dispose());
    const back = front.clone().rotateY(Math.PI); const merged = this.geometry(mergeGeometries([front, back], false)!); front.dispose(); back.dispose();
    template.add(new THREE.Mesh(merged, white));
    // One subtle ring anchors the pin; no light or DOM overlay is required.
    const ring = new THREE.Mesh(this.geometry(new THREE.RingGeometry(1.33, 1.48, 40)), this.material(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .55, side: THREE.DoubleSide, depthWrite: false, toneMapped: false })));
    ring.rotation.x = -Math.PI / 2; ring.position.y = -1.6; template.add(ring);
    template.name = `${kind} event pin`; this.templates.set(kind, template); return template;
  }

  sync(state: GameState, buildings: ReadonlyMap<number, THREE.Group>) {
    const pending = state.civic.events.filter(e => e.status === 'pending' && e.buildingId !== null && buildings.has(e.buildingId));
    const ids = new Set(pending.map(e => e.id));
    for (const [id, record] of this.records) if (!ids.has(id)) { this.release(record); this.records.delete(id); }
    for (const event of pending) {
      const building = buildings.get(event.buildingId!)!, key = `${event.kind}:${event.buildingId}:${building.uuid}`;
      if (this.records.get(event.id)?.key === key) continue;
      const old = this.records.get(event.id); if (old) this.release(old);
      const root = new THREE.Group(), badge = this.template(event.kind).clone(true);
      this.box.setFromObject(building); const top = Math.max(.7, this.box.max.y);
      const roof = typeof building.userData.roofHeight === 'number' ? building.position.y + building.userData.roofHeight * building.scale.y : top;
      root.position.set(building.position.x, (event.kind === 'fire' ? roof : top) + .2, building.position.z); badge.position.y = 3.5; root.add(badge);
      const record: MarkerRecord = { id: event.id, kind: event.kind, buildingId: event.buildingId!, key, root, badge };
      if (event.kind === 'fire') {
        record.flames = new THREE.InstancedMesh(this.puff, this.flameMaterial, 5); record.cores = new THREE.InstancedMesh(this.puff, this.coreMaterial, 4); record.smoke = new THREE.InstancedMesh(this.puff, this.smokeMaterial, 6);
        for (const mesh of [record.flames, record.cores, record.smoke]) { mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(mesh); }
        record.smoke.renderOrder = 2; badge.position.y = 6.7;
      }
      // This layer is outside every building group. Never copy a buildingId onto it.
      root.traverse(o => { o.userData.eventId = event.id; o.userData.eventKind = event.kind; });
      root.name = `Pending city event ${event.id}`; this.layer.add(root); this.records.set(event.id, record);
    }
    this.update(0, true);
  }

  update(dt: number, paused: boolean) {
    if (!paused && Number.isFinite(dt)) this.clock += Math.max(0, dt);
    for (const record of this.records.values()) {
      const time = this.clock, phase = record.id * 1.37;
      record.badge.position.y = (record.kind === 'fire' ? 6.7 : 3.5) + Math.sin(time * 1.8 + phase) * .15;
      record.badge.rotation.y = .5 + Math.sin(time * .45 + phase) * .09;
      record.badge.scale.setScalar(1 + Math.sin(time * 2.2 + phase) * .025);
      if (!record.flames || !record.cores || !record.smoke) continue;
      for (let i = 0; i < 5; i++) {
        const a = i * 2.4, flicker = .9 + Math.sin(time * (7 + i) + phase + i) * .17;
        this.dummy.position.set(Math.cos(a) * .65, 1.1 * flicker, Math.sin(a) * .6); this.dummy.scale.set(.33 + i % 2 * .1, (1.0 + i % 3 * .16) * flicker, .35); this.dummy.rotation.set(.04 * Math.sin(time * 4 + i), time * .15 + i, .04 * Math.cos(time * 3 + i)); this.dummy.updateMatrix(); record.flames.setMatrixAt(i, this.dummy.matrix);
        if (i < 4) { this.dummy.position.y *= .64; this.dummy.scale.multiplyScalar(.6); this.dummy.updateMatrix(); record.cores.setMatrixAt(i, this.dummy.matrix); }
      }
      for (let i = 0; i < 6; i++) {
        const t = ((time * .12 + i / 6 + phase * .03) % 1 + 1) % 1, puff = .3 + t * .68;
        this.dummy.position.set(Math.sin(i * 2.7 + t * 3) * .35 + t * .75, 1.6 + t * 4.8, Math.cos(i * 1.8) * .36); this.dummy.scale.set(puff, puff * .95, puff * .85); this.dummy.rotation.set(i, i * .3 + time * .04, 0); this.dummy.updateMatrix(); record.smoke.setMatrixAt(i, this.dummy.matrix);
      }
      for (const mesh of [record.flames, record.cores, record.smoke]) { mesh.instanceMatrix.needsUpdate = true; mesh.boundingSphere = null; }
    }
  }

  getMarkers(): readonly EventMarkerInfo[] { return [...this.records.values()].map(r => Object.freeze({ id: r.id, kind: r.kind, buildingId: r.buildingId, x: r.root.position.x, y: r.root.position.y + r.badge.position.y, z: r.root.position.z })); }
  private release(record: MarkerRecord) { this.layer.remove(record.root); record.flames?.dispose(); record.cores?.dispose(); record.smoke?.dispose(); }
  dispose() { this.records.forEach(r => this.release(r)); this.records.clear(); this.scene.remove(this.layer); this.geometries.forEach(g => g.dispose()); this.materials.forEach(m => m.dispose()); this.templates.clear(); }
}
