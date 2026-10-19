import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cellToWorld, TILE, type Building, type BuildingKind, type CameraMode, type GameState } from './types';
import { CityEventVisuals } from './city-events';
import { DistrictBatch } from './district-batch';
import { TransitVisuals } from './transit-visuals';

const C = {
  grass: '#74865b', grassLight: '#92a273', path: '#d4cbb6', concrete: '#c3c5bc', asphalt: '#3c474a',
  line: '#e4dfcd', glass: '#517988', dark: '#34444b', white: '#eeece3', wood: '#8a6246', sea: '#5899a1',
};
const clamp = THREE.MathUtils.clamp;
function rand(seed: number) { const v = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); }
const materials = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, roughness = .8, metalness = 0) {
  const key = color + roughness + metalness;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    const windows = ['#517988', '#6f9b9f', '#c8d4ca', '#8aa7a5'];
    const lamps = ['#efe6c1', '#eadfbb', '#e5dcba', '#eadfbb', '#f5e5ba'];
    if (windows.includes(color)) { m.emissive.set('#e4bb79'); m.emissiveIntensity = 0; m.userData.nightIntensity = .68; }
    if (lamps.includes(color)) { m.emissive.set('#ffd194'); m.emissiveIntensity = 0; m.userData.nightIntensity = 1.6; }
    if (color === '#416d7c' || color === '#6e939c') { m.emissive.set('#669aa6'); m.emissiveIntensity = 0; m.userData.nightIntensity = .065; }
    materials.set(key, m);
  }
  return m;
}
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
const ballGeo = new THREE.IcosahedronGeometry(1, 1);
const planeGeo = new THREE.PlaneGeometry(1, 1);
const m4 = new THREE.Matrix4();
const q4 = new THREE.Quaternion();
const vec = new THREE.Vector3();
const scale = new THREE.Vector3();
const euler = new THREE.Euler();

/** A material batch keeps the district detailed without one draw call per window. */
class Batch {
  parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
    euler.set(rx, ry, rz); q4.setFromEuler(euler); vec.set(x, y, z); scale.set(sx, sy, sz); m4.compose(vec, q4, scale);
    const source = geo.clone();
    const g = source.index ? source.toNonIndexed() : source;
    if (source !== g) source.dispose();
    g.applyMatrix4(m4);
    const list = this.parts.get(material) || []; list.push(g); this.parts.set(material, list);
  }
  box(material: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, ry = 0) { this.add(boxGeo, material, x, y, z, w, h, d, 0, ry); }
  cylinder(material: THREE.Material, x: number, y: number, z: number, r: number, h: number, rx = 0, rz = 0) { this.add(cylGeo, material, x, y, z, r, h, r, rx, 0, rz); }
  sphere(material: THREE.Material, x: number, y: number, z: number, sx: number, sy = sx, sz = sx) { this.add(ballGeo, material, x, y, z, sx, sy, sz); }
  finish(parent: THREE.Object3D, cast = true) {
    for (const [material, geos] of this.parts) {
      const merged = mergeGeometries(geos, false);
      if (merged) { const mesh = new THREE.Mesh(merged, material); mesh.castShadow = cast; mesh.receiveShadow = true; parent.add(mesh); }
      geos.forEach(g => g.dispose());
    }
    this.parts.clear();
  }
}

const signs = new Map<string, THREE.MeshStandardMaterial>();
function sign(label: string, bg: string, ink = '#f6f3df') {
  const key = label + bg + ink;
  let m = signs.get(key);
  if (!m) {
    const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 144;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 768, 144); ctx.fillStyle = ink;
    ctx.font = '600 64px "Microsoft YaHei", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, 384, 77);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
    m = new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: '#fff0ca', emissiveIntensity: 0, roughness: .7 }); signs.set(key, m);
  }
  return m;
}
function addSign(batch: Batch, label: string, bg: string, y: number, z: number, w = 6, h = .85) { batch.add(planeGeo, sign(label, bg), 0, y, z, w, h, 1); }
function pitchedRoof(batch: Batch, material: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number) {
  const shape = new THREE.Shape(); shape.moveTo(-w / 2, 0); shape.lineTo(0, h); shape.lineTo(w / 2, 0); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false }); geo.translate(0, 0, -d / 2);
  batch.add(geo, material, x, y, z); geo.dispose();
}
function tree(batch: Batch, x: number, z: number, s = 1, seed = 1) {
  const trunk = mat('#77664b'), leaf = mat(['#5b7754', '#758951', '#56765e', '#82935e'][Math.floor(rand(seed) * 4)]);
  batch.cylinder(trunk, x, 1.3 * s, z, .15 * s, 2.5 * s);
  batch.sphere(leaf, x, 3.0 * s, z, 1.3 * s, 1.8 * s, 1.3 * s);
  batch.sphere(leaf, x + .65 * s, 2.65 * s, z + .3 * s, .9 * s, 1.15 * s, 1.0 * s);
  batch.sphere(leaf, x - .6 * s, 2.6 * s, z - .25 * s, .95 * s, 1.1 * s, .9 * s);
}
function bench(batch: Batch, x: number, z: number, angle = 0) {
  batch.box(mat(C.wood), x, .65, z, 1.7, .14, .55, angle);
  const dx = Math.sin(angle) * .24, dz = Math.cos(angle) * .24;
  batch.box(mat(C.wood), x - dx, 1.0, z - dz, 1.7, .5, .1, angle);
  for (const side of [-1, 1]) { const ox = Math.cos(angle) * .6 * side, oz = -Math.sin(angle) * .6 * side; batch.box(mat(C.dark), x + ox, .32, z + oz, .12, .6, .42, angle); }
}
function hedge(batch: Batch, x: number, z: number, w: number, d: number, h = .65) { batch.box(mat('#64794e'), x, h / 2 + .1, z, w, h, d); }
function grassMaterial() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 768;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#73865b'; ctx.fillRect(0, 0, 768, 768);
  // Large, translucent patches and fine grain make grass read as a living surface.
  for (let i = 0; i < 1300; i++) {
    const x = rand(i + 9) * 768, y = rand(i + 2009) * 768, radius = 8 + rand(i + 3009) * 66;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, i % 3 ? 'rgba(184,182,119,.065)' : 'rgba(55,92,56,.11)'); gradient.addColorStop(1, 'rgba(110,130,85,0)');
    ctx.fillStyle = gradient; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  const image = ctx.getImageData(0, 0, 768, 768);
  for (let i = 0; i < image.data.length; i += 4) { const n = (rand(i + 70) - .5) * 11; image.data[i] += n; image.data[i + 1] += n; image.data[i + 2] += n; }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(3, 3); texture.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ map: texture, roughness: 1 });
}
function windows(batch: Batch, w: number, height: number, d: number, floors: number, columns: number, glass = mat(C.glass, .24, .35), balconies = false, centerZ = 0) {
  const trim = mat('#d8d8ca');
  for (let f = 0; f < floors; f++) {
    const y = 2.1 + f * ((height - 2.8) / Math.max(1, floors - 1));
    for (let c = 0; c < columns; c++) {
      const x = (c - (columns - 1) / 2) * (w / columns);
      const ww = w / columns * .64;
      batch.box(glass, x, y, centerZ + d / 2 + .035, ww, 1.3, .08);
      batch.box(glass, x, y, centerZ - d / 2 - .035, ww, 1.3, .08);
      if (balconies && f > 0 && c % 2 === 0) {
        batch.box(trim, x, y - .7, centerZ + d / 2 + .4, ww + .25, .15, .8);
        batch.box(mat('#6a7878'), x, y - .3, centerZ + d / 2 + .8, ww + .2, .12, .05);
        for (const offset of [-.4, .4]) batch.box(mat('#6a7878'), x + offset * ww, y - .45, centerZ + d / 2 + .8, .04, .55, .05);
      }
    }
    for (const side of [-1, 1]) for (const z of [-d * .26, d * .26]) batch.box(glass, side * (w / 2 + .035), y, z + centerZ, .08, 1.3, 1.35);
  }
}
function solar(batch: Batch, x: number, y: number, z: number, w = 2.4, d = 1.6) {
  batch.box(mat('#d6d9d1'), x, y, z, w + .12, .16, d + .12);
  batch.box(mat('#334e68', .28, .5), x, y + .1, z, w, .08, d);
  for (let i = 1; i < 4; i++) batch.box(mat('#859ca6'), x - w / 2 + w * i / 4, y + .15, z, .025, .015, d);
}

interface PersonRig { group: THREE.Group; arms: THREE.Object3D[]; legs: THREE.Object3D[] }
interface TrafficNode { x:number; z:number; neighbours:string[] }
interface TrafficVehicle { from:string; to:string; previous:string; progress:number; yaw:number; turns:number }
function makePlayer(): PersonRig {
  const group = new THREE.Group(); const body = new Batch();
  body.box(mat('#e4d2b3'), 0, 1.36, 0, .44, .62, .28);
  body.box(mat('#567f81'), 0, 1.34, .015, .49, .6, .31);
  body.sphere(mat('#e5ba95'), 0, 1.91, 0, .22, .27, .22);
  body.sphere(mat('#34302b'), 0, 2.05, -.035, .23, .16, .23);
  body.box(mat('#f3f0df'), 0, 1.58, .17, .15, .12, .03); body.finish(group);
  const arms: THREE.Object3D[] = [], legs: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(side * .33, 1.59, 0);
    const a = new Batch(); a.box(mat('#567f81'), 0, -.16, 0, .18, .34, .23); a.box(mat('#e5ba95'), 0, -.44, 0, .14, .3, .16); a.finish(arm); group.add(arm); arms.push(arm);
    const leg = new THREE.Group(); leg.position.set(side * .14, 1.04, 0);
    const l = new Batch(); l.box(mat('#33464d'), 0, -.43, 0, .21, .82, .24); l.box(mat('#eee9dc'), 0, -.88, .07, .23, .15, .38); l.finish(leg); group.add(leg); legs.push(leg);
  }
  return { group, arms, legs };
}

function makeBus() {
  const group = new THREE.Group(), bus = new Batch();
  const teal = mat('#477f7b'), cream = mat('#e7e5d6'), dark = mat(C.dark), glazing = mat('#365662', .25, .3);
  glazing.emissive.set('#e4bb79'); glazing.userData.nightIntensity = .14;
  bus.box(dark, 0, .56, 0, 2.1, .3, 6.5);
  bus.box(teal, 0, 1.03, 0, 2.2, 1.05, 6.8); bus.box(cream, 0, 2.0, 0, 2.18, 1.25, 6.7);
  bus.box(teal, 0, 1.33, 0, 2.23, .18, 6.82);
  for (const side of [-1, 1]) {
    bus.box(glazing, side * 1.105, 2.03, -.15, .045, .85, 5.85);
    for (let z = -2.78; z < 3.05; z += .96) bus.box(cream, side * 1.135, 2.04, z, .05, .94, .075);
    bus.box(teal, side * 1.12, 2.63, 0, .06, .18, 6.65);
    for (const z of [-2.25, 2.25]) {
      bus.cylinder(dark, side * 1.1, .46, z, .43, .18, 0, Math.PI / 2);
      bus.cylinder(cream, side * 1.2, .46, z, .22, .035, 0, Math.PI / 2);
    }
    bus.box(dark, side * 1.24, 2.43, 2.72, .27, .06, .07); bus.box(cream, side * 1.37, 2.28, 2.74, .12, .37, .24);
    bus.box(cream, side * 1.14, .91, -.7, .035, .11, 2.25);
  }
  bus.box(glazing, 0, 2.03, 3.37, 1.96, .94, .065); bus.box(glazing, 0, 2.1, -3.37, 1.83, .76, .06);
  bus.box(dark, -.46, 1.77, 3.42, .04, .02, .48, -.18); bus.box(dark, .46, 1.77, 3.42, .04, .02, .48, -.18);
  bus.box(cream, 0, 2.79, 0, 2.22, .2, 6.9); bus.box(teal, 0, 2.93, -.65, 1.48, .18, 2.1);
  for (let z = -1.4; z < .2; z += .19) bus.box(dark, 0, 3.04, z, 1.05, .025, .06);
  bus.box(dark, 1.15, 1.47, 1.72, .065, 1.75, 1.13); bus.box(glazing, 1.19, 1.67, 1.72, .035, 1.26, .93);
  bus.box(cream, 1.215, 1.6, 1.72, .025, 1.55, .06);
  for (const side of [-1, 1]) {
    bus.box(mat('#f5e5ba'), side * .78, .93, 3.43, .34, .2, .055);
    bus.box(mat('#9c5347'), side * .83, .94, -3.43, .16, .4, .045);
  }
  bus.box(dark, 0, .75, 3.43, .95, .18, .06); bus.box(cream, 0, .91, -3.44, .55, .17, .04);
  addSign(bus, '01 · 栖 湾 公 交', '#294c47', 2.58, 3.425, 1.88, .25);
  bus.finish(group); return group;
}

export class CityWorld {
  scene = new THREE.Scene();
  ground: THREE.Object3D;
  buildingMeshes = new Map<number, THREE.Group>();
  player: THREE.Group;
  private playerRig: PersonRig;
  private buildingKeys = new Map<number, string>();
  private scenery = new THREE.Group();
  private streetFurniture = new THREE.Group();
  private vacantLots = new THREE.Group();
  private roadSignature = '';
  private parcelSignature = '';
  private selection: THREE.Mesh;
  private ghost: THREE.Group;
  private selectedId: number | null = null;
  private time = 0;
  private walkTime = 0;
  private lastPlayer = new THREE.Vector2();
  private people: THREE.InstancedMesh[] = [];
  private cars: THREE.InstancedMesh[] = [];
  private waterUniform = { value: 0 };
  private trafficGraph = new Map<string,TrafficNode>();
  private vehicles:TrafficVehicle[]=[];
  private dummy = new THREE.Object3D();
  private seagulls: THREE.Group[] = [];
  private sun: THREE.DirectionalLight;
  private ambient: THREE.HemisphereLight;
  private eventVisuals: CityEventVisuals;
  private districtBatch: DistrictBatch;
  private transitVisuals: TransitVisuals;
  private lightPools = new THREE.Group();
  private streetPools = new THREE.Group();
  private lightPoolMaterial: THREE.MeshBasicMaterial;
  private daySky = new THREE.Color('#b7cfd7');
  private nightSky = new THREE.Color('#172d43');
  private warmSun = new THREE.Color('#fff0cc');
  private moonSun = new THREE.Color('#a8b8d0');
  private dayAmbient = new THREE.Color('#d6edf1');
  private nightAmbient = new THREE.Color('#a6b8d0');
  private dayGroundLight = new THREE.Color('#72755f');
  private nightGroundLight = new THREE.Color('#626975');

  constructor() {
    const glow = document.createElement('canvas'); glow.width = glow.height = 128; const context = glow.getContext('2d')!;
    const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 64); gradient.addColorStop(0, 'rgba(255,235,184,.8)'); gradient.addColorStop(.35, 'rgba(255,218,152,.42)'); gradient.addColorStop(1, 'rgba(255,204,136,0)'); context.fillStyle = gradient; context.fillRect(0, 0, 128, 128);
    const glowTexture = new THREE.CanvasTexture(glow); glowTexture.colorSpace = THREE.SRGBColorSpace;
    this.lightPoolMaterial = new THREE.MeshBasicMaterial({ map: glowTexture, color: '#ffcf91', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.scene.background = new THREE.Color('#b7cfd7');
    this.scene.fog = new THREE.Fog('#c5d7da', 200, 760);
    const hemi = new THREE.HemisphereLight('#d6edf1', '#72755f', 1.65); this.ambient = hemi; this.scene.add(hemi);
    const sun = new THREE.DirectionalLight('#fff0cc', 3.25); sun.position.set(-75, 145, 80);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -180; sun.shadow.camera.right = 180;
    sun.shadow.camera.top = 180; sun.shadow.camera.bottom = -180; sun.shadow.camera.near = 1; sun.shadow.camera.far = 450;
    sun.shadow.normalBias = .055; sun.shadow.bias = -.00015; sun.shadow.radius = 3; this.sun = sun; this.scene.add(sun);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(360, 340), grassMaterial());
    ground.rotation.x = -Math.PI / 2; ground.position.set(-55, 0, 0); ground.receiveShadow = true;
    ground.userData.ground = true; this.ground = ground; this.lightPools.add(this.streetPools); this.scene.add(ground, this.scenery, this.streetFurniture, this.vacantLots, this.lightPools);
    this.createCoast(); this.createLandscape(); this.createPeople();
    this.playerRig = makePlayer(); this.player = this.playerRig.group; this.player.scale.setScalar(.86); this.scene.add(this.player);
    this.selection = new THREE.Mesh(new THREE.RingGeometry(4.6, 4.78, 64), new THREE.MeshBasicMaterial({ color: '#f2d390', transparent: true, opacity: .9, depthWrite: false }));
    this.selection.rotation.x = -Math.PI / 2; this.selection.position.y = .23; this.selection.visible = false; this.scene.add(this.selection);
    this.ghost = new THREE.Group();
    const fill = new THREE.Mesh(new THREE.BoxGeometry(9.7, .12, 9.7), new THREE.MeshBasicMaterial({ color: '#b7e5c9', transparent: true, opacity: .42, depthWrite: false }));
    fill.position.y = .16; this.ghost.add(fill);
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(9.7, .15, 9.7)), new THREE.LineBasicMaterial({ color: '#d6ffe4', transparent: true, opacity: .9 }));
    outline.position.y = .18; this.ghost.add(outline); this.ghost.visible = false; this.scene.add(this.ghost);
    this.createCars(); this.eventVisuals = new CityEventVisuals(this.scene);
    this.districtBatch = new DistrictBatch(this.scene); this.transitVisuals = new TransitVisuals(this.scene, makeBus());
  }

  private createCoast() {
    const waterMat = new THREE.MeshStandardMaterial({ color: C.sea, metalness: .28, roughness: .27 });
    waterMat.onBeforeCompile = shader => {
      shader.uniforms.uWaterTime = this.waterUniform;
      shader.vertexShader = 'uniform float uWaterTime;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.z += sin(position.x * .13 + uWaterTime * .8) * .10 + sin(position.y * .18 + position.x * .07 + uWaterTime) * .08;');
    };
    const water = new THREE.Mesh(new THREE.PlaneGeometry(1800, 2400, 110, 110), waterMat); water.rotation.x = -Math.PI / 2; water.position.set(1025, -.45, 0); water.receiveShadow = true; this.scenery.add(water);
    const batch = new Batch(), lights = new Batch();
    batch.box(mat('#ccbfa0'), 132, -.22, 0, 19, .5, 365);
    batch.box(mat('#d9cdb2'), 125.8, -.04, 0, 6.5, .25, 350);
    batch.box(mat('#c7c7b9'), 120, .11, 0, 6.5, .24, 325);
    batch.box(mat('#eee6d3'), 123.4, .25, 0, .5, .5, 325);
    batch.box(mat('#acb7af'), 116.5, .16, 0, .45, .3, 325);
    for (let z = -155; z <= 155; z += 5) {
      batch.cylinder(mat('#657a7c'), 123.45, .85, z, .055, 1.35);
      batch.box(mat('#657a7c'), 123.45, 1.4, z, .07, .07, 5);
    }
    for (let z = -145; z <= 145; z += 20) {
      tree(batch, 113.8, z + 3, .88, z + 500);
      bench(batch, 120.3, z, -Math.PI / 2);
      batch.cylinder(mat('#4b6166'), 117.9, 2.8, z + 8, .08, 5.6);
      batch.box(mat('#efe6c1'), 117.9, 5.65, z + 8, .7, .16, .7);
      lights.add(planeGeo, this.lightPoolMaterial, 119.0, .26, z + 8, 8, 13, 1, -Math.PI / 2);
      batch.box(mat('#f0e7cb'), 125.4, .03, z + 2, .18, .03, 10);
    }
    for (let i = 0; i < 45; i++) { const z = -175 + rand(i * 3 + 2) * 350; const x = 133 + rand(i + 7) * 5; const size = .3 + rand(i + 18) * .9; batch.sphere(mat('#9b9e91'), x, -.1, z, size, size * .6, size * .8); }
    const foam = mat('#b7d6cc');
    for (let i = 0; i < 30; i++) batch.box(foam, 142 + rand(i) * 5, -.25, -175 + i * 12, .12, .025, 4 + rand(i + 8) * 5, rand(i + 1) * .08);
    batch.finish(this.scenery, false); lights.finish(this.lightPools, false);
    // A tiny marina, built outside the editable district.
    const marina = new Batch();
    marina.box(mat('#a99070'), 141, .12, 111, 36, .35, 3.3);
    for (let i = 0; i < 5; i++) { const x = 133 + i * 6; marina.box(mat('#a99070'), x, .12, 117, 1.4, .35, 12); marina.cylinder(mat('#685e4f'), x, -.3, 122, .15, 3); }
    for (let i = 0; i < 4; i++) {
      const x = 136 + i * 6; marina.add(new THREE.ConeGeometry(1, 1, 4), mat('#eeeae0'), x, .25, 119, 1.25, .9, 3, Math.PI, Math.PI / 4);
      marina.box(mat('#355d69'), x, .45, 119, 1.1, .55, 3.4); marina.cylinder(mat('#d2d5c8'), x, 3.4, 119, .035, 6);
    }
    marina.finish(this.scenery);
  }

  private createLandscape() {
    const geo = new THREE.PlaneGeometry(960, 1700, 60, 75); geo.rotateX(-Math.PI / 2); geo.translate(-625, -3, 0);
    const pos = geo.attributes.position; const colors: number[] = []; const color = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i); const edge = clamp((-x - 145) / 130, 0, 1);
      const peak = 78 * Math.exp(-((x + 380) ** 2 / 46000 + (z + 230) ** 2 / 90000)) + 105 * Math.exp(-((x + 630) ** 2 / 65000 + (z - 170) ** 2 / 80000));
      const h = edge * (10 + peak + 11 * Math.sin(x * .023 + Math.sin(z * .013)) + 9 * Math.cos(z * .024)) - 3;
      pos.setY(i, h); color.set(h > 75 ? '#829080' : h > 35 ? '#71856c' : '#8b9d77'); color.multiplyScalar(.91 + rand(i) * .15); colors.push(color.r, color.g, color.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geo.computeVertexNormals();
    const hills = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true })); hills.receiveShadow = true; this.scenery.add(hills);
    const grove = new Batch();
    for (let i = 0; i < 180; i++) {
      const side = i % 3; const x = side === 0 ? -145 - rand(i + 31) * 30 : -140 + rand(i + 31) * 245;
      const z = side === 0 ? -155 + rand(i + 70) * 310 : (side === 1 ? -1 : 1) * (133 + rand(i + 2) * 28);
      tree(grove, x, z, .8 + rand(i * 2 + 1) * .9, i + 280);
    }
    grove.finish(this.scenery);
    // Low coastal islands soften the horizon and make the bay feel geographically real.
    for (const [x, z, radius, h] of [[360, -345, 135, 38], [590, -420, 180, 55], [440, 560, 160, 33]]) {
      const island = new THREE.Mesh(new THREE.ConeGeometry(radius, h, 11, 3), mat('#869b86')); island.position.set(x, h / 2 - 8, z); island.scale.z = .55; this.scenery.add(island);
    }
    for (let i = 0; i < 7; i++) {
      const gull = new THREE.Group(); const b = new Batch();
      b.box(mat('#e9ede2'), -.35, 0, 0, .8, .055, .2, -.18); b.box(mat('#e9ede2'), .35, 0, 0, .8, .055, .2, .18); b.finish(gull, false); this.seagulls.push(gull); this.scenery.add(gull);
    }
  }

  private createPeople() {
    const max = 160;
    const torso = new THREE.BoxGeometry(.48, .65, .29);
    const head = new THREE.SphereGeometry(.21, 7, 6);
    const leg = new THREE.BoxGeometry(.19, .82, .21); leg.translate(0, -.41, 0);
    const arm = new THREE.BoxGeometry(.15, .64, .17); arm.translate(0, -.32, 0);
    const hair = new THREE.SphereGeometry(.22, 7, 5); hair.scale(1, .52, 1);
    const geometries = [torso, head, hair, leg, leg, arm, arm];
    const mats = [mat('#ffffff'), mat('#e5bd9b'), mat('#443c31'), mat('#42525a'), mat('#42525a'), mat('#e5bd9b'), mat('#e5bd9b')];
    geometries.forEach((g, i) => { const mesh = new THREE.InstancedMesh(g, mats[i], max); mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.count = 0; mesh.castShadow = true; mesh.frustumCulled = false; this.people.push(mesh); this.scene.add(mesh); });
  }

  private createCars() {
    const body = new Batch(); body.box(mat('#fff'), 0, .65, 0, 1.7, .65, 3.5); body.box(mat('#fff'), 0, 1.08, -.15, 1.48, .5, 1.85);
    const glass = new Batch(); glass.box(mat('#365662', .22, .35), 0, 1.14, -.15, 1.5, .39, 1.7);
    const tires = new Batch();
    for (const x of [-.83, .83]) for (const z of [-1.05, 1.05]) tires.cylinder(mat('#30373a'), x, .4, z, .34, .16, 0, Math.PI / 2);
    const trim = new Batch(); trim.box(mat('#f5e5ba'), 0, .65, 1.76, 1.35, .17, .035); trim.box(mat('#9c5347'), 0, .65, -1.76, 1.35, .15, .035);
    const temp = new THREE.Group(); [body, glass, tires, trim].forEach(b => b.finish(temp));
    for (const child of temp.children) {
      const mesh = child as THREE.Mesh; const instanced = new THREE.InstancedMesh(mesh.geometry, mesh.material, 14); instanced.castShadow = true; instanced.frustumCulled = false; this.cars.push(instanced); this.scene.add(instanced);
      if (this.cars.length === 1) for (let i = 0; i < 14; i++) instanced.setColorAt(i, new THREE.Color(['#efeee3', '#b6c0b4', '#be7962', '#566f7d', '#c7ac70', '#7b9b9d', '#d1cec3'][i % 7]));
    }
  }

  sync(state: GameState) {
    const ids = new Set(state.buildings.map(b => b.id));
    for (const [id, group] of this.buildingMeshes) if (!ids.has(id)) { this.removeGroup(group); this.buildingMeshes.delete(id); this.buildingKeys.delete(id); }
    const roads = new Set(state.buildings.filter(b => b.kind === 'road').map(b => `${b.gx},${b.gz}`));
    const roadSignature = [...roads].sort().join('|'); const roadsChanged = roadSignature !== this.roadSignature;
    for (const b of state.buildings) {
      const adjacentRoads = [[0, 1], [1, 0], [0, -1], [-1, 0]].map(([dx, dz]) => Number(roads.has(`${b.gx + dx},${b.gz + dz}`))).join('');
      const key = `${b.kind}:${b.gx},${b.gz}:${b.level}:${b.active}:${adjacentRoads}`;
      if (this.buildingKeys.get(b.id) === key) continue;
      const old = this.buildingMeshes.get(b.id); if (old) this.removeGroup(old);
      const group = b.kind === 'road' ? this.createRoad(b, roads) : this.createBuilding(b, roads);
      group.position.set(cellToWorld(b.gx), .025, cellToWorld(b.gz));
      group.userData.buildingId = b.id; group.userData.kind = b.kind;
      group.traverse(o => { o.userData.buildingId = b.id; o.userData.kind = b.kind; });
      this.scene.add(group); this.buildingMeshes.set(b.id, group); this.buildingKeys.set(b.id, key);
    }
    if (roadsChanged) { this.roadSignature = roadSignature; this.rebuildStreetFurniture(state, roads); this.rebuildTraffic(roads); }
    const parcelSignature = state.buildings.map(b => `${b.id}:${b.gx},${b.gz}`).join('|');
    if (parcelSignature !== this.parcelSignature) { this.parcelSignature = parcelSignature; this.rebuildVacantLots(state, roads); }
    this.districtBatch.sync(this.buildingMeshes); this.transitVisuals.sync(state);
    this.eventVisuals.sync(state, this.buildingMeshes); this.highlight(this.selectedId);
  }

  private rebuildTraffic(roads:Set<string>){
    this.trafficGraph.clear();
    for(const key of roads){
      const [gx,gz]=key.split(',').map(Number);
      const neighbours=[[gx+1,gz],[gx-1,gz],[gx,gz+1],[gx,gz-1]].map(c=>c.join(',')).filter(k=>roads.has(k));
      if(neighbours.length)this.trafficGraph.set(key,{x:cellToWorld(gx),z:cellToWorld(gz),neighbours});
    }
    const nodes=[...this.trafficGraph.keys()];
    this.vehicles=Array.from({length:Math.min(14,nodes.length)},(_,i)=>{
      const old=this.vehicles[i];
      if(old&&this.trafficGraph.get(old.from)?.neighbours.includes(old.to))return old;
      const from=nodes[Math.floor(rand(i+107)*nodes.length)],node=this.trafficGraph.get(from)!;
      const to=node.neighbours[Math.floor(rand(i+711)*node.neighbours.length)],dest=this.trafficGraph.get(to)!;
      return {from,to,previous:'',progress:rand(i+908),yaw:Math.atan2(dest.x-node.x,dest.z-node.z),turns:0};
    });
    this.cars.forEach(c=>c.count=this.vehicles.length);
  }

  private rebuildVacantLots(state: GameState, roads: Set<string>) {
    this.clearGroup(this.vacantLots); const a = new Batch();
    const occupied = new Set(state.buildings.map(b => `${b.gx},${b.gz}`));
    for (let gx = 2; gx <= 21; gx++) for (let gz = 3; gz <= 21; gz++) {
      if (occupied.has(`${gx},${gz}`)) continue;
      const seed = gx * 81 + gz * 13; const chance = rand(seed); const x = cellToWorld(gx), z = cellToWorld(gz);
      const street = roads.has(`${gx - 1},${gz}`) || roads.has(`${gx + 1},${gz}`) || roads.has(`${gx},${gz - 1}`) || roads.has(`${gx},${gz + 1}`);
      if (street && chance < .11) {
        // Small neighbourhood parking courts leave a believable mix of open urban surfaces.
        a.box(mat('#8d958a'), x, .065, z, 8.35, .08, 7.9);
        a.box(mat('#c4c5b6'), x, .12, z - 4, 8.5, .15, .18);
        for (let i = -1; i <= 1; i++) { a.box(mat('#d7d6bf'), x + i * 2.6, .113, z - .7, .08, .012, 4.8); }
        for (let i = 0; i < 2; i++) { const px = x - 2.5 + i * 2.7; const paint = mat(i ? '#668b8d' : '#dbd9c9'); a.box(paint, px, .62, z - .6, 1.5, .65, 3.1); a.box(mat('#425c65'), px, 1.05, z - .75, 1.25, .38, 1.45); }
        tree(a, x + 3.4, z + 2.8, .72, seed); hedge(a, x - .6, z - 4.1, 7.1, .4, .5);
      } else if ((street && chance < .57) || (!street && chance < .72)) {
        // These pocket gardens are reclaimed as soon as the player develops the parcel.
        if (street && chance < .29) {
          a.box(mat('#86996c'), x, .045, z, 8.4, .06, 8.4);
          a.box(mat('#b6b698'), x, .095, z, 1.15, .05, 8.4);
          a.box(mat('#b6b698'), x, .095, z + 1.1, 7.8, .05, 1.0);
          bench(a, x + 2.3, z + 1.9, Math.PI);
          hedge(a, x, z - 4, 8.0, .38, .45);
        }
        const number = street ? (chance < .29 ? 2 : 1) : 2 + Math.floor(rand(seed + 3) * 2);
        for (let i = 0; i < number; i++) {
          const tx = x + (rand(seed + i * 5 + 20) - .5) * 6.6, tz = z + (rand(seed + i * 9 + 15) - .5) * 5.8;
          tree(a, tx, tz, .74 + rand(seed + i + 42) * .4, seed + i);
        }
        for (let i = 0; i < 3; i++) a.sphere(mat('#718350'), x - 2.8 + i * 2.0, .42, z - 2.7 + rand(seed + i + 40) * .8, .7, .55, .6);
      }
    }
    a.finish(this.vacantLots);
  }

  private createRoad(b: Building, roads: Set<string>) {
    const group = new THREE.Group(), batch = new Batch();
    const n = roads.has(`${b.gx},${b.gz - 1}`), s = roads.has(`${b.gx},${b.gz + 1}`), e = roads.has(`${b.gx + 1},${b.gz}`), w = roads.has(`${b.gx - 1},${b.gz}`);
    batch.box(mat('#bdbfb6'), 0, .045, 0, 10, .1, 10);
    batch.box(mat(C.asphalt), 0, .104, 0, 6.6, .03, 6.6);
    if (n || s || (!e && !w)) batch.box(mat(C.asphalt), 0, .104, 0, 6.6, .03, 10);
    if (e || w) batch.box(mat(C.asphalt), 0, .104, 0, 10, .03, 6.6);
    const line = mat(C.line);
    if (!(e || w)) { batch.box(line, 0, .127, -3.4, .105, .01, 2.4); batch.box(line, 0, .127, 3.4, .105, .01, 2.4); }
    if (!(n || s) && (e || w)) { batch.box(line, -3.4, .127, 0, 2.4, .01, .105); batch.box(line, 3.4, .127, 0, 2.4, .01, .105); }
    if ((n || s) && (e || w)) for (const side of [-1, 1]) for (let i = -2; i <= 2; i++) {
      batch.box(line, i * 1.02, .128, side * 4.0, .55, .012, .9);
      batch.box(line, side * 4.0, .129, i * 1.02, .9, .012, .55);
    }
    batch.finish(group, false); return group;
  }

  private rebuildStreetFurniture(state: GameState, roads: Set<string>) {
    this.clearGroup(this.streetFurniture); this.clearGroup(this.streetPools); const b = new Batch(), lights = new Batch();
    for (const road of state.buildings.filter(v => v.kind === 'road')) {
      const x = cellToWorld(road.gx), z = cellToWorld(road.gz);
      const vertical = roads.has(`${road.gx},${road.gz + 1}`) || roads.has(`${road.gx},${road.gz - 1}`);
      const horizontal = roads.has(`${road.gx + 1},${road.gz}`) || roads.has(`${road.gx - 1},${road.gz}`);
      if (vertical && horizontal) {
        for (const side of [-1, 1]) {
          b.cylinder(mat('#536368'), x + side * 4.2, 2.5, z + 4.2, .075, 5);
          b.box(mat('#536368'), x + side * 3.6, 4.98, z + 4.2, 1.25, .1, .1);
          b.box(mat('#e5dcba'), x + side * 3.1, 4.9, z + 4.2, .65, .12, .38);
          lights.add(planeGeo, this.lightPoolMaterial, x + side * 2.7, .15, z + 3.1, 8.5, 9.5, 1, -Math.PI / 2);
        }
      } else if ((road.gx + road.gz) % 3 === 0) {
        const px = x + (vertical ? 4.2 : 0), pz = z + (vertical ? 0 : 4.2);
        b.cylinder(mat('#596a6a'), px, 2.65, pz, .065, 5.3); b.box(mat('#eadfbb'), px, 5.3, pz, .65, .12, .65);
        lights.add(planeGeo, this.lightPoolMaterial, px + (vertical ? -1.3 : 0), .15, pz + (vertical ? 0 : -1.3), vertical ? 8 : 11, vertical ? 11 : 8, 1, -Math.PI / 2);
        if (vertical) tree(b, x - 4.2, z + 1.8, .64, road.id); else tree(b, x + 1.8, z - 4.2, .64, road.id);
      }
    }
    b.finish(this.streetFurniture); lights.finish(this.streetPools, false);
  }

  private createBuilding(b: Building, roads: Set<string>) {
    const group = new THREE.Group(), a = new Batch(); const r = rand(b.id + 11);
    const orientations = [[0, 1, 0], [1, 0, Math.PI / 2], [0, -1, Math.PI], [-1, 0, -Math.PI / 2]];
    for (const [dx, dz, angle] of orientations) if (roads.has(`${b.gx + dx},${b.gz + dz}`)) { group.rotation.y = angle; break; }
    const stone = mat('#e2ddcd'), white = mat(C.white), dark = mat(C.dark), glass = mat(C.glass, .23, .35);
    a.box(mat('#727c66'), 0, .015, 0, 9.3, .08, 9.3);
    a.box(mat('#d1cbb9'), 0, .09, 0, 9, .12, 9);
    switch (b.kind) {
      case 'home': {
        const wall = mat(['#e7dfc9', '#d6c5ab', '#ebe7dc', '#b6c7c0'][Math.floor(r * 4)]);
        const roof = mat(['#9a6550', '#647476', '#aa765b'][b.id % 3]); const h = 4.25+(b.level-1)*2.6;
        group.userData.roofHeight = h + 2.25;
        a.box(mat('#9aaa78'), 0, .16, 0, 8.6, .12, 8.6);
        a.box(wall, -.4, h / 2 + .2, -.5, 6.1, h, 5.8);
        a.box(stone, -.4, .5, -.5, 6.3, .6, 6.0);
        pitchedRoof(a, roof, -.4, h + .2, -.5, 6.7, 2.05, 6.6);
        a.box(mat('#b7aa96'), 1.2, h+1.4, -1.6, .65, 2.1, .7);
        a.box(mat('#776451'), 1.2, h+2.5, -1.6, .85, .15, .9);
        for (const x of [-2.1, 1.3]) { a.box(white, x, 2.5, 2.45, 1.65, 1.7, .13); a.box(glass, x, 2.5, 2.53, 1.4, 1.45, .05); a.box(white, x, 2.5, 2.57, .06, 1.45, .03); }
        for(let floor=1;floor<b.level;floor++){
          const y=2.5+floor*2.6;
          a.box(stone,-.4,y-1.1,-.5,6.22,.12,5.92);
          for(const x of [-2.1,1.3]){a.box(white,x,y,2.45,1.65,1.7,.13);a.box(glass,x,y,2.53,1.4,1.45,.05);}
          for(const x of [-3.48,2.68])a.box(glass,x,y,-.5,.07,1.4,1.4);
        }
        a.box(mat('#786247'), -.45, 1.35, 2.46, 1.05, 2.3, .12); a.box(mat('#c8d4ca'), -.45, 1.8, 2.54, .5, .7, .04);
        a.box(stone, -.45, .36, 3.0, 2.2, .3, 1.1); a.box(mat('#b6ab91'), -.45, 2.9, 3.0, 2.5, .2, 1.6);
        for (const x of [-1.5, .6]) a.box(white, x, 1.6, 3.55, .12, 2.5, .12);
        a.box(mat('#d6d0bd'), -.45, .24, 4.0, 1.4, .08, 1.9); a.box(mat('#b9b9a7'), 3.4, .22, .6, 1.25, .07, 7.5);
        hedge(a, -4.1, 0, .35, 8.2); hedge(a, .5, -4.1, 8.2, .35); hedge(a, -2.9, 4.0, 2.3, .4, .5);
        tree(a, 2.8, -3.15, .65, b.id); a.sphere(mat('#bfaa76'), -2.9, .55, 3.6, .4, .35, .35);
        break;
      }
      case 'apartment': {
        const h = 15 + Math.floor(r * 4) * 2.8+(b.level-1)*5.6, floors = Math.floor((h - 1) / 2.8);
        group.userData.roofHeight = h + .65;
        const wall = mat(['#dbd5c1', '#c7b6a3', '#d2d9d0', '#baa794'][b.id % 4]);
        a.box(wall, 0, h / 2 + .2, -.35, 7.6, h, 6.8);
        a.box(mat('#ece9dc'), -3.25, h / 2 + .3, -.35, .55, h + .3, 7.0);
        a.box(mat('#e5e2d5'), 3.25, h / 2 + .3, -.35, .55, h + .3, 7.0);
        a.box(stone, 0, 1.0, 0, 8.1, 1.8, 7.7);
        windows(a, 7.6, h, 6.8, floors, 4, glass, true, -.35);
        for (let f = 0; f <= floors; f++) a.box(mat('#e4e0d2'), 0, 1.1 + f * (h / floors), -.35, 7.85, .16, 7.04);
        a.box(glass, 0, 1.2, 3.92, 1.5, 2.15, .07); a.box(dark, 0, 2.55, 4.05, 3.1, .16, 1.15);
        a.box(mat('#c4c5b8'), 0, h + .4, -.35, 8, .4, 7.2); a.box(mat('#a9b0aa'), -1.8, h + .95, -1.6, 1.7, .85, 1.5);
        solar(a, 1.6, h + .7, .3, 2.2, 2.7); a.cylinder(mat('#9da9a3'), -2.2, h + 1.3, 1.3, .55, 1.3);
        hedge(a, -4.15, .3, .4, 7.5, .65); hedge(a, 4.15, .3, .4, 7.5, .65);
        break;
      }
      case 'office': {
        const h = 27 + Math.floor(r * 4) * 4+(b.level-1)*7.65;
        group.userData.roofHeight = h + 1.9;
        a.box(stone, 0, 1.1, 0, 8.5, 2.1, 8.1);
        a.box(mat('#416d7c', .21, .5), -.6, h / 2 + 1.5, -.5, 6.3, h, 6.5);
        a.box(mat('#6e939c', .23, .38), 2.7, h * .33 + 1.5, .0, 1.7, h * .66, 7.6);
        const frames = mat('#c6d4cd', .5, .15);
        for (let y = 3; y <= h + 2; y += 2.55) a.box(frames, -.6, y, -.5, 6.46, .11, 6.64);
        for (const x of [-3.4, -1.9, -.4, 1.1, 2.5]) { a.box(frames, x, h / 2 + 1.5, 2.79, .075, h, .09); a.box(frames, x, h / 2 + 1.5, -3.8, .075, h, .09); }
        for (let floor = 0; floor < Math.floor(h / 2.55); floor++) for (let column = 0; column < 4; column++) {
          if (rand(b.id * 31 + floor * 7 + column) < .52) continue;
          const x = -2.65 + column * 1.5, y = 4.15 + floor * 2.55;
          a.box(mat('#8aa7a5', .3, .2), x, y, 2.847, 1.14, 1.38, .016);
          if (column % 2 === 0) a.box(mat('#8aa7a5', .3, .2), x, y, -3.85, 1.14, 1.38, .016);
        }
        for (const z of [-2.9, -1.3, .3, 1.9]) a.box(frames, -3.79, h / 2 + 1.5, z, .07, h, .075);
        a.box(frames, -.6, h + 1.72, -.5, 6.6, .45, 6.8);
        a.box(mat('#aebcb8'), -.5, h + 2.4, -.9, 3.2, 1.1, 3.2); a.cylinder(frames, -.5, h + 4.1, -.9, .035, 3.8);
        a.box(glass, 0, 1.2, 4.1, 4.5, 2.0, .08); a.box(mat('#8c8069'), 0, 2.65, 4.15, 6.2, .18, 1.3);
        addSign(a, 'B A Y   C E N T R E', '#425f65', 3.3, 3.99, 6.5, .7);
        break;
      }
      case 'shop': {
        const wall = mat(['#d8bc96', '#d8d9cc', '#cfb29b'][b.id % 3]);
        a.box(wall, 0, 2.35, -.35, 8.1, 4.5, 7.0);
        a.box(stone, 0, .4, -.35, 8.4, .6, 7.3);
        a.box(dark, 0, 2.0, 3.19, 7.3, 2.8, .1);
        for (let i = -1; i <= 1; i++) { a.box(glass, i * 2.25, 1.85, 3.28, 1.9, 2.25, .05); a.box(stone, i * 2.25 + 1.03, 1.9, 3.34, .08, 2.6, .06); }
        const awning = mat(['#467e73', '#a4624b', '#567b8e'][b.id % 3]);
        a.box(awning, 0, 3.45, 3.82, 8.2, .18, 1.4); a.box(awning, 0, 3.15, 4.47, 8.2, .45, .11);
        for (let i = -4; i <= 4; i++) a.box(mat('#eae1c9'), i * .86, 3.46, 3.82, .34, .19, 1.4);
        addSign(a, b.id % 2 ? '栖湾 · 咖啡' : 'BAY  MARKET', b.id % 2 ? '#3e6259' : '#976647', 4.18, 3.21, 7, .85);
        a.box(mat('#bbb8a7'), 0, 4.7, -.35, 8.5, .25, 7.4); a.box(mat('#a5aca0'), -2.5, 5.05, -1.7, 1.5, .6, 1.3);
        for (const x of [-3.2, 3.2]) { a.cylinder(mat('#9a7d5f'), x, .35, 4.0, .35, .55); a.sphere(mat('#6c8a55'), x, .85, 4.0, .46, .55, .46); }
        a.box(mat('#40575a'), 3.4, .75, 3.8, .65, 1.1, .1, -.12);
        break;
      }
      case 'park': {
        a.box(mat('#96aa7b'), 0, .2, 0, 8.8, .2, 8.8);
        a.box(mat('#d0c5a9'), 0, .32, 0, 1.6, .06, 8.8); a.box(mat('#d0c5a9'), 0, .32, 0, 8.8, .06, 1.4);
        a.cylinder(mat('#c8c8b7'), 1.8, .4, -2.0, 1.5, .3); a.cylinder(mat('#79aaa6', .24, .2), 1.8, .58, -2.0, 1.3, .06);
        a.cylinder(mat('#d9d6bd'), 1.8, .85, -2, .18, .6); a.sphere(mat('#add4cd', .2), 1.8, 1.35, -2, .22, .55, .22);
        tree(a, -2.8, -2.6, .95, b.id); tree(a, 2.8, 2.6, .9, b.id + 1); tree(a, -3, 2.8, .75, b.id + 2);
        bench(a, -2.25, .95); bench(a, 2.1, 1.0, Math.PI);
        hedge(a, 0, -4.15, 8.3, .4, .5); hedge(a, -4.15, .2, .4, 8.0, .5);
        for (let i = 0; i < 9; i++) a.sphere(mat(i % 2 ? '#d8ad82' : '#ac9aaf'), -3.9 + i * .85, .5, 4.0, .25, .3, .25);
        break;
      }
      case 'power': {
        a.box(mat('#d4d7c7'), -1.7, 1.8, -1.2, 4.4, 3.3, 5.6); a.box(mat('#89968d'), -1.7, 3.55, -1.2, 4.7, .25, 5.9);
        solar(a, -1.7, 3.8, -1.2, 3.9, 4.9); solar(a, 2.2, 1.1, -1.9, 2.8, 3.7);
        a.box(mat('#a7b4a9'), 2.4, .6, -1.9, .2, .9, 3.3);
        a.cylinder(white, 2.5, 4.1, 2.2, .16, 7.7); a.sphere(white, 2.5, 8, 2.2, .35);
        for (let i = 0; i < 3; i++) { const angle = i * Math.PI * 2 / 3; a.add(boxGeo, white, 2.5 + Math.sin(angle) * 1.5, 8 + Math.cos(angle) * 1.5, 2.2, .16, 3.0, .2, 0, 0, -angle); }
        a.box(dark, -1.7, 1.3, 1.65, 1, 2.2, .1); addSign(a, '清 洁 能 源', '#547568', 2.9, 1.66, 3.8, .6);
        break;
      }
      case 'water': {
        a.box(mat('#d5ddce'), -2.5, 1.8, 0, 3.1, 3.3, 7); a.box(mat('#96afa9'), -2.5, 3.6, 0, 3.4, .3, 7.3);
        a.cylinder(mat('#c3cec4', .5, .15), 1.9, 2.5, -1.6, 2.05, 4.8); a.cylinder(mat('#9fbcb6', .3, .25), 1.9, 4.98, -1.6, 2.17, .18);
        a.cylinder(mat('#d4d9c8'), 1.9, 5.12, -1.6, 1.85, .15);
        a.cylinder(mat('#7babb3', .3, .2), 1.9, .7, 2.85, 1.45, .9); a.cylinder(mat('#588f9b', .17, .25), 1.9, 1.2, 2.85, 1.22, .04);
        a.box(mat('#708f92'), -.2, 1.3, -1.6, 2.4, .25, .25); a.box(glass, -2.5, 2.2, 3.54, 2.1, 1.25, .08);
        addSign(a, '栖 湾 水 务', '#537e88', 3.0, 3.57, 2.9, .5);
        break;
      }
      case 'clinic': {
        a.box(white, 0, 3.6, -.6, 8, 7, 6.7); a.box(mat('#d1dacf'), 0, 1.25, 0, 8.5, 2.3, 8.1);
        windows(a, 8, 6.2, 6.7, 2, 4, mat('#6f9b9f', .24, .25), false, -.6);
        a.box(mat('#e4e6d8'), 0, 7.2, -.6, 8.4, .35, 7.1); solar(a, 1.5, 7.55, -1.8, 2.5, 2.1);
        a.box(glass, 0, 1.3, 4.1, 2.3, 2.2, .08); a.box(mat('#8babad'), 0, 2.65, 4.05, 5.5, .18, 1.5);
        addSign(a, '栖湾社区医院', '#76969a', 3.45, 3.04, 6.2, .8);
        const red = mat('#b76054'); a.box(red, 0, 5.9, 2.79, .45, 1.65, .1); a.box(red, 0, 5.9, 2.8, 1.65, .45, .11);
        hedge(a, -4.2, 1.2, .45, 5.5); hedge(a, 4.2, 1.2, .45, 5.5);
        break;
      }
      case 'police': {
        a.box(mat('#d4dbd4'), 0, 3.3, -.45, 8, 6.3, 7); a.box(mat('#5b7582'), 0, 1.2, -.45, 8.2, 2.2, 7.2);
        windows(a, 8, 5.4, 7, 2, 4, glass, false, -.45); a.box(mat('#6b8390'), 0, 6.6, -.45, 8.4, .3, 7.4);
        a.box(glass, 0, 1.3, 3.21, 2.1, 2.2, .08); addSign(a, '栖 湾 警 局', '#425e72', 3.6, 3.1, 6.3, .85);
        a.box(dark, 0, 2.65, 3.7, 4.2, .15, 1.4); a.cylinder(mat('#bec8bd'), 3.7, 4, 3.7, .04, 7.5);
        a.box(mat('#52798d'), 3.25, 6.8, 3.7, .9, .55, .04); a.box(mat('#a6b6ae'), -1.8, 7.15, -1.6, 2, .8, 2.1);
        break;
      }
      case 'school': {
        const floors = b.level + 1, h = floors * 2.85 + .45;
        group.userData.roofHeight = h + .8;
        const warm = mat('#d4bea0'), brick = mat('#b69075'), frame = mat('#e7e2d3');
        // A glazed classroom wing and compact stair tower leave a small front playground.
        a.box(warm, -.65, h / 2 + .18, -1.2, 6.75, h, 5.6);
        a.box(brick, 3.15, h / 2 + .45, -1.3, 1.6, h + .55, 5.8);
        a.box(stone, -.6, .45, -1.2, 7.0, .55, 5.8);
        for (let floor = 0; floor < floors; floor++) {
          const y = 1.7 + floor * 2.85;
          for (const z of [1.64, -4.04]) {
            a.box(glass, -.85, y, z, 5.75, 1.35, .075);
            for (let i = 0; i <= 6; i++) a.box(frame, -3.7 + i * .95, y, z + (z > 0 ? .045 : -.045), .07, 1.45, .06);
            a.box(frame, -.85, y - .75, z, 6.02, .14, .22);
          }
          for (const z of [-2.8, -.2]) a.box(glass, -4.06, y, z, .07, 1.3, 1.3);
          a.box(frame, -.65, y + 1.06, -1.2, 7.0, .14, 5.86);
          a.box(glass, 3.15, y, 1.65, .9, 1.45, .07);
        }
        a.box(frame, -.65, h + .32, -1.2, 7.1, .28, 5.94); a.box(frame, 3.15, h + .75, -1.3, 1.9, .22, 6.05);
        a.box(glass, 2.45, 1.25, 2.0, 1.8, 2.2, .09); a.box(frame, 2.45, 2.55, 2.4, 2.9, .18, 1.2);
        for (const x of [1.1, 3.8]) a.box(frame, x, 1.4, 2.85, .09, 2.4, .09);
        addSign(a, '栖 湾 社 区 学 校', '#8c7257', 2.82, 1.79, 5.6, .68);
        solar(a, -.7, h + .58, -1.7, 3.7, 2.25);
        a.box(mat('#77968d'), -1.7, .2, 3.3, 4.5, .07, 2.5);
        const court = mat('#e1ddc6');
        for (const x of [-3.82, .42]) a.box(court, x, .245, 3.3, .045, .012, 2.28);
        for (const z of [2.18, 4.42]) a.box(court, -1.7, .245, z, 4.28, .012, .045);
        a.box(court, -1.65, .245, 3.3, .045, .012, 2.25);
        a.cylinder(dark, -4.1, 1.15, 3.15, .045, 2.1); a.box(frame, -4.08, 2.25, 3.15, .09, .65, 1.05);
        const hoop = new THREE.TorusGeometry(.24, .025, 5, 16); a.add(hoop, mat('#ad6d4f'), -3.78, 2.03, 3.15, 1, 1, 1, Math.PI / 2); hoop.dispose();
        a.cylinder(mat('#a5afa5'), .95, 3.1, 4.05, .035, 6.0); a.box(mat('#bc6b58'), 1.45, 5.55, 4.05, .95, .58, .035);
        hedge(a, 4.2, -1, .4, 7.6, .5); tree(a, -4.3, -4.0, .62, b.id);
        break;
      }
      case 'firestation': {
        const brick = mat('#b67e65'), trim = mat('#e1dbcd'), metal = mat('#85958d', .5, .25), red = mat('#ac5144');
        const officeH = 6.5 + (b.level - 1) * 2.8;
        group.userData.roofHeight = officeH + .5;
        a.box(mat('#9ca396'), 0, .17, 1.8, 8.9, .1, 5.2);
        a.box(brick, -1.12, 2.45, -.9, 5.65, 4.5, 6.1); a.box(trim, 2.9, officeH / 2 + .2, -.9, 2.2, officeH, 6.1);
        a.box(trim, -1.12, 4.78, -.9, 5.95, .24, 6.4); a.box(metal, 2.9, officeH + .35, -.9, 2.45, .23, 6.4);
        for (let y = .5; y < 4.6; y += .32) a.box(mat('#cba48c'), -1.12, y, 2.165, 5.62, .025, .02);
        for (const x of [-2.58, .12]) {
          a.box(trim, x, 1.9, 2.21, 2.5, 3.3, .16); a.box(x < 0 ? dark : metal, x, 1.85, 2.31, 2.18, 3.0, .06);
          if (x > 0) {
            for (let y = .6; y < 3.3; y += .3) a.box(mat('#c2cac0'), x, y, 2.35, 2.06, .035, .025);
            for (const dx of [-.65, 0, .65]) a.box(glass, x + dx, 2.5, 2.38, .5, .48, .035);
          }
        }
        a.box(glass, 2.9, 1.3, 2.22, 1.32, 2.2, .08); a.box(red, 2.9, 2.62, 2.55, 2.3, .17, 1.0);
        for (let floor = 0; floor < b.level; floor++) a.box(glass, 2.9, 4.0 + floor * 2.8, 2.2, 1.45, 1.2, .07);
        addSign(a, '滨 湾 消 防  ·  1 1 9', '#974f40', 3.93, 2.21, 5.6, .65);
        for (const x of [-3.8, -1.25, 1.5]) a.box(mat('#ded7bc'), x, .245, 3.5, .055, .015, 1.45);
        // A compact engine waits at the open apparatus bay, with hose reel and roof ladder.
        a.box(red, -2.58, .85, 2.6, 1.4, .9, 2.85); a.box(red, -2.58, 1.5, 3.28, 1.38, .65, 1.18);
        a.box(glass, -2.58, 1.6, 3.89, 1.2, .45, .04); a.box(trim, -2.58, .87, 4.04, 1.47, .16, .07);
        a.box(trim, -2.58, 1.0, 2.6, 1.43, .18, 2.81);
        for (const x of [-3.29, -1.87]) for (const z of [1.55, 3.5]) a.cylinder(mat('#333e3e'), x, .43, z, .31, .16, 0, Math.PI / 2);
        a.box(mat('#e5dcba'), -2.58, 1.87, 3.32, .94, .14, .18);
        for (const x of [-2.89, -2.27]) a.box(trim, x, 1.55, 1.92, .05, .05, 1.65);
        for (let z = 1.2; z < 2.8; z += .22) a.box(trim, -2.58, 1.55, z, .66, .035, .04);
        const hose = new THREE.TorusGeometry(.23, .065, 6, 16); a.add(hose, mat('#777d6b'), -1.84, 1.1, 2.22, 1, 1, 1, 0, Math.PI / 2); hose.dispose();
        a.cylinder(metal, 2.9, officeH + 2.15, -.8, .035, 3.7);
        for (const y of [officeH + 1.4, officeH + 2.15, officeH + 2.9]) a.box(metal, 2.9, y, -.8, 1.1, .035, .035);
        a.box(mat('#a5b5a8'), -2.25, 5.2, -2.0, 1.3, .6, 1.4); solar(a, -.2, 5.03, -1.4, 1.8, 2.4);
        hedge(a, 4.22, -.9, .38, 7.65, .5); tree(a, -4.3, -4.1, .6, b.id);
        break;
      }
      case 'busstop': {
        group.userData.roofHeight = 3.15;
        const teal = mat('#477f7b'), trim = mat('#e7e5d6');
        a.box(mat('#9ca996'), 0, .18, -.2, 8.6, .15, 8.5);
        a.box(mat('#c6c6b5'), 0, .28, .2, 8.2, .09, 7.4);
        for (const x of [-2.95, 2.95]) a.box(dark, x, 1.55, -1.42, .13, 2.55, .13);
        a.box(glass, 0, 1.63, -1.62, 6.0, 1.95, .08);
        for (const x of [-3.0, 3.0]) a.box(glass, x, 1.63, -.78, .07, 1.95, 1.7);
        a.box(trim, 0, 2.97, -.55, 6.75, .18, 2.85); a.box(teal, 0, 2.84, .86, 6.8, .3, .11);
        a.box(teal, 0, 3.1, -.55, 6.38, .09, 2.58);
        addSign(a, '栖 湾 公 交  ·  BUS', '#477f7b', 2.83, .925, 5.8, .24);
        bench(a, -1.25, -.83); bench(a, 1.0, -.83);
        a.box(trim, 1.95, 1.55, -1.55, 1.35, 1.5, .07);
        for (let i = 0; i < 7; i++) a.box(i < 2 ? teal : mat('#a2b2a3'), 1.95, 2.07 - i * .17, -1.5, 1.08 - (i % 3) * .12, .045, .025);
        a.cylinder(dark, 3.64, 1.6, 2.24, .055, 2.6); a.box(teal, 3.64, 2.78, 2.24, 1.05, 1.12, .15);
        a.add(planeGeo, sign('BUS', '#477f7b'), 3.64, 2.97, 2.325, .87, .23, 1);
        a.box(trim, 3.64, 2.56, 2.33, .79, .37, .025); a.box(teal, 3.64, 2.57, 2.35, .56, .06, .025);
        a.box(mat('#d2bd7e'), -.45, .36, 3.23, 6.7, .035, .72);
        for (let x = -3.65; x < 2.85; x += .23) a.box(mat('#e7dab2'), x, .388, 3.23, .055, .02, .61);
        a.cylinder(dark, -3.72, .8, 1.3, .31, .95); a.cylinder(trim, -3.72, 1.3, 1.3, .35, .08);
        for (const x of [-3.85, 3.85]) { a.box(trim, x, .55, -3.25, .7, .6, .9); hedge(a, x, -3.25, .65, .84, .75); }
        solar(a, .1, 3.24, -.55, 2.7, 1.55);
        break;
      }
      case 'prison': {
        const wall = mat('#c9c5b3');
        a.box(mat('#a4ad95'), 0, .19, 0, 8.7, .2, 8.7);
        a.box(wall, 0, 2.9, -2.3, 7.5, 5.4, 3.5); a.box(mat('#8a938a'), 0, 5.72, -2.3, 7.8, .25, 3.8);
        for (let x = -3; x <= 3; x += 1.2) for (const y of [1.8, 3.9]) {
          a.box(dark, x, y, -.48, .65, .95, .06); for (const dx of [-.2, 0, .2]) a.box(mat('#b9beb0'), x + dx, y, -.43, .035, .95, .05);
        }
        a.box(mat('#b4b4a0'), -3.4, 1.9, .8, 1.1, 3.5, 4.3);
        const fence = mat('#7d8a7e');
        for (const side of [-1, 1]) {
          for (let z = -.1; z < 4.5; z += .45) a.box(fence, side * 4.25, 1.6, z, .045, 2.8, .045);
          for (const y of [.7, 1.65, 2.65, 3.1]) a.box(fence, side * 4.25, y, 2.1, .045, .045, 4.8);
        }
        for (let x = -4.2; x <= 4.3; x += .45) a.box(fence, x, 1.6, 4.25, .045, 2.8, .045);
        for (const y of [.7, 1.65, 2.65, 3.1]) a.box(fence, 0, y, 4.25, 8.5, .045, .045);
        a.box(wall, 3.5, 3.25, 3.5, 1.4, 6.1, 1.4); a.box(glass, 3.5, 6.2, 3.5, 1.7, .95, 1.7); a.box(mat('#7d8173'), 3.5, 6.8, 3.5, 2.1, .2, 2.1);
        a.box(mat('#c5c3a9'), .2, .35, 2.0, 3.0, .05, 3.2); a.box(mat('#e3dfc8'), .2, .39, 2.0, 2.6, .03, .05);
        addSign(a, '栖 湾 矫 正 中 心', '#687568', 4.95, -.49, 6.1, .6);
        break;
      }
    }
    if(b.level>1){
      if(!['home','apartment','office','park','school','firestation','busstop'].includes(b.kind))group.scale.y=1+(b.level-1)*.16;
      // Bronze entry markers make upgraded public facilities legible from the street.
      a.box(mat('#ac9469'),3.6,.75,3.9,.65,1.1,.12);
      for(let i=0;i<b.level;i++)a.box(mat('#eee2bb'),3.42+i*.17,.8,3.98,.065,.4,.025);
    }
    if (group.userData.roofHeight === undefined) group.userData.roofHeight = ({ shop: 4.85, park: .5, power: 3.75, water: 5.25, clinic: 7.4, police: 6.8, prison: 5.9 } as Partial<Record<BuildingKind, number>>)[b.kind] ?? 4;
    a.finish(group); return group;
  }

  update(dt: number, state: GameState, mode: CameraMode) {
    // RAF timestamps can precede a visibility-change clock reset by a fraction of a frame.
    const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.walkTime+=step;
    this.time += step * (state.speed === 0 ? 0 : 1); this.waterUniform.value = this.time;
    const daylight = clamp(Math.sin((state.hour - 6) / 12 * Math.PI) * 1.7, 0, 1);
    this.sun.intensity = .18 + daylight * 3.07; this.ambient.intensity = .6 + daylight * 1.05;
    this.sun.color.lerpColors(this.moonSun, this.warmSun, daylight);
    this.ambient.color.lerpColors(this.nightAmbient, this.dayAmbient, daylight);
    this.ambient.groundColor.lerpColors(this.nightGroundLight, this.dayGroundLight, daylight);
    const night = 1 - daylight;
    materials.forEach(m => { if (m.userData.nightIntensity !== undefined) m.emissiveIntensity = night * m.userData.nightIntensity; });
    signs.forEach(m => m.emissiveIntensity = night * .8);
    this.lightPools.visible = night > .01; this.lightPoolMaterial.opacity = night * .32;
    this.eventVisuals.update(step, state.speed === 0);
    this.sun.position.set(-Math.cos((state.hour - 6) / 12 * Math.PI) * 100, 45 + daylight * 100, 80);
    (this.scene.background as THREE.Color).lerpColors(this.nightSky, this.daySky, daylight);
    (this.scene.fog as THREE.Fog).color.copy(this.scene.background as THREE.Color);
    this.player.position.set(state.player.x, .06, state.player.z); this.player.rotation.y = state.player.yaw;
    this.player.visible = mode !== 'first' && !state.transit.journey;
    this.transitVisuals.update(step, state, mode);
    const distance = this.lastPlayer.distanceTo(new THREE.Vector2(state.player.x, state.player.z));
    const walk = distance > .003 ? Math.sin(this.walkTime * 10) * .55 : 0;
    this.playerRig.legs.forEach((limb, i) => limb.rotation.x = i ? -walk : walk);
    this.playerRig.arms.forEach((limb, i) => limb.rotation.x = i ? walk * .65 : -walk * .65);
    this.lastPlayer.set(state.player.x, state.player.z);
    const count = Math.min(state.residents.length, 160); const dummy = this.dummy;
    const residentIds = state.residents.slice(0, count).map(p => p.id);
    this.people.forEach(p => { p.count = count; p.userData.residentIds = residentIds; });
    for (let i = 0; i < count; i++) {
      const p = state.residents[i], yaw = Math.atan2(p.targetX - p.x, p.targetZ - p.z), walking = Math.hypot(p.targetX - p.x, p.targetZ - p.z) > .3;
      const stride = walking ? Math.sin(this.time * 7.5 + i * 2.1) * .43 : 0;
      const offsets = [[0, 1.12, 0], [0, 1.67, 0], [0, 1.81, -.02], [-.135, .88, 0], [.135, .88, 0], [-.32, 1.39, 0], [.32, 1.39, 0]];
      for (let j = 0; j < this.people.length; j++) {
        const [ox, oy, oz] = offsets[j]; dummy.position.set(p.x + ox * Math.cos(yaw) + oz * Math.sin(yaw), oy + .07, p.z - ox * Math.sin(yaw) + oz * Math.cos(yaw));
        dummy.rotation.set(j >= 3 ? (j % 2 === 0 ? -stride : stride) * (j >= 5 ? .7 : 1) : 0, yaw, 0); dummy.scale.setScalar(.9 + rand(p.id) * .18); dummy.updateMatrix(); this.people[j].setMatrixAt(i, dummy.matrix);
      }
      this.people[0].setColorAt(i, new THREE.Color(p.color));
    }
    this.people.forEach(p => { p.instanceMatrix.needsUpdate = true; p.boundingSphere = null; if (p.instanceColor) p.instanceColor.needsUpdate = true; });
    for (let i = 0; i < this.vehicles.length; i++) {
      const car=this.vehicles[i];
      car.progress+=step*state.speed*(.7+(i%3)*.065);
      while(car.progress>=1){
        car.progress-=1;
        const prior=this.trafficGraph.get(car.from)!,node=this.trafficGraph.get(car.to)!;
        const options=node.neighbours.filter(key=>key!==car.from);
        const straight=options.find(key=>{const n=this.trafficGraph.get(key)!;return (n.x-node.x)===(node.x-prior.x)&&(n.z-node.z)===(node.z-prior.z);});
        const choice=straight&&rand(i*97+car.turns*13)>.35?straight:options[Math.floor(rand(i*31+car.turns*7)*options.length)]??car.from;
        car.previous=car.from;car.from=car.to;car.to=choice;car.turns++;
      }
      const from=this.trafficGraph.get(car.from)!,to=this.trafficGraph.get(car.to)!;
      const tx=(to.x-from.x)/TILE,tz=(to.z-from.z)/TILE;
      const angle=Math.atan2(tx,tz);car.yaw+=Math.atan2(Math.sin(angle-car.yaw),Math.cos(angle-car.yaw))*Math.min(1,step*state.speed*8);
      const lane=1.38;
      let laneX=tz*lane,laneZ=-tx*lane;
      const previous=this.trafficGraph.get(car.previous);
      if(previous&&car.progress<.35){const blend=car.progress/.35;laneX=THREE.MathUtils.lerp((from.z-previous.z)/TILE*lane,laneX,blend);laneZ=THREE.MathUtils.lerp(-(from.x-previous.x)/TILE*lane,laneZ,blend);}
      dummy.position.set(THREE.MathUtils.lerp(from.x,to.x,car.progress)+laneX,.1,THREE.MathUtils.lerp(from.z,to.z,car.progress)+laneZ);
      dummy.rotation.set(0,car.yaw,0);dummy.scale.setScalar(1);dummy.updateMatrix();this.cars.forEach(mesh=>mesh.setMatrixAt(i,dummy.matrix));
    }
    this.cars.forEach(c => { c.instanceMatrix.needsUpdate = true; c.boundingSphere = null; });
    this.seagulls.forEach((g, i) => { const a = this.time * .07 + i * .94; g.position.set(135 + Math.cos(a) * 28 + i * 3, 20 + Math.sin(this.time * .4 + i) * 3 + i, 10 + Math.sin(a) * 70); g.rotation.y = -a; g.rotation.z = Math.sin(this.time * 1.8 + i) * .12; });
  }

  setGhost(kind: BuildingKind | 'bulldoze' | null, gx: number, gz: number, valid: boolean) {
    this.ghost.visible = kind !== null && gx >= 0 && gx < 24 && gz >= 0 && gz < 24;
    this.ghost.position.set(cellToWorld(gx), .02, cellToWorld(gz));
    const color = kind === 'bulldoze' || !valid ? '#ef9f85' : '#c4edcb';
    for (const child of this.ghost.children) { const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial; material.color.set(color); }
  }

  highlight(id: number | null) {
    this.selectedId = id; const group = id === null ? null : this.buildingMeshes.get(id);
    this.selection.visible = !!group; if (group) this.selection.position.set(group.position.x, .25, group.position.z);
    this.transitVisuals.highlight(id);
  }

  getEventMarkers() { return this.eventVisuals.getMarkers().map(marker => ({ ...marker })); }
  setStaticBatching(enabled: boolean) { this.districtBatch.setEnabled(enabled); }
  getRenderDiagnostics() { return { static: this.districtBatch.getDiagnostics(), transit: this.transitVisuals.getDiagnostics() }; }

  private removeGroup(group: THREE.Group) { this.scene.remove(group); this.clearGroup(group); }
  private clearGroup(group: THREE.Group) { group.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); }); group.clear(); }
  dispose() {
    this.eventVisuals.dispose(); this.districtBatch.dispose(); this.transitVisuals.dispose();
    const ownedMaterials = new Set<THREE.Material>();
    this.scene.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(m => ownedMaterials.add(m));
    });
    materials.forEach(m => ownedMaterials.add(m)); signs.forEach(m => ownedMaterials.add(m));
    ownedMaterials.forEach(m => { (m as THREE.MeshStandardMaterial).map?.dispose(); m.dispose(); }); materials.clear(); signs.clear();
  }
}
