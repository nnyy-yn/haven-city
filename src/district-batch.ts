import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

interface Entry { group: THREE.Group; chunk: string; signature: string; meshes: THREE.Mesh[] }

/** The source meshes remain available to raycasts; only the rendering is consolidated. */
export class DistrictBatch {
  private layer = new THREE.Group();
  private entries = new Map<number, Entry>();
  private chunks = new Map<string, THREE.Group>();
  private originalVisibility = new WeakMap<THREE.Mesh, boolean>();
  private enabled = true;
  private sourceCount = 0;
  private mergedCount = 0;

  constructor(scene: THREE.Scene) { this.layer.name = 'Static district material batches'; scene.add(this.layer); }

  sync(buildings: ReadonlyMap<number, THREE.Group>) {
    const dirty = new Set<string>();
    for (const [id, entry] of this.entries) if (!buildings.has(id)) { dirty.add(entry.chunk); this.entries.delete(id); }
    for (const [id, group] of buildings) {
      group.updateMatrixWorld(true);
      const chunk = `${Math.floor(group.position.x / 60)},${Math.floor(group.position.z / 60)}`;
      const signature = `${group.uuid}:${group.matrixWorld.elements.join(',')}`;
      const previous = this.entries.get(id);
      if (previous?.signature === signature) continue;
      if (previous) dirty.add(previous.chunk);
      const meshes: THREE.Mesh[] = [];
      group.traverse(object => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh || Array.isArray(mesh.material)) return;
        if (!this.originalVisibility.has(mesh)) this.originalVisibility.set(mesh, mesh.visible);
        meshes.push(mesh); mesh.visible = this.enabled ? false : this.originalVisibility.get(mesh)!;
      });
      this.entries.set(id, { group, chunk, signature, meshes }); dirty.add(chunk);
    }
    dirty.forEach(chunk => this.rebuild(chunk));
    this.sourceCount = [...this.entries.values()].reduce((count, entry) => count + entry.meshes.length, 0);
    this.mergedCount = [...this.chunks.values()].reduce((count, group) => count + group.children.length, 0);
  }

  private rebuild(chunk: string) {
    const old = this.chunks.get(chunk);
    if (old) { old.traverse(object => (object as THREE.Mesh).geometry?.dispose()); this.layer.remove(old); this.chunks.delete(chunk); }
    const parts = new Map<string, { material: THREE.Material; cast: boolean; receive: boolean; geometries: THREE.BufferGeometry[] }>();
    for (const entry of this.entries.values()) if (entry.chunk === chunk) for (const mesh of entry.meshes) {
      if (!this.originalVisibility.get(mesh)) continue;
      const material = mesh.material as THREE.Material, key = `${material.uuid}:${Number(mesh.castShadow)}:${Number(mesh.receiveShadow)}`;
      let part = parts.get(key);
      if (!part) { part = { material, cast: mesh.castShadow, receive: mesh.receiveShadow, geometries: [] }; parts.set(key, part); }
      const source = mesh.geometry.clone(), geometry = source.index ? source.toNonIndexed() : source;
      if (source !== geometry) source.dispose();
      geometry.applyMatrix4(mesh.matrixWorld); part.geometries.push(geometry);
    }
    if (!parts.size) return;
    const group = new THREE.Group(); group.name = `District ${chunk}`;
    for (const part of parts.values()) {
      const geometry = mergeGeometries(part.geometries, false);
      part.geometries.forEach(source => source.dispose());
      if (!geometry) continue;
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, part.material); mesh.castShadow = part.cast; mesh.receiveShadow = part.receive;
      mesh.raycast = () => {}; mesh.userData.renderBatch = true; group.add(mesh);
    }
    this.layer.add(group); this.chunks.set(chunk, group);
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled; this.layer.visible = enabled;
    for (const entry of this.entries.values()) for (const mesh of entry.meshes) mesh.visible = enabled ? false : this.originalVisibility.get(mesh)!;
  }

  getDiagnostics() { return { enabled: this.enabled, sourceMeshes: this.sourceCount, batchMeshes: this.mergedCount, chunks: this.chunks.size }; }

  dispose() {
    this.setEnabled(false);
    this.layer.traverse(object => (object as THREE.Mesh).geometry?.dispose());
    this.layer.removeFromParent(); this.chunks.clear(); this.entries.clear();
  }
}
