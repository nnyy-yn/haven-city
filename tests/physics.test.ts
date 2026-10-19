import test from 'node:test';
import assert from 'node:assert/strict';
import {CityPhysics} from '../src/physics.ts';
import {Simulation} from '../src/simulation.ts';
import {cellToWorld} from '../src/types.ts';

test('loading a city with reused building IDs moves and removes its collision walls',async()=>{
  const physics=await CityPhysics.create();
  try{
    const state=new Simulation().state;
    const home={id:1,kind:'home' as const,gx:11,gz:11,level:1,active:true};state.buildings=[home];
    const oldX=cellToWorld(home.gx),z=cellToWorld(home.gz);physics.sync(state);
    assert.ok(physics.move(oldX-8,z,16,0,1/60).x<oldX-3,'the original house blocks walking');
    state.buildings=[{...home,gx:17}];physics.sync(state);
    assert.ok(physics.move(oldX-8,z,16,0,1/60).x>oldX+4,'the old position has no invisible wall after import');
    const newX=cellToWorld(17);
    assert.ok(physics.move(newX-8,z,16,0,1/60).x<newX-3,'the imported house blocks its new position');
    state.buildings=[{...home,kind:'road',gx:17}];physics.sync(state);
    assert.ok(physics.move(newX-8,z,16,0,1/60).x>newX+4,'changing the same ID to a road removes its collider');
  }finally{physics.dispose();}
});
