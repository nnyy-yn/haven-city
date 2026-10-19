import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FURNITURE, type CameraMode, type FurnitureKind, type GameState } from './types';

const box = new THREE.BoxGeometry(1, 1, 1);
const rounded = new RoundedBoxGeometry(1, 1, 1, 3, .12);
const sphere = new THREE.SphereGeometry(1, 14, 10);
const cylinder = new THREE.CylinderGeometry(1, 1, 1, 20);
const plane = new THREE.PlaneGeometry(1, 1);
const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), rotation = new THREE.Euler();
const position = new THREE.Vector3(), size = new THREE.Vector3();
const random = (n: number) => { const a = Math.sin(n * 127.1 + 74.7) * 43758.5453; return a - Math.floor(a); };

class DetailBatch {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, w = 1, h = 1, d = 1, rx = 0, ry = 0, rz = 0) {
    quaternion.setFromEuler(rotation.set(rx, ry, rz)); matrix.compose(position.set(x, y, z), quaternion, size.set(w, h, d));
    const source = geometry.clone(), transformed = source.index ? source.toNonIndexed() : source;
    if (source !== transformed) source.dispose(); transformed.applyMatrix4(matrix);
    const entries = this.parts.get(material) || []; entries.push(transformed); this.parts.set(material, entries);
  }
  box(m: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, ry = 0) { this.add(box, m, x, y, z, w, h, d, 0, ry); }
  round(m: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, ry = 0, rz = 0) { this.add(rounded, m, x, y, z, w, h, d, 0, ry, rz); }
  sphere(m: THREE.Material, x: number, y: number, z: number, w: number, h = w, d = w, rz = 0) { this.add(sphere, m, x, y, z, w, h, d, 0, 0, rz); }
  cyl(m: THREE.Material, x: number, y: number, z: number, radius: number, h: number, rx = 0, rz = 0) { this.add(cylinder, m, x, y, z, radius, h, radius, rx, 0, rz); }
  custom(g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) { this.add(g, m, x, y, z, 1, 1, 1, rx, ry, rz); g.dispose(); }
  finish(parent: THREE.Object3D, cast = true) {
    for (const [material, geometries] of this.parts) {
      const geometry = mergeGeometries(geometries, false); geometries.forEach(g => g.dispose());
      if (geometry) { const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = cast; mesh.receiveShadow = true; parent.add(mesh); }
    }
    this.parts.clear();
  }
}

interface Rect { x: number; z: number; width: number; depth: number; rotation: number }
interface Rig { group: THREE.Group; arms: THREE.Group[]; legs: THREE.Group[] }

/** A separate cutaway apartment scene; all home rules stay in the simulation. */
export class InteriorWorld {
  scene = new THREE.Scene();
  player: THREE.Group;
  furnitureMeshes = new Map<number, THREE.Group>();
  private materialCache = new Map<string, THREE.MeshStandardMaterial>();
  private textures = new Set<THREE.Texture>();
  private furnishingKeys = new Map<number, FurnitureKind>();
  private obstacles: Rect[] = [];
  private rig: Rig;
  private guest: Rig | null = null;
  private guestId: number | null = null;
  private selection: THREE.Mesh;
  private selectedId: number | null = null;
  private clock = 0;
  private lastPosition = new THREE.Vector2(0, 5.6);
  private fabric: THREE.CanvasTexture;
  private wood: THREE.CanvasTexture;
  private sun: THREE.DirectionalLight;
  private sky: THREE.HemisphereLight;
  private night = new THREE.Color('#7a909e');
  private daylight = new THREE.Color('#cbdde0');

  constructor() {
    this.scene.background = this.daylight.clone(); this.scene.fog = new THREE.Fog('#cbdde0', 38, 115);
    this.fabric = this.makeFabric(); this.wood = this.makeWood();
    this.sky = new THREE.HemisphereLight('#e4eff0', '#a38b70', 1.8); this.scene.add(this.sky);
    this.sun = new THREE.DirectionalLight('#fff0d1', 3.1); this.sun.position.set(-8, 13, -12); this.sun.target.position.set(1, 0, 1);
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(1536, 1536); this.sun.shadow.camera.left = -14; this.sun.shadow.camera.right = 14;
    this.sun.shadow.camera.top = 14; this.sun.shadow.camera.bottom = -14; this.sun.shadow.camera.near = .5; this.sun.shadow.camera.far = 45;
    this.sun.shadow.normalBias = .018; this.sun.shadow.bias = -.00015; this.sun.shadow.radius = 3; this.scene.add(this.sun, this.sun.target);
    const reading = new THREE.PointLight('#ffdba1', 13, 11, 2); reading.position.set(-7, 2.5, .9);
    const kitchen = new THREE.PointLight('#ffe9bd', 15, 12, 2); kitchen.position.set(4.3, 3, -3.7); this.scene.add(reading, kitchen);
    this.createShell(); this.createView();
    this.rig = this.makePerson('#5e8580'); this.player = this.rig.group; this.player.position.set(0, 0, 5.6); this.player.rotation.y = Math.PI; this.scene.add(this.player);
    const highlightMaterial = new THREE.MeshBasicMaterial({ color: '#e1bb73', transparent: true, opacity: .23, depthWrite: false });
    this.selection = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), highlightMaterial); this.selection.rotation.x = -Math.PI / 2; this.selection.visible = false; this.selection.position.y = .15; this.scene.add(this.selection);
  }

  private mat(color: string, roughness = .78, metalness = 0, fabric = false, wood = false) {
    const key = `${color}:${roughness}:${metalness}:${fabric}:${wood}`; let material = this.materialCache.get(key);
    if (!material) { material = new THREE.MeshStandardMaterial({ color, roughness, metalness, map: fabric ? this.fabric : wood ? this.wood : null }); this.materialCache.set(key, material); }
    return material;
  }
  private canvasTexture(canvas: HTMLCanvasElement) { const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8; this.textures.add(texture); return texture; }
  private makeFabric() {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128; const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#f4f1e8'; ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 128; i += 2) { ctx.strokeStyle = i % 4 ? 'rgba(123,118,105,.07)' : 'rgba(255,255,255,.2)'; ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 128); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(128, i); ctx.stroke(); }
    return this.canvasTexture(canvas);
  }
  private makeWood() {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128; const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#e0c59e'; ctx.fillRect(0, 0, 512, 128);
    for (let i = 0; i < 90; i++) { const y = random(i + 4) * 128; ctx.strokeStyle = `rgba(112,78,43,${.025 + random(i + 19) * .09})`; ctx.lineWidth = .3 + random(i + 90) * 1.3; ctx.beginPath(); for (let x = 0; x <= 512; x += 8) { const py = y + Math.sin(x * .013 + i) * (1 + random(i + 44) * 4); if (!x) ctx.moveTo(x, py); else ctx.lineTo(x, py); } ctx.stroke(); }
    return this.canvasTexture(canvas);
  }
  private artwork(variant = 0) {
    const canvas = document.createElement('canvas'); canvas.width = 360; canvas.height = 480; const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ece2ca'; ctx.fillRect(0, 0, 360, 480); ctx.fillStyle = variant ? '#8b9b86' : '#bba887'; ctx.fillRect(30, 230, 300, 210);
    ctx.fillStyle = variant ? '#c8a177' : '#597e7c'; ctx.beginPath(); ctx.arc(variant ? 120 : 245, 180, 85, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = variant ? '#658782' : '#a0ac94'; ctx.beginPath(); ctx.moveTo(30, 340); ctx.bezierCurveTo(140, 170, 220, 440, 330, 265); ctx.lineTo(330, 440); ctx.lineTo(30, 440); ctx.fill();
    ctx.fillStyle = '#4b6257'; ctx.font = '14px Georgia'; ctx.textAlign = 'center'; ctx.fillText(variant ? 'S L O W   L I V I N G' : 'H A V E N   B A Y', 180, 463);
    return new THREE.MeshStandardMaterial({ map: this.canvasTexture(canvas), roughness: .85 });
  }

  private createShell() {
    const a = new DetailBatch(), oak = this.mat('#c5ae89', .72, 0, false, true), wall = this.mat('#e5e2d6'), sage = this.mat('#a5b29f'), trim = this.mat('#d7cfbc'), brass = this.mat('#ab9263', .34, .55);
    a.box(this.mat('#827567'), 0, -.08, 0, 18.6, .22, 15.6);
    const plankColors = ['#cfbb98', '#c6ac87', '#d8c5a5', '#c5ad8b', '#d2bd9d', '#cbb38e'];
    for (let row = 0; row < 22; row++) {
      const z = -7.5 + (row + .5) * 15 / 22, offset = row % 2 ? -2.2 : 0;
      for (let col = -1; col < 5; col++) { const left = Math.max(-9, -9 + col * 4.5 + offset), right = Math.min(9, -9 + (col + 1) * 4.5 + offset); if (right > left) a.box(this.mat(plankColors[(row + col + 12) % 6], .68, 0, false, true), (left + right) / 2, .015, z, right - left - .018, .10, 15 / 22 - .015); }
    }
    // A full north/east wall and low south/west walls form a readable dollhouse cutaway.
    a.box(wall, -2.8, .57, -7.6, 12.4, 1.14, .24); a.box(wall, -2.8, 3.35, -7.6, 12.4, .55, .24);
    for (const [x, w] of [[-8.8, .4], [-3, .4], [3.55, .5]]) a.box(wall, x, 2.05, -7.6, w, 2.05, .24);
    a.box(sage, 6.4, 1.8, -7.6, 5.2, 3.6, .24); a.box(sage, 9.1, 1.8, 0, .24, 3.6, 15.45);
    a.box(wall, -9.1, .4, 0, .24, .8, 15.5);
    for (const x of [-5.25, 5.25]) a.box(wall, x, .4, 7.6, 7.5, .8, .24);
    a.box(oak, -9.1, .83, 0, .31, .08, 15.5); for (const x of [-5.25, 5.25]) a.box(oak, x, .83, 7.6, 7.5, .08, .31);
    a.box(trim, 0, .13, -7.43, 18.0, .19, .08); a.box(trim, 8.94, .13, 0, .08, .19, 15);
    for (const [cx, width] of [[-5.65, 5.3], [.25, 6.1]]) {
      const frame = this.mat('#73847b', .55, .16); a.box(oak, cx, 1.15, -7.38, width + .2, .13, .4); a.box(frame, cx, 3.08, -7.43, width, .09, .12);
      for (const x of [cx - width / 2, cx, cx + width / 2]) a.box(frame, x, 2.12, -7.43, .075, 1.9, .13);
      a.box(frame, cx, 2.15, -7.43, width, .065, .12);
      const glass = new THREE.MeshPhysicalMaterial({ color: '#d8e5de', transparent: true, opacity: .13, roughness: .18, metalness: .05, depthWrite: false, side: THREE.DoubleSide });
      a.box(glass, cx, 2.11, -7.54, width, 1.85, .025);
      a.cyl(brass, cx, 3.25, -7.1, .028, width + .5, 0, Math.PI / 2);
      const curtain = this.mat('#e6decb', .95, 0, true);
      for (const side of [-1, 1]) for (let i = 0; i < 5; i++) a.cyl(curtain, cx + side * (width / 2 - .15) + (i - 2) * .085, 2.08, -7.04 + (i % 2) * .035, .075, 2.14);
    }
    // Low partitions preserve sight lines while making the bedroom and bath feel distinct.
    a.box(wall, -.8, .57, -4.85, .18, 1.14, 5.3); a.box(oak, -.8, 1.17, -4.85, .26, .08, 5.3);
    a.box(sage, 4.78, .53, 5.52, .16, 1.06, 3.95); a.box(oak, 4.78, 1.1, 5.52, .23, .08, 3.95);
    a.box(this.mat('#c1c8bb'), 6.9, .075, 5.47, 4.05, .03, 3.86);
    for (let x = 5.1; x < 8.9; x += .63) for (let z = 3.7; z < 7.5; z += .63) a.box(this.mat('#e0dfd3'), x, .096, z, .61, .018, .61);
    const bathGlass = new THREE.MeshPhysicalMaterial({ color: '#b7d3c9', transparent: true, opacity: .18, roughness: .2, depthWrite: false, side: THREE.DoubleSide });
    a.box(bathGlass, 4.78, 1.9, 5.52, .025, 1.55, 3.9); a.box(brass, 4.78, 2.69, 5.52, .04, .04, 3.95);
    // Entry threshold, an open door and a welcome mat leave the centre path clear.
    a.box(oak, 0, .07, 7.45, 2.6, .07, .7); a.round(this.mat('#7f9482', .95, 0, true), 0, .115, 6.62, 2.15, .06, 1.05);
    for (const x of [-1.5, 1.5]) a.box(trim, x, 1.43, 7.61, .13, 2.86, .19);
    a.box(trim, 0, 2.9, 7.61, 3.15, .15, .19);
    a.box(oak, -1.5, 1.42, 8.67, .1, 2.75, 2.05); a.sphere(brass, -1.38, 1.25, 9.37, .055);
    // Woven rugs and a quiet timber border provide zones without obstructing movement.
    this.rug(a, -4.6, 2.75, 5.9, 4.75, '#c4b59b'); this.rug(a, -5.6, -4.2, 5.55, 5.15, '#c9c5b1');
    a.cyl(this.mat('#b6b9a0', .98, 0, true), 4, .11, -1.4, 1.75, .025);
    // Fixed bathroom basin and mirror, tucked against the east wall.
    a.box(oak, 8.4, .55, 5.7, .95, 1.0, 1.5); a.round(this.mat('#e7e6da', .3), 8.38, 1.1, 5.7, 1.02, .16, 1.6);
    a.sphere(this.mat('#94a69c', .25), 8.32, 1.19, 5.7, .34, .035, .48); a.cyl(brass, 8.76, 1.34, 5.7, .025, .4);
    a.box(brass, 8.88, 2.0, 5.7, .05, 1.6, 1.2); a.box(this.mat('#a6c1bb', .12, .65), 8.84, 2.0, 5.7, .025, 1.46, 1.08);
    // A few framed prints, sockets, and a reading lamp give the shell a lived-in scale.
    for (const [z, variant] of [[-.8, 0], [1.1, 1]]) { a.box(oak, 8.9, 2.17, z, .08, 1.55, 1.18); a.box(this.mat('#eee9dc'), 8.84, 2.17, z, .025, 1.43, 1.06); a.add(plane, this.artwork(variant), 8.82, 2.17, z, .9, 1.28, 1, 0, -Math.PI / 2); }
    for (const z of [-4, 2.7]) { a.box(this.mat('#e6e3d7'), 8.94, .4, z, .035, .2, .28); for (const dz of [-.06, .06]) a.box(this.mat('#8d978c'), 8.917, .4, z + dz, .01, .06, .025); }
    a.cyl(this.mat('#475a51'), -7.15, .13, .7, .4, .14); a.cyl(brass, -7.15, 1.3, .7, .027, 2.4);
    a.custom(new THREE.CylinderGeometry(.31, .52, .65, 24, 1, true), this.mat('#d4ccb5', .9, 0, true), -7.15, 2.4, .7);
    a.cyl(this.mat('#f4e4b8'), -7.15, 2.14, .7, .38, .035);
    a.box(brass, 6.7, 3.57, -1.4, 4.6, .03, .03); a.cyl(brass, 4.4, 3.3, -1.4, .018, .55);
    a.custom(new THREE.ConeGeometry(.62, .36, 30, 1, true), this.mat('#c8b58e'), 4.4, 2.96, -1.4); a.cyl(this.mat('#f3dfac'), 4.4, 2.78, -1.4, .48, .025);
    a.finish(this.scene);
  }

  private rug(a: DetailBatch, x: number, z: number, w: number, d: number, color: string) {
    a.round(this.mat(color, .98, 0, true), x, .09, z, w, .035, d);
    const border = this.mat('#a99e87', .98, 0, true);
    for (const side of [-1, 1]) { a.box(border, x + side * (w / 2 - .19), .113, z, .025, .008, d - .32); a.box(border, x, .113, z + side * (d / 2 - .19), w - .32, .008, .025); }
    for (let i = 0; i < 26; i++) for (const side of [-1, 1]) a.box(this.mat('#cbbfa6'), x - w / 2 + (i + .5) * w / 26, .095, z + side * (d / 2 + .06), .02, .015, .16);
  }

  private createView() {
    const a = new DetailBatch(); a.box(this.mat('#a8b9a1'), 0, -.8, -45, 100, .2, 80);
    a.box(this.mat('#79a5aa', .3, .2), -24, -.68, -42, 34, .04, 76);
    for (let i = 0; i < 22; i++) {
      const x = -24 + i * 2.6 + random(i + 80) * 1.2, z = -20 - random(i + 180) * 44, w = 1.7 + random(i + 200) * 2.1, h = 3 + random(i + 350) * 10;
      const wall = this.mat(['#a8b5ad', '#c7c8bb', '#b1b7a7', '#9fb2ae'][i % 4]); a.box(wall, x, h / 2 - .7, z, w, h, w * .9); a.box(this.mat('#bac3b6'), x, h - .65, z, w + .15, .14, w * .9 + .15);
      for (let y = 1; y < h - .8; y += 1.2) for (let c = 0; c < 3; c++) a.box(this.mat('#668c94', .35, .22), x + (c - 1) * w * .27, y, z + w * .45 + .025, w * .18, .65, .035);
    }
    for (let i = 0; i < 26; i++) { const x = -30 + random(i + 4) * 65, z = -12 - random(i + 9) * 55; a.cyl(this.mat('#8b9176'), x, .6, z, .12, 2); a.sphere(this.mat('#7b967c'), x, 2, z, .85, 1.4, .85); }
    a.finish(this.scene, false);
  }

  private furniture(kind: FurnitureKind) {
    const group = new THREE.Group(), a = new DetailBatch();
    const oak = this.mat('#c0a47e', .68, 0, false, true), paleOak = this.mat('#d3bd98', .7, 0, false, true), dark = this.mat('#3d514d'), cream = this.mat('#e8e3d6'), brass = this.mat('#ac9466', .28, .65);
    switch (kind) {
      case 'bed': {
        a.round(oak, 0, .36, .05, 2.52, .4, 3.6); a.round(this.mat('#c1b79d', .95, 0, true), 0, .65, .08, 2.48, .35, 3.55);
        a.round(this.mat('#e8e4d8', .98, 0, true), 0, .83, .17, 2.48, .18, 3.38);
        a.round(this.mat('#b7c2ac', .98, 0, true), 0, .99, .66, 2.5, .2, 2.27);
        a.round(this.mat('#cad0bc', .98, 0, true), 0, 1.1, -.26, 2.49, .13, .48);
        for (const x of [-.63, .63]) { a.round(this.mat('#eeeadf', .97, 0, true), x, 1.0, -1.12, 1.04, .3, .69, x * .05); a.round(this.mat('#c2ad8a', .97, 0, true), x, 1.14, -.66, .58, .15, .48, x * .17); }
        a.round(this.mat('#c4b79c', .95, 0, true), 0, 1.0, -1.78, 2.6, 1.6, .2); a.box(oak, 0, .6, -1.93, 2.7, 1.15, .13);
        for (const side of [-1, 1]) { a.box(paleOak, side * 1.46, .53, -1.4, .34, .75, .72); a.box(brass, side * 1.46, .56, -1.025, .17, .025, .035); }
        a.cyl(brass, 1.44, 1.1, -1.4, .035, .45); a.custom(new THREE.CylinderGeometry(.16, .25, .32, 18), this.mat('#e7ddc2', .9, 0, true), 1.44, 1.38, -1.4);
        a.box(this.mat('#8a9d92'), -1.45, .95, -1.37, .25, .06, .43); a.box(cream, -1.45, .99, -1.4, .22, .025, .37);
        for (let x = -.9; x <= 1; x += .3) a.box(this.mat('#c1cbb4', .98), x, 1.105, .72, .009, .006, 1.95);
        break;
      }
      case 'sofa': {
        const cloth = this.mat('#a5b6a4', .96, 0, true), cushion = this.mat('#b4c2af', .98, 0, true);
        a.round(oak, 0, .26, 0, 3.5, .19, 1.45); a.round(cloth, 0, .59, .04, 3.55, .5, 1.4); a.round(cloth, 0, 1.13, -.58, 3.6, 1.05, .38);
        for (const x of [-1.68, 1.68]) a.round(cloth, x, .9, .02, .33, .78, 1.5);
        for (const x of [-1.05, 0, 1.05]) { a.round(cushion, x, .88, .13, .99, .25, 1.05); a.round(cloth, x, 1.29, -.34, .98, .65, .24, 0, .03); }
        a.round(this.mat('#c59479', .97, 0, true), -1.08, 1.15, .0, .63, .61, .18, .2, -.14);
        a.round(this.mat('#dfd4b9', .98, 0, true), 1.05, 1.15, -.03, .63, .62, .18, -.2, .15);
        a.round(this.mat('#cdbd98', .98, 0, true), .7, .98, .47, .72, .035, .68); for (let i = 0; i < 7; i++) a.box(this.mat('#e0d5ba'), .4 + i * .08, 1.003, .8, .012, .012, .18);
        // A matching media console faces the sofa across the living-room rug.
        a.round(oak, 0, .42, 4.15, 2.75, .63, .64);
        for (const x of [-.9, 0, .9]) { a.box(paleOak, x, .43, 3.815, .85, .5, .025); a.box(brass, x, .57, 3.79, .2, .02, .025); }
        a.cyl(dark, 0, .84, 4.15, .035, .23); a.round(dark, 0, 1.44, 4.15, 2.0, 1.16, .075);
        a.box(this.mat('#587d80', .25, .16), 0, 1.44, 4.103, 1.88, 1.04, .015); a.box(this.mat('#9bad94'), 0, 1.18, 4.092, 1.82, .32, .006);
        a.sphere(this.mat('#d5c2a0'), 1.1, .93, 4.1, .13, .19, .13);
        break;
      }
      case 'kitchen': {
        a.box(oak, -.45, .53, 0, 3.65, .94, 1.5); a.round(this.mat('#e3ded0', .35), -.45, 1.04, 0, 3.74, .13, 1.57);
        for (let i = 0; i < 4; i++) { const x = -1.8 + i * .9; a.box(paleOak, x, .55, .763, .85, .8, .035); a.box(brass, x, .84, .795, .33, .025, .045); }
        a.box(this.mat('#c6d0c3'), -.45, 1.69, -.76, 3.7, 1.2, .055);
        for (let x = -2.2; x < 1.4; x += .3) a.box(this.mat('#d9dfd3'), x, 1.65, -.72, .012, 1.1, .01);
        a.box(this.mat('#e8e3d5'), -.45, 1.66, -.72, 3.7, .012, .01);
        a.box(this.mat('#9daea0'), -.5, 2.55, -.52, 3.65, .95, .52);
        for (let i = 0; i < 4; i++) { const x = -1.86 + i * .91; a.box(this.mat('#b6c1ae'), x, 2.55, -.243, .86, .88, .04); a.box(brass, x, 2.22, -.21, .27, .025, .035); }
        a.box(this.mat('#e8dfc4'), -.5, 2.045, -.35, 3.5, .03, .1);
        a.round(this.mat('#dde0d7', .38, .12), 1.83, 1.2, 0, .9, 2.3, 1.5); a.box(this.mat('#c2ccc0'), 1.83, 1.45, .76, .79, .018, .01);
        a.box(brass, 1.49, 1.8, .79, .035, .42, .04); a.box(brass, 1.49, .9, .79, .035, .32, .04);
        a.round(this.mat('#344740', .3, .2), -1.26, .59, .789, .75, .57, .05); a.box(this.mat('#687d76', .3), -1.26, .59, .822, .62, .41, .018); a.box(brass, -1.26, .93, .82, .48, .025, .04);
        a.box(dark, -1.26, 1.118, -.02, .94, .025, .72); for (const x of [-1.48, -1.04]) for (const z of [-.19, .16]) { a.cyl(this.mat('#65756a', .34, .3), x, 1.14, z, .14, .02); a.cyl(dark, x, 1.16, z, .1, .012); }
        a.round(this.mat('#a8b8ae', .28, .36), .23, 1.12, .02, 1.05, .03, .68); a.round(this.mat('#6d877e', .28), .23, 1.137, .02, .82, .02, .5);
        const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(.23, 1.15, -.37), new THREE.Vector3(.23, 1.62, -.37), new THREE.Vector3(.23, 1.67, -.13), new THREE.Vector3(.23, 1.47, -.06)]);
        a.custom(new THREE.TubeGeometry(curve, 14, .025, 8, false), brass, 0, 0, 0);
        a.cyl(this.mat('#e8dfc7'), .98, 1.29, .3, .13, .3); a.cyl(this.mat('#748f77'), .98, 1.52, .3, .08, .2);
        a.round(this.mat('#b89568'), -.45, 1.13, .38, .47, .025, .32, .2);
        break;
      }
      case 'shower': {
        a.round(this.mat('#e9e9dd', .3), 0, .19, 0, 1.98, .22, 1.98); a.round(this.mat('#c0c9ba', .3), 0, .31, 0, 1.75, .045, 1.75);
        const glass = new THREE.MeshPhysicalMaterial({ color: '#bbd8ce', transparent: true, opacity: .27, roughness: .16, metalness: .03, depthWrite: false, side: THREE.DoubleSide });
        a.box(glass, -.95, 1.55, 0, .025, 2.45, 1.94); a.box(glass, 0, 1.55, -.95, 1.94, 2.45, .025); a.box(glass, .3, 1.55, .95, 1.3, 2.45, .025);
        for (const x of [-.96, .96]) for (const z of [-.96, .96]) a.cyl(brass, x, 1.56, z, .018, 2.5);
        a.box(brass, 0, 2.82, -.96, 1.98, .035, .035); a.box(brass, -.96, 2.82, 0, .035, .035, 1.98); a.box(brass, .3, 2.82, .96, 1.3, .035, .035);
        a.cyl(brass, 0, 1.65, -.88, .028, 1.7); a.box(brass, 0, 2.48, -.62, .045, .045, .56); a.cyl(brass, 0, 2.45, -.33, .22, .045);
        a.cyl(this.mat('#8a9f91'), .34, .35, .3, .1, .025); a.box(brass, .68, 1.52, 1.0, .03, .42, .045);
        a.box(this.mat('#e4ded0'), .73, 1.25, -.83, .33, .035, .18); a.cyl(this.mat('#a4b49d'), .7, 1.43, -.83, .06, .31);
        break;
      }
      case 'desk': {
        a.round(paleOak, 0, .89, -.04, 2.45, .11, 1.3); for (const x of [-1.05, 1.05]) for (const z of [-.53, .43]) a.cyl(dark, x, .46, z, .035, .82);
        a.box(dark, -.25, 1.05, -.35, .05, .28, .05); a.round(dark, -.25, 1.44, -.37, 1.15, .7, .06); a.box(this.mat('#94b4ae'), -.25, 1.44, -.332, 1.05, .59, .012);
        a.box(this.mat('#e6decb'), -.48, 1.47, -.32, .37, .41, .006); a.box(this.mat('#647d77'), .05, 1.38, -.318, .28, .2, .006);
        a.round(this.mat('#d2d8cc'), -.3, .97, .26, .74, .045, .26); for (let i = 0; i < 10; i++) a.box(this.mat('#a2b0a5'), -.62 + i * .072, .996, .26, .035, .004, .17);
        a.sphere(this.mat('#d3d8ca'), .33, .99, .3, .085, .035, .13); a.cyl(this.mat('#e6dfc8'), .89, 1.07, -.26, .12, .28);
        for (const x of [.85, .9, .96]) a.cyl(this.mat('#7a927c'), x, 1.31, -.26, .012, .3, 0, x - .91);
        a.round(this.mat('#a9b6a5', .95, 0, true), -.25, .54, .37, .68, .17, .58); a.round(this.mat('#a9b6a5', .95, 0, true), -.25, .88, .6, .67, .64, .12);
        a.cyl(dark, -.25, .3, .36, .04, .39); for (let i = 0; i < 5; i++) a.box(dark, -.25, .15, .36, .69, .035, .045, i * Math.PI / 5);
        break;
      }
      case 'bookshelf': {
        a.box(oak, 0, 1.45, -.34, 2.18, 2.78, .07); for (const side of [-1, 1]) a.box(paleOak, side * 1.04, 1.45, 0, .09, 2.85, .77);
        const bookColors = ['#617c77', '#b18365', '#d3c8ad', '#8d9e84', '#8f8e8d', '#a4b6ab'];
        for (let shelf = 0; shelf < 5; shelf++) {
          const y = .15 + shelf * .65; a.box(paleOak, 0, y, 0, 2.1, .075, .78);
          for (let i = 0; i < 9; i++) { if ((shelf === 2 && i > 5) || (shelf === 3 && i < 3)) continue; const x = -.89 + i * .2, h = .35 + random(i + shelf * 31) * .18; a.box(this.mat(bookColors[(shelf * 2 + i) % 6]), x, y + .055 + h / 2, .07, .13 + random(i + 5) * .045, h, .48); a.box(this.mat('#d6cfb9'), x, y + .14, .317, .09, .018, .008); }
        }
        a.box(paleOak, 0, 2.85, 0, 2.18, .09, .79); a.cyl(this.mat('#d0bda0'), .67, 1.74, .06, .18, .52); a.cyl(this.mat('#e0d7bf'), -.67, 2.18, .04, .17, .11); a.sphere(this.mat('#9dac91'), -.67, 2.37, .04, .22, .22, .18);
        break;
      }
      case 'dining': {
        a.cyl(paleOak, 0, .83, 0, .69, .1); a.cyl(oak, 0, .43, 0, .16, .74); a.cyl(oak, 0, .1, 0, .43, .07);
        for (const side of [-1, 1]) { a.round(this.mat('#b9c0aa', .96, 0, true), side * .83, .49, 0, .36, .12, .58); a.round(this.mat('#b9c0aa', .96, 0, true), side * .99, .77, 0, .1, .51, .57); for (const z of [-.21, .21]) a.cyl(oak, side * .83, .25, z, .027, .45); }
        a.cyl(this.mat('#9a7c5a'), .0, .9, .03, .45, .025); a.cyl(this.mat('#e7dfcb', .3), -.16, .94, .14, .12, .035); a.cyl(this.mat('#ddd4bd', .3), -.16, 1.03, .14, .075, .13); a.cyl(this.mat('#8d7054'), -.16, 1.103, .14, .062, .005);
        a.sphere(this.mat('#b0c0ab', .35), .15, 1.04, -.12, .16, .13, .16); a.cyl(this.mat('#b0c0ab'), .15, 1.18, -.12, .07, .035);
        a.custom(new THREE.TorusGeometry(.065, .014, 6, 15), this.mat('#ddd4bd'), -.07, 1.035, .14, 0, Math.PI / 2);
        a.round(this.mat('#667f77'), -.32, .91, -.25, .31, .025, .4, -.2);
        break;
      }
      case 'plant': {
        a.custom(new THREE.CylinderGeometry(.34, .27, .65, 24), this.mat('#c9c0a9', .8), 0, .5, 0); a.cyl(this.mat('#6c6a50'), 0, .84, 0, .29, .035);
        for (const x of [-.22, .22]) for (const z of [-.22, .22]) a.cyl(oak, x, .2, z, .025, .3);
        for (let i = 0; i < 9; i++) { const angle = i * 2.3999, h = 1.15 + random(i + 8) * .9, x = Math.cos(angle) * .25, z = Math.sin(angle) * .25;
          const c = new THREE.CatmullRomCurve3([new THREE.Vector3(0, .8, 0), new THREE.Vector3(x * .4, h * .78, z * .4), new THREE.Vector3(x, h, z)]); a.custom(new THREE.TubeGeometry(c, 6, .014, 5, false), this.mat('#728062'), 0, 0, 0);
          a.add(sphere, this.mat(i % 2 ? '#6a8b6e' : '#809a79'), x, h, z, .16, .36, .055, Math.sin(angle) * .6, angle, Math.cos(angle) * .55);
        }
        break;
      }
    }
    a.finish(group); return group;
  }

  private makePerson(color: string): Rig {
    const group = new THREE.Group(), a = new DetailBatch(); const cloth = this.mat(color, .94, 0, true), skin = this.mat('#dfbb98'), pants = this.mat('#445851'), hair = this.mat('#413e35');
    a.custom(new THREE.CylinderGeometry(.255, .21, .59, 12), cloth, 0, 1.21, 0); // soft, tapered torso
    a.sphere(skin, 0, 1.73, 0, .205, .25, .205); a.cyl(skin, 0, 1.48, 0, .085, .18);
    a.custom(new THREE.SphereGeometry(.216, 14, 10, 0, Math.PI * 2, 0, Math.PI * .56), hair, 0, 1.77, -.012);
    for (const x of [-.071, .071]) a.sphere(this.mat('#41463b'), x, 1.76, .19, .015, .018, .009);
    a.sphere(skin, 0, 1.7, .205, .028, .035, .035); a.box(this.mat('#eee5d1'), 0, 1.46, .19, .14, .11, .035);
    a.finish(group); const arms: THREE.Group[] = [], legs: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const arm = new THREE.Group(); arm.position.set(side * .31, 1.44, 0); const b = new DetailBatch(); b.custom(new THREE.CapsuleGeometry(.08, .2, 4, 8), cloth, 0, -.13, 0); b.custom(new THREE.CapsuleGeometry(.063, .18, 4, 8), skin, 0, -.39, 0); b.sphere(skin, 0, -.54, .015, .065, .08, .065); b.finish(arm); arms.push(arm); group.add(arm);
      const leg = new THREE.Group(); leg.position.set(side * .135, .95, 0); const c = new DetailBatch(); c.custom(new THREE.CapsuleGeometry(.09, .57, 4, 8), pants, 0, -.38, 0); c.round(this.mat('#e1ded0'), 0, -.82, .075, .22, .15, .36); c.finish(leg); legs.push(leg); group.add(leg);
    }
    return { group, arms, legs };
  }

  sync(state: GameState) {
    const home = state.homes.find(h => h.homeId === state.interior?.homeId), furniture = home?.furniture || [], ids = new Set(furniture.map(f => f.id));
    for (const [id, group] of this.furnitureMeshes) if (!ids.has(id)) { this.remove(group); this.furnitureMeshes.delete(id); this.furnishingKeys.delete(id); }
    this.obstacles = [
      { x: -.8, z: -4.85, width: .18, depth: 5.3, rotation: 0 },
      { x: 4.78, z: 5.52, width: .16, depth: 3.95, rotation: 0 },
      { x: 8.4, z: 5.7, width: .95, depth: 1.5, rotation: 0 },
      { x: -7.15, z: .7, width: .5, depth: .5, rotation: 0 },
    ];
    for (const f of furniture) {
      const def = FURNITURE[f.kind]; this.obstacles.push({ x: def.x, z: def.z, width: def.width, depth: def.depth, rotation: def.rotation });
      if (f.kind === 'sofa') this.obstacles.push({ x: def.x, z: def.z + 4.15, width: 2.75, depth: .64, rotation: 0 });
      if (this.furnishingKeys.get(f.id) === f.kind) continue;
      const old = this.furnitureMeshes.get(f.id); if (old) this.remove(old);
      const group = this.furniture(f.kind); group.position.set(def.x, .08, def.z); group.rotation.y = def.rotation; group.userData.furnitureId = f.id;
      group.traverse(o => o.userData.furnitureId = f.id); this.scene.add(group); this.furnitureMeshes.set(f.id, group); this.furnishingKeys.set(f.id, f.kind);
    }
    const guestId = state.interior?.guestId ?? null;
    if (guestId !== this.guestId) {
      if (this.guest) this.remove(this.guest.group); this.guest = null; this.guestId = guestId;
      const resident = state.residents.find(r => r.id === guestId);
      if (resident) { this.guest = this.makePerson(resident.color); this.guest.group.position.set(0, .08, 1.3); this.guest.group.traverse(o => o.userData.residentId = resident.id); this.scene.add(this.guest.group); }
    }
    this.highlight(this.selectedId);
  }

  update(dt: number, state: GameState, mode: CameraMode) {
    const step = Number.isFinite(dt) ? Math.max(0, dt) : 0; this.clock += step;
    const p = state.player; const moving = this.lastPosition.distanceToSquared(new THREE.Vector2(p.x, p.z)) > .00001;
    this.player.position.set(p.x, .08, p.z); this.player.rotation.y = p.yaw; this.player.visible = mode !== 'first';
    const stride = moving ? Math.sin(this.clock * 10.5) * .48 : 0;
    this.rig.legs.forEach((leg, i) => leg.rotation.x = i ? -stride : stride); this.rig.arms.forEach((arm, i) => arm.rotation.x = i ? stride * .65 : -stride * .65); this.lastPosition.set(p.x, p.z);
    if (this.guest) { this.guest.group.position.y = .08 + Math.sin(this.clock * 1.5) * .008; this.guest.group.rotation.y = Math.atan2(p.x, p.z - 1.3); this.guest.arms.forEach((arm, i) => arm.rotation.z = Math.sin(this.clock * .8 + i) * .025); }
    const day = THREE.MathUtils.clamp(Math.sin((state.hour - 6) / 12 * Math.PI) * 1.6, 0, 1); this.sun.intensity = 1.0 + day * 2.1; this.sky.intensity = 1.3 + day * .5;
    (this.scene.background as THREE.Color).lerpColors(this.night, this.daylight, day); (this.scene.fog as THREE.Fog).color.copy(this.scene.background as THREE.Color);
  }

  highlight(id: number | null) {
    this.selectedId = id; const kind = id === null ? null : this.furnishingKeys.get(id); this.selection.visible = !!kind;
    if (kind) { const def = FURNITURE[kind]; this.selection.position.set(def.x, .15, def.z); this.selection.rotation.set(-Math.PI / 2, 0, -def.rotation); this.selection.scale.set(def.width + .25, def.depth + .25, 1); }
  }

  /** Continuous movement uses short swept steps, then resolves a circular body against rotated slots. */
  move(x: number, z: number, dx: number, dz: number) {
    if (![x, z, dx, dz].every(Number.isFinite)) return { x: 0, z: 5.6 };
    const radius = .3, steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .11));
    let px = x, pz = z;
    for (let i = 0; i < steps; i++) {
      const beforeX = px, beforeZ = pz;
      px += dx / steps; pz += dz / steps;
      for (let pass = 0; pass < 3; pass++) {
        px = THREE.MathUtils.clamp(px, -8.84 + radius, 8.84 - radius); pz = THREE.MathUtils.clamp(pz, -7.35 + radius, 7.35 - radius);
        for (const rect of this.obstacles) {
          const c = Math.cos(rect.rotation), s = Math.sin(rect.rotation), ox = px - rect.x, oz = pz - rect.z;
          let lx = c * ox - s * oz, lz = s * ox + c * oz; const hx = rect.width / 2, hz = rect.depth / 2;
          const cx = THREE.MathUtils.clamp(lx, -hx, hx), cz = THREE.MathUtils.clamp(lz, -hz, hz), vx = lx - cx, vz = lz - cz, sq = vx * vx + vz * vz;
          if (sq >= radius * radius) continue;
          if (sq > 1e-10) { const push = radius / Math.sqrt(sq) - 1; lx += vx * push; lz += vz * push; }
          else if (hx - Math.abs(lx) < hz - Math.abs(lz)) lx = (lx >= 0 ? 1 : -1) * (hx + radius);
          else lz = (lz >= 0 ? 1 : -1) * (hz + radius);
          px = rect.x + c * lx + s * lz; pz = rect.z - s * lx + c * lz;
        }
      }
      // Two nearby pieces can form a gap narrower than the body. Keep the last valid
      // position rather than allowing competing penetration corrections to cross a wall.
      if (!this.canStand(px, pz, radius)) {
        px = beforeX; pz = beforeZ;
        if (!this.canStand(px, pz, radius)) {
          let escaped = false;
          for (let r = .2; r <= 3 && !escaped; r += .2) for (let j = 0; j < 24; j++) {
            const ex = beforeX + Math.cos(j * Math.PI / 12) * r, ez = beforeZ + Math.sin(j * Math.PI / 12) * r;
            if (this.canStand(ex, ez, radius)) { px = ex; pz = ez; escaped = true; break; }
          }
          if (!escaped) { px = 0; pz = 5.6; }
        }
      }
    }
    return { x: px, z: pz };
  }

  private canStand(x: number, z: number, radius: number) {
    if (Math.abs(x) > 8.84 - radius + 1e-6 || Math.abs(z) > 7.35 - radius + 1e-6) return false;
    for (const rect of this.obstacles) {
      const c = Math.cos(rect.rotation), s = Math.sin(rect.rotation), ox = x - rect.x, oz = z - rect.z;
      const lx = c * ox - s * oz, lz = s * ox + c * oz;
      const dx = Math.max(0, Math.abs(lx) - rect.width / 2), dz = Math.max(0, Math.abs(lz) - rect.depth / 2);
      if (dx * dx + dz * dz < radius * radius - 1e-7) return false;
    }
    return true;
  }

  private remove(group: THREE.Group) { this.scene.remove(group); group.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.geometry) mesh.geometry.dispose(); }); group.clear(); }
  dispose() {
    const allMaterials = new Set<THREE.Material>(); this.scene.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.geometry) mesh.geometry.dispose(); if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(m => allMaterials.add(m)); });
    this.materialCache.forEach(m => allMaterials.add(m)); allMaterials.forEach(m => m.dispose()); this.textures.forEach(t => t.dispose()); this.scene.clear(); this.furnitureMeshes.clear(); this.materialCache.clear(); this.textures.clear();
  }
}
