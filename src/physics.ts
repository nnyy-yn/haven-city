import RAPIER from '@dimforge/rapier3d-compat';
import { cellToWorld, type GameState } from './types';

export class CityPhysics {
  private world: RAPIER.World;
  private controller: RAPIER.KinematicCharacterController;
  private capsule: RAPIER.Collider;
  private obstacles = new Map<number, RAPIER.Collider>();
  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(300, .2, 300).setTranslation(0,-.2,0));
    this.capsule = this.world.createCollider(RAPIER.ColliderDesc.capsule(.52,.32).setTranslation(-5,.88,5));
    this.controller = this.world.createCharacterController(.025);
    this.controller.enableAutostep(.2,.15,false);
    this.controller.enableSnapToGround(.2);
  }
  static async create() { await RAPIER.init(); return new CityPhysics(); }
  sync(state: GameState) {
    const ids = new Set(state.buildings.map(b=>b.id));
    for (const [id,c] of this.obstacles) if(!ids.has(id)) { this.world.removeCollider(c,true);this.obstacles.delete(id); }
    for(const b of state.buildings) {
      if(b.kind==='road'||b.kind==='park'||this.obstacles.has(b.id)) continue;
      const half = b.kind==='prison'?4.2:b.kind==='home'?3:3.5;
      const c = this.world.createCollider(RAPIER.ColliderDesc.cuboid(half,10,half).setTranslation(cellToWorld(b.gx),10,cellToWorld(b.gz)));
      this.obstacles.set(b.id,c);
    }
  }
  move(x:number,z:number,dx:number,dz:number,dt:number) {
    this.capsule.setTranslation({x,y:.88,z});
    this.world.timestep=Math.min(dt,1/30);
    this.world.step();
    this.controller.computeColliderMovement(this.capsule,{x:dx,y:-.3*dt,z:dz});
    const m=this.controller.computedMovement();
    return {x:Math.max(-119,Math.min(119,x+m.x)),z:Math.max(-119,Math.min(119,z+m.z))};
  }
  dispose(){ this.world.free(); }
}
