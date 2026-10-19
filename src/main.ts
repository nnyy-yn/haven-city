import * as THREE from 'three';
import { Simulation } from './simulation';
import { CityWorld } from './world';
import { CityPhysics } from './physics';
import { InteriorWorld } from './interior';
import { GameUI } from './ui';
import { BUILDINGS, FURNITURE, wageFor, cellToWorld, worldToCell, type ActionResult, type Building, type BuildingKind, type CameraMode, type Interaction, type Resident, type Tool } from './types';
import './style.css';

const canvas = document.querySelector<HTMLCanvasElement>('#world')!;
const mount = document.querySelector<HTMLElement>('#ui')!;
mount.innerHTML = '<div class="boot-splash" style="position:fixed;inset:0;display:grid;place-content:center;background:#e9eee3;color:#2e5145;text-align:center;font:18px Segoe UI,sans-serif;z-index:100"><strong style="font-size:40px;letter-spacing:10px">栖湾市</strong><p>正在唤醒这座城市…</p></div>';

async function boot() {
  const sim = new Simulation();
  try { if(localStorage.getItem('haven-city-save-v1'))sim.load(); } catch { /* Storage may be disabled; the city remains playable. */ }
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'}); }
  catch { mount.innerHTML='<div style="padding:10vh;background:#f1f1e8;height:100vh"><h1>这座城市需要 3D 图形支持</h1><p>请使用支持 WebGL 2 的 Chrome 或 Edge，并开启浏览器硬件加速后重新打开。</p></div>'; return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.65));
  renderer.setSize(innerWidth,innerHeight);
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=.95;
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  const world=new CityWorld();
  const homeWorld=new InteriorWorld();
  const physics=await CityPhysics.create();
  const camera=new THREE.PerspectiveCamera(43,innerWidth/innerHeight,.15,1800);
  const ray=new THREE.Raycaster();
  const pointer=new THREE.Vector2();
  let mode:CameraMode=sim.state.interior?'third':'city';
  let tool:Tool='select';
  let selected:Building|Resident|null=null;
  const target=new THREE.Vector3(5,0,5);
  let cityYaw=.56, cityPitch=.66, distance=245;
  let lifeYaw=sim.state.interior?sim.state.player.yaw:0, lifePitch=.22;
  let interiorZoom=1;
  let drag:{x:number;y:number;button:number;lastX:number;lastY:number;moved:boolean}|null=null;
  const keys=new Set<string>();
  let uiTimer=0,physicsTimer=0,saveTimer=0,lastFrame=performance.now(),contextAction:Interaction|undefined,contextTarget:number|undefined;
  let lastPaint='';
  let lastRoadCell:{gx:number;gz:number}|null=null;
  let contextLost=false;
  let sprint=false;

  function setMode(next:CameraMode) {
    if(next==='city'&&sim.state.interior){sim.exitHome();homeWorld.highlight(null);}
    mode=next; tool='select';world.setGhost(null,0,0,true);
    world.player.visible=next!=='first';
    if(document.pointerLockElement) document.exitPointerLock();
    keys.clear(); drag=null;
    if(next==='city') {target.set(sim.state.player.x,0,sim.state.player.z);distance=220;}
    else {lifeYaw=sim.state.player.yaw||0;lifePitch=next==='first'?.025:.18;}
    selected=null;world.highlight(null);
    updateCamera(1);refresh();
  }
  function syncWorlds(){world.sync(sim.state);physics.sync(sim.state);homeWorld.sync(sim.state);}
  function runAction(action:()=>ActionResult,forceLocation=false){
    const before=sim.state.interior?.homeId??null;
    const result=action();
    ui.toast(result.message,result.ok?'good':'bad');
    syncWorlds();
    if(before!==(sim.state.interior?.homeId??null)||forceLocation){
      keys.clear();drag=null;selected=null;world.highlight(null);homeWorld.highlight(null);
      if(document.pointerLockElement)document.exitPointerLock();
      if(sim.state.interior&&mode==='city')mode='third';
      lifeYaw=sim.state.player.yaw;lifePitch=mode==='first'?.025:.18;
      target.set(sim.state.player.x,0,sim.state.player.z);
      updateCamera(1);
    }
    findContext();refresh();
    return result;
  }
  function interact(action:Interaction,id?:number){runAction(()=>sim.interact(action,id));}
  function openJournal(id?:number){
    keys.clear();drag=null;
    if(document.pointerLockElement)document.exitPointerLock();
    ui.openJournal(id);refresh();
  }
  function focusEvent(id:number){
    const event=sim.state.civic.events.find(e=>e.id===id);
    const building=sim.state.buildings.find(b=>b.id===event?.buildingId);
    if(!building){ui.toast('事件现场已恢复，暂时没有可定位的地点。','info');return;}
    if(mode!=='city')setMode('city');
    tool='select';keys.clear();drag=null;lastRoadCell=null;lastPaint='';
    world.setGhost(null,0,0,true);
    selected=building;world.highlight(building.id);
    target.set(cellToWorld(building.gx),0,cellToWorld(building.gz));distance=125;
    updateCamera(1);refresh();
  }
  function focus(){
    if(mode==='city') {
      if(selected&&'gx' in selected) target.set(cellToWorld(selected.gx),0,cellToWorld(selected.gz));
      else if(selected&&'x' in selected) target.set(selected.x,0,selected.z);
      else target.set(sim.state.player.x,0,sim.state.player.z);
      distance=Math.min(distance,190);
    } else if(sim.state.interior){lifeYaw=Math.PI;lifePitch=.18;interiorZoom=1;}
    else if(selected&&'x' in selected){
      const npc=selected;lifeYaw=Math.atan2(npc.x-sim.state.player.x,npc.z-sim.state.player.z);
    } else {lifeYaw=0;lifePitch=.2;}
  }
  const ui=new GameUI(mount,{
    tool(next){if(mode!=='city')setMode('city');tool=next;selected=null;world.highlight(null);refresh();},
    mode:setMode,
    speed:speed=>{sim.setSpeed(speed);refresh();},
    tax:value=>{sim.setTax(value);refresh();},
    interact,
    buyFurniture:kind=>{runAction(()=>sim.buyFurniture(kind));},
    sellFurniture:id=>{runAction(()=>sim.sellFurniture(id));},
    socialize:(action,id)=>{runAction(()=>sim.socialize(action,id));},
    prisonRegime:regime=>{runAction(()=>sim.setPrisonRegime(regime));},
    prisonIntake:enabled=>{runAction(()=>sim.setPrisonIntake(enabled));},
    upgrade:id=>{runAction(()=>sim.upgradeBuilding(id));},
    career:track=>{runAction(()=>sim.setCareer(track));},
    policy:(policy,enabled)=>{runAction(()=>sim.setPolicy(policy,enabled));},
    resolveEvent:(id,choice)=>{runAction(()=>sim.resolveEvent(id,choice));},
    focusEvent,
    save:()=>{const r=sim.save();ui.toast(r.message,r.ok?'good':'bad');},
    load:()=>{runAction(()=>sim.load(),true);},
    reset:()=>{sim.reset();selected=null;tool='select';setMode('city');distance=245;cityPitch=.66;target.set(5,0,5);syncWorlds();refresh();},
    focus,
    selectResident:id=>{selected=sim.state.residents.find(r=>r.id===id)||null;refresh();}
  });
  function refresh(){ui.update(sim.state,mode,tool,selected);}
  function pointRay(x:number,y:number){pointer.set(x/innerWidth*2-1,-y/innerHeight*2+1);ray.setFromCamera(pointer,camera);}
  function groundPoint(x:number,y:number){
    pointRay(x,y);
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),0),new THREE.Vector3());
  }
  function validCell(kind:BuildingKind|'bulldoze',gx:number,gz:number){
    if(gx<0||gx>22||gz<1||gz>22)return false;
    const occupied=sim.state.buildings.some(b=>b.gx===gx&&b.gz===gz);
    if(kind==='bulldoze')return occupied;
    if(occupied||sim.state.money<BUILDINGS[kind].cost)return false;
    return kind==='road'||sim.state.buildings.some(b=>b.kind==='road'&&Math.abs(b.gx-gx)+Math.abs(b.gz-gz)===1);
  }
  function preview(x:number,y:number){
    if(mode!=='city'||tool==='select'){world.setGhost(null,0,0,true);return;}
    const p=groundPoint(x,y);if(!p)return;
    const gx=worldToCell(p.x),gz=worldToCell(p.z);
    world.setGhost(tool,gx,gz,validCell(tool,gx,gz));
    canvas.style.cursor='crosshair';
  }
  function paint(x:number,y:number){
    if(tool==='select'||mode!=='city')return;
    const p=groundPoint(x,y);if(!p)return;
    const gx=worldToCell(p.x),gz=worldToCell(p.z),key=`${gx},${gz}`;
    if(key===lastPaint)return;lastPaint=key;
    if(tool==='road'){
      const from=lastRoadCell??{gx,gz};
      let cx=from.gx,cz=from.gz;
      const cells=[{gx:cx,gz:cz}],dx=gx-cx,dz=gz-cz;
      const steps=Math.abs(dx)+Math.abs(dz);
      // Fill every crossed tile, including sparse pointer events, with a connected stair-step path.
      for(let i=0;i<steps;i++){
        if(cx!==gx&&(cz===gz||Math.abs(cx-from.gx+Math.sign(dx))/Math.max(1,Math.abs(dx))<=Math.abs(cz-from.gz+Math.sign(dz))/Math.max(1,Math.abs(dz))))cx+=Math.sign(dx);
        else cz+=Math.sign(dz);
        cells.push({gx:cx,gz:cz});
      }
      for(const cell of cells){
        const occupied=sim.state.buildings.find(b=>b.gx===cell.gx&&b.gz===cell.gz);
        if(occupied?.kind==='road'){lastRoadCell=cell;continue;}
        const result=sim.build('road',cell.gx,cell.gz);
        if(!result.ok){ui.toast(result.message,'bad');break;}
        lastRoadCell=cell;
      }
      syncWorlds();preview(x,y);refresh();return;
    }
    const result=tool==='bulldoze'?sim.demolish(gx,gz):sim.build(tool,gx,gz);
    ui.toast(result.message,result.ok?'good':'bad');
    world.sync(sim.state);physics.sync(sim.state);preview(x,y);refresh();
  }
  function selectAt(x:number,y:number){
    pointRay(x,y);
    if(sim.state.interior){
      const hits=ray.intersectObjects(homeWorld.scene.children,true);
      for(const hit of hits){
        let obj:THREE.Object3D|null=hit.object;
        while(obj){
          if(obj.userData.furnitureId!==undefined){homeWorld.highlight(obj.userData.furnitureId);interact('furniture',obj.userData.furnitureId);return;}
          if(obj.userData.residentId!==undefined){selected=sim.state.residents.find(r=>r.id===obj!.userData.residentId)||null;refresh();return;}
          obj=obj.parent;
        }
      }
      selected=null;homeWorld.highlight(null);refresh();return;
    }
    const hits=ray.intersectObjects(world.scene.children,true);
    let buildingId:number|undefined,residentId:number|undefined;
    for(const hit of hits){
      if(hit.instanceId!==undefined&&hit.object.userData.residentIds){residentId=hit.object.userData.residentIds[hit.instanceId];if(residentId!==undefined)break;}
      let o:THREE.Object3D|null=hit.object;
      while(o){if(o.userData.eventId!==undefined){openJournal(o.userData.eventId);return;}if(o.userData.residentId!==undefined){residentId=o.userData.residentId;break;}if(o.userData.buildingId!==undefined){buildingId=o.userData.buildingId;break;}o=o.parent;}
      if(buildingId!==undefined||residentId!==undefined)break;
    }
    selected=residentId!==undefined?sim.state.residents.find(r=>r.id===residentId)||null:sim.state.buildings.find(b=>b.id===buildingId)||null;
    world.highlight(buildingId??null);refresh();
  }
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('pointerdown',e=>{
    if(ui.isModalOpen())return;
    canvas.setPointerCapture(e.pointerId);
    drag={x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,button:e.button,moved:false};
    if(mode==='city'&&e.button===0&&tool!=='select'){lastPaint='';lastRoadCell=null;paint(e.clientX,e.clientY);}
    if(mode==='first'&&e.button===0&&!document.pointerLockElement){try{canvas.requestPointerLock()?.catch(()=>{});}catch{}}
  });
  canvas.addEventListener('pointermove',e=>{
    if(ui.isModalOpen())return;
    preview(e.clientX,e.clientY);
    if(mode==='first'&&document.pointerLockElement===canvas){lifeYaw-=e.movementX*.0025;lifePitch=Math.max(-1.2,Math.min(1.25,lifePitch+e.movementY*.0025));return;}
    if(!drag)return;
    const dx=e.clientX-drag.lastX,dy=e.clientY-drag.lastY;
    if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>5)drag.moved=true;
    if(mode==='city'){
      if(drag.button===2){cityYaw-=dx*.005;cityPitch=Math.max(.24,Math.min(1.4,cityPitch+dy*.004));}
      else if(drag.button===1||(drag.button===0&&tool==='select'&&drag.moved)){
        const scale=distance*.0013;
        target.x+=(-dx*Math.cos(cityYaw)-dy*Math.sin(cityYaw))*scale;
        target.z+=(dx*Math.sin(cityYaw)-dy*Math.cos(cityYaw))*scale;
      }else if(drag.button===0&&tool==='road')paint(e.clientX,e.clientY);
    }else if(drag.button===2){lifeYaw-=dx*.005;lifePitch=Math.max(-.45,Math.min(.95,lifePitch+dy*.004));}
    drag.lastX=e.clientX;drag.lastY=e.clientY;
  });
  function finishDrag(e:PointerEvent){
    if(drag&&!drag.moved&&drag.button===0&&tool==='select'&&mode!=='first')selectAt(e.clientX,e.clientY);
    if(drag&&!drag.moved&&drag.button===2&&mode==='city'&&selected&&'x' in selected){
      const p=groundPoint(e.clientX,e.clientY);
      if(p){const result=sim.commandResident(selected.id,p.x,p.z);ui.toast(result.message,result.ok?'good':'bad');refresh();}
    }
    drag=null;lastPaint='';lastRoadCell=null;
    if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
  }
  canvas.addEventListener('pointerup',finishDrag);
  canvas.addEventListener('pointercancel',()=>{drag=null;lastRoadCell=null;keys.clear();});
  canvas.addEventListener('pointerleave',()=>{if(!drag)world.setGhost(null,0,0,true);});
  canvas.addEventListener('wheel',e=>{
    if(ui.isModalOpen())return;e.preventDefault();
    if(mode==='city')distance=Math.max(65,Math.min(560,distance*Math.exp(e.deltaY*.001)));
    else if(sim.state.interior&&mode==='third')interiorZoom=THREE.MathUtils.clamp(interiorZoom*Math.exp(e.deltaY*.0008),.85,1.3);
  },{passive:false});
  window.addEventListener('keydown',e=>{
    if((e.target as HTMLElement).matches('input,textarea,select'))return;
    if((e.target as HTMLElement).closest('button')&&['Space','Enter'].includes(e.code))return;
    if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD'].includes(e.code))e.preventDefault();
    if(e.code==='Escape'){if(document.pointerLockElement)document.exitPointerLock();tool='select';selected=null;world.highlight(null);world.setGhost(null,0,0,true);keys.clear();refresh();return;}
    if(ui.isModalOpen())return;
    keys.add(e.code);if(e.repeat)return;
    if(e.code==='Digit1')setMode('city');
    if(e.code==='Digit2')setMode('third');
    if(e.code==='Digit3')setMode('first');
    if(e.code==='Space'){sim.setSpeed(sim.state.speed?0:1);refresh();}
    if(e.code==='KeyF'&&contextAction&&mode!=='city')interact(contextAction,contextTarget);
    if(e.code==='KeyH'&&mode!=='city')interact(sim.state.interior?'exit':'enter');
    if(e.code==='KeyJ')openJournal();
    if(e.code==='KeyR')focus();
    if(e.code==='KeyB'&&mode==='city'){tool=tool==='road'?'select':'road';refresh();}
  });
  window.addEventListener('keyup',e=>keys.delete(e.code));
  window.addEventListener('blur',()=>{keys.clear();drag=null;});
  document.addEventListener('visibilitychange',()=>{keys.clear();lastFrame=performance.now();});
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();contextLost=true;keys.clear();ui.toast('图形上下文暂时丢失，正在等待恢复…','info');});
  canvas.addEventListener('webglcontextrestored',()=>{contextLost=false;ui.toast('3D 画面已恢复','good');});
  window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.65));refresh();});

  function updateCamera(dt:number){
    const blocked=ui?.isModalOpen()??false;
    if(blocked)keys.clear();
    if(mode==='city'){
      if(!blocked){
        const mx=Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'));
        const mz=Number(keys.has('KeyS')||keys.has('ArrowDown'))-Number(keys.has('KeyW')||keys.has('ArrowUp'));
        const rate=distance*.36*dt;
        target.x+=(mx*Math.cos(cityYaw)+mz*Math.sin(cityYaw))*rate;
        target.z+=(-mx*Math.sin(cityYaw)+mz*Math.cos(cityYaw))*rate;
        cityYaw+=(Number(keys.has('KeyQ'))-Number(keys.has('KeyE')))*dt;
      }
      target.x=THREE.MathUtils.clamp(target.x,-160,160);target.z=THREE.MathUtils.clamp(target.z,-160,160);
      camera.position.set(target.x+Math.sin(cityYaw)*distance*Math.cos(cityPitch),Math.sin(cityPitch)*distance,target.z+Math.cos(cityYaw)*distance*Math.cos(cityPitch));
      camera.lookAt(target);
    }else{
      const p=sim.state.player;
      if(!blocked){
        lifeYaw+=(Number(keys.has('KeyQ'))-Number(keys.has('KeyE')))*dt*1.5;
        const f=Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown'));
        const r=Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'));
        const norm=Math.hypot(f,r)||1;sprint=keys.has('ShiftLeft')&&p.energy>10;
        const speed=(sim.state.interior?(sprint?5.2:3.6):(sprint?11:6))*dt;
        const dx=(Math.sin(lifeYaw)*f-Math.cos(lifeYaw)*r)*speed/norm;
        const dz=(Math.cos(lifeYaw)*f+Math.sin(lifeYaw)*r)*speed/norm;
        if(dx||dz){const next=sim.state.interior?homeWorld.move(p.x,p.z,dx,dz):physics.move(p.x,p.z,dx,dz,dt);p.x=next.x;p.z=next.z;p.yaw=Math.atan2(dx,dz);if(sprint)p.energy=Math.max(0,p.energy-dt*.25);}
      }
      const look=new THREE.Vector3(p.x,1.5,p.z);
      if(mode==='first'){
        camera.position.set(p.x,1.78,p.z);look.copy(camera.position).add(new THREE.Vector3(Math.sin(lifeYaw)*Math.cos(lifePitch),-Math.sin(lifePitch),Math.cos(lifeYaw)*Math.cos(lifePitch)));camera.lookAt(look);
      }else{
        const indoor=Boolean(sim.state.interior);
        const follow=indoor?17*interiorZoom:10;
        // A room overview keeps furniture and routes visible; first person gives an eye-level view.
        if(indoor)look.set(p.x*.24,.9,p.z*.24);
        const desired=new THREE.Vector3((indoor?look.x:p.x)-Math.sin(lifeYaw)*follow,(indoor?14*interiorZoom:5)+lifePitch*(indoor?3:5),(indoor?look.z:p.z)-Math.cos(lifeYaw)*follow);
        // Keep the follow camera in front of intervening buildings.
        const direction=desired.clone().sub(look);const length=direction.length();direction.normalize();
        const camRay=new THREE.Raycaster(look,direction,.1,length);
        const blockers=indoor?[]:[...world.buildingMeshes.values()].filter(obj=>obj.userData.kind!=='road');
        const hit=camRay.intersectObjects(blockers,true)[0];
        if(hit&&hit.distance<length)desired.copy(look).addScaledVector(direction,Math.max(1.2,hit.distance-.4));
        camera.position.lerp(desired,Math.min(1,dt*9));camera.lookAt(look);
      }
    }
  }
  function findContext(){
    if(mode==='city'){ui.setContext('');contextAction=undefined;return;}
    const p=sim.state.player;
    if(sim.state.interior){
      if(Math.hypot(p.x,p.z-7.1)<2.4){contextAction='exit';contextTarget=undefined;ui.setContext('走出家门 · 回到自己的城市',contextAction);return;}
      const home=sim.state.homes.find(h=>h.homeId===sim.state.interior!.homeId);
      const nearby=home?.furniture.map(f=>({f,d:Math.hypot(p.x-FURNITURE[f.kind].x,p.z-FURNITURE[f.kind].z)})).filter(v=>v.d<(v.f.kind==='dining'?3:4.2)).sort((a,b)=>a.d-b.d)[0];
      const guest=sim.state.interior.guestId;
      if(guest!==null&&Math.hypot(p.x,p.z-1.3)<3.4&&(!nearby||nearby.d>2.5)){
        const resident=sim.state.residents.find(r=>r.id===guest);contextAction='talk';contextTarget=guest;ui.setContext(`与来访的${resident?.name??'朋友'}聊天`,contextAction,guest);homeWorld.highlight(null);return;
      }
      if(nearby){contextAction='furniture';contextTarget=nearby.f.id;ui.setContext(nearby.f.kind==='desk'?`远程办公 · 收入 ¥${wageFor(sim.state.progression,true)}`:FURNITURE[nearby.f.kind].action,contextAction,contextTarget);homeWorld.highlight(nearby.f.id);return;}
      contextAction=undefined;contextTarget=undefined;homeWorld.highlight(null);ui.setContext('在家走走，靠近家具按 F 使用 · H 出门');return;
    }
    const nearby=sim.state.buildings.filter(b=>b.kind!=='road').map(b=>({b,d:Math.hypot(cellToWorld(b.gx)-p.x,cellToWorld(b.gz)-p.z)})).filter(i=>i.d<17).sort((a,b)=>a.d-b.d);
    const resident=sim.state.residents.map(r=>({r,d:Math.hypot(r.x-p.x,r.z-p.z)})).filter(i=>i.d<7).sort((a,b)=>a.d-b.d)[0];
    if(resident){contextAction='talk';contextTarget=resident.r.id;ui.setContext(`与${resident.r.name}聊聊天`,contextAction,contextTarget);return;}
    for(const {b} of nearby){
      const homeAction:[Interaction,string]=p.homeId===b.id?['enter','打开家门，回到自己的家 · H']:['adopt','在这里安家，认领自己的住宅'];
      const actions:Partial<Record<BuildingKind,[Interaction,string]>>={home:homeAction,apartment:homeAction,shop:['eat','来一份热腾腾的午餐 · ¥35'],office:['work',`工作一班 · 赚取 ¥${wageFor(sim.state.progression)}`],park:['relax','坐下来，享受一会儿绿意'],police:['patrol','加入社区巡逻'],prison:['patrol','参与矫正中心值勤'],school:['study','参加学校进修 · 个人 ¥60 / 逻辑经验 +45']};
      const a=actions[b.kind];if(!a)continue;
      contextAction=a[0];contextTarget=b.id;ui.setContext(a[1],a[0],b.id);return;
    }
    contextAction=undefined;contextTarget=undefined;ui.setContext('');
  }
  syncWorlds();refresh();updateCamera(1);
  let renderCount=0,renderTime=0;
  function frame(now:number){
    requestAnimationFrame(frame);
    const dt=Math.max(0,Math.min((now-lastFrame)/1000,.065));lastFrame=now;
    if(document.hidden||contextLost)return;
    if(!ui.isSimulationPaused())sim.tick(dt);
    physicsTimer+=dt;uiTimer+=dt;saveTimer+=dt;
    if(physicsTimer>.45){syncWorlds();physicsTimer=0;}
    updateCamera(dt);
    if(sim.state.interior)homeWorld.update(dt,sim.state,mode);else world.update(dt,sim.state,mode);
    if(uiTimer>.18){findContext();refresh();uiTimer=0;}
    if(saveTimer>45){sim.save(true);saveTimer=0;}
    renderer.render(sim.state.interior?homeWorld.scene:world.scene,camera);
    renderCount++;renderTime+=dt;
  }
  requestAnimationFrame(frame);
  // Read-only diagnostics for reproducible playtests. Gameplay still uses the public UI.
  (window as unknown as Record<string,unknown>).__HAVEN__={
    getState:()=>JSON.parse(JSON.stringify(sim.state)),
    getEventMarkers:()=>world.getEventMarkers(),
    getView:()=>({mode,tool,location:sim.state.interior?'home':'city',selected:selected?.id,lifeYaw,camera:camera.position.toArray(),fps:renderCount/Math.max(1,renderTime),drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles}),
    getScreenPosition:(x:number,z:number,height=.3)=>{const p=new THREE.Vector3(x,height,z).project(camera);return {x:(p.x+1)*innerWidth/2,y:(1-p.y)*innerHeight/2};}
  };
  window.addEventListener('beforeunload',()=>sim.save(true));
  window.addEventListener('haven:before-update-install',event=>{
    const saved=sim.save(true);
    if(!saved.ok){event.preventDefault();ui.toast('存档失败，已取消重启更新。请先检查本地存储。','bad');}
  });
}
boot().catch(error=>{console.error(error);mount.innerHTML='<div style="padding:10vh;background:#f1f1e8;height:100vh;color:#284c40"><h1>城市暂时没有准备好</h1><p>请刷新页面重试。建议使用最新版 Chrome / Edge。</p><pre style="white-space:pre-wrap"></pre></div>';mount.querySelector('pre')!.textContent=String(error);});
