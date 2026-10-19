export type BuildingKind = 'road' | 'home' | 'apartment' | 'shop' | 'office' | 'park' | 'power' | 'water' | 'clinic' | 'police' | 'prison' | 'school' | 'firestation';
export type CameraMode = 'city' | 'third' | 'first';
export type Tool = BuildingKind | 'select' | 'bulldoze';
export type Speed = 0 | 1 | 3;
export interface BuildingDef { name: string; cost: number; upkeep: number; capacity: number; jobs: number; description: string; color: string; category: '道路' | '居住' | '商业' | '公共' | '管理'; icon: string }
export interface Building { id: number; kind: BuildingKind; gx: number; gz: number; level: number; active: boolean }
export interface Resident { id: number; name: string; x: number; z: number; targetX: number; targetZ: number; homeId: number; jobId: number | null; color: string; mood: number; relation: number; activity: string }
export interface Player { x: number; z: number; yaw: number; hunger: number; energy: number; social: number; joy: number; hygiene: number; money: number; name: string; job: string; homeId: number | null }
export type FurnitureKind = 'bed' | 'kitchen' | 'sofa' | 'shower' | 'desk' | 'bookshelf' | 'dining' | 'plant';
export interface FurnitureDef { name: string; cost: number; description: string; x: number; z: number; rotation: number; width: number; depth: number; action: string; icon: string }
export interface Furniture { id: number; kind: FurnitureKind }
export interface HomeInterior { homeId: number; furniture: Furniture[] }
export interface InteriorVisit { homeId: number; returnX: number; returnZ: number; guestId: number | null }
export type SocialAction = 'chat' | 'compliment' | 'gift' | 'invite';
export type PrisonRegime = 'balanced' | 'rehabilitation' | 'strict';
export const PRISON_RULES = {
 balanced: { name:'均衡管理',description:'维持常规收押、照护和康复速度，适合日常运营。',upkeep:1,perPerson:9,safety:0,arrest:1,sentence:36,rehabilitation:.14,unrest:.15,grant:22 },
 rehabilitation: { name:'教育与康复',description:'增加教学与照护投入，提高康复和释放速度，接收新收押较慢。',upkeep:1.35,perPerson:15,safety:-2,arrest:.7,sentence:18,rehabilitation:.65,unrest:-.45,grant:28 },
 strict: { name:'严格管理',description:'加强巡逻与收押，提高治安，服刑时间更长，不安程度会逐渐上升。',upkeep:1.12,perPerson:7,safety:9,arrest:1.6,sentence:60,rehabilitation:-.28,unrest:.65,grant:18 }
} as const;
export interface PrisonManagement { intake: boolean; regime: PrisonRegime; unrest: number; rehabilitation: number; released: number; phase: string }
export interface CityStats { population: number; capacity: number; jobs: number; employed: number; happiness: number; income: number; expenses: number; power: number; powerNeed: number; water: number; waterNeed: number; safety: number; prisoners: number; prisonCapacity: number; crime: number; landValue: number; education: number; fireCoverage: number }
export type CareerTrack = 'business' | 'culinary' | 'community';
export type SkillKind = 'logic' | 'cooking' | 'charisma';
export interface CareerProgress { xp: number; shifts: number }
export interface Progression { career: CareerTrack; careers: Record<CareerTrack, CareerProgress>; skills: Record<SkillKind, number>; totalEarned: number }
export const LEVEL_XP = [0,40,110,220,380] as const;
export const xpLevel = (xp:number) => LEVEL_XP.reduce((level,threshold,i)=>xp>=threshold?i+1:level,1);
export const CAREERS: Record<CareerTrack,{name:string;description:string;skill:SkillKind;roles:readonly string[]}> = {
 business:{name:'商业与科技',description:'工作积累经验，逻辑技能提高收入。可在商店、商务中心或居家书桌工作。',skill:'logic',roles:['事务助理','项目专员','业务主管','部门经理','城市合伙人']},
 culinary:{name:'餐饮与创作',description:'把烹饪热情变成事业。厨房练习提升手艺，工作积累职业经验。',skill:'cooking',roles:['餐饮学徒','料理专员','创意主厨','餐厅主理人','栖湾美食家']},
 community:{name:'社区与服务',description:'在工作和巡逻中成长，用沟通和服务改善社区。',skill:'charisma',roles:['社区志愿者','服务专员','社区协调员','街区负责人','城市服务大使']}
};
export const wageFor = (progression:Progression,remote=false) => (remote?90:160)+(xpLevel(progression.careers[progression.career].xp)-1)*(remote?20:35)+(xpLevel(progression.skills[CAREERS[progression.career].skill])-1)*5;
export type CityPolicy = 'green' | 'education' | 'community';
export const CITY_POLICIES: Record<CityPolicy,{name:string;cost:number;description:string;icon:string}> = {
 green:{name:'绿色街区',cost:180,description:'每日 ¥180，水电需求降低 10%，城市幸福 +3。',icon:'tree'},
 education:{name:'终身学习',cost:220,description:'每日 ¥220，个人技能经验增加 25%。',icon:'help'},
 community:{name:'邻里互助',cost:150,description:'每日 ¥150，城市安全 +4，社交技能经验增加 25%。',icon:'people'}
};
export type CityEventKind = 'festival' | 'outage' | 'fire' | 'training';
export type EventChoice = 'sponsor' | 'volunteer' | 'repair' | 'ration' | 'dispatch' | 'emergency' | 'fund' | 'study' | 'decline';
export interface CityEvent { id:number; kind:CityEventKind; buildingId:number|null; createdAt:number; expiresAt:number; status:'pending'|'resolved'|'expired'; choice:EventChoice|null }
export interface CityEffect { id:number; kind:'celebration'|'rationing'|'learning'|'disruption'; until:number }
export interface CivicState { policies:Record<CityPolicy,boolean>; events:CityEvent[]; effects:CityEffect[]; nextEventAt:number; sequence:number; resolved:number }
export const CITY_EVENTS:Record<CityEventKind,{name:string;description:string;icon:string;choices:{id:EventChoice;label:string;description:string}[]}> = {
 festival:{name:'栖湾邻里节',description:'居民想在公园办一场邻里节。一起决定这次聚会如何开始。',icon:'people',choices:[{id:'sponsor',label:'市政赞助 · ¥1,500',description:'提升全城幸福度，效果持续一整天。'},{id:'volunteer',label:'亲自参与 · 精力 20',description:'走到活动公园附近参加，提升社交、沟通技能和全城幸福。'},{id:'decline',label:'这次暂缓',description:'保留预算，结束本次活动筹备。'}]},
 outage:{name:'电网维护请求',description:'能源站出现供电波动，城市供电暂时减少。',icon:'bolt',choices:[{id:'repair',label:'紧急检修 · ¥1,200',description:'立即恢复供电。'},{id:'ration',label:'安排错峰用电',description:'恢复电网，短期幸福与经营收入下降。'}]},
 fire:{name:'街区火情',description:'一栋建筑出现火情。请安排消防响应，避免街区持续受扰。',icon:'shield',choices:[{id:'dispatch',label:'派出消防队 · ¥600',description:'需要已接通道路的消防站。'},{id:'emergency',label:'请求区域支援 · ¥1,500',description:'没有消防站也可立即处理。'}]},
 training:{name:'社区学习日',description:'社区邀请你为居民学习提供支持，也可以亲自到学校进修。',icon:'help',choices:[{id:'fund',label:'资助课程 · ¥900',description:'短期提高学习效率，改善城市幸福。'},{id:'study',label:'参加进修 · 个人 ¥60',description:'走到学校附近，获得 45 点逻辑技能经验。'},{id:'decline',label:'以后再安排',description:'保留预算，结束本次课程筹备。'}]}
};
export interface Mission { id: string; title: string; description: string; target: number; progress: number; reward: number; completed: boolean }
export interface Notice { id: number; text: string; kind: 'good' | 'info' | 'bad'; time: number }
export interface GameState { version: number; money: number; day: number; hour: number; speed: Speed; tax: number; buildings: Building[]; residents: Resident[]; player: Player; stats: CityStats; missions: Mission[]; notices: Notice[]; nextId: number; elapsed: number; weather: string; homes: HomeInterior[]; interior: InteriorVisit | null; prison: PrisonManagement; progression:Progression; civic:CivicState }
export interface ActionResult { ok: boolean; message: string }
export type Interaction = 'talk' | 'eat' | 'rest' | 'work' | 'relax' | 'adopt' | 'patrol' | 'enter' | 'exit' | 'furniture' | 'study';
export const FURNITURE: Record<FurnitureKind, FurnitureDef> = {
 bed: { name:'云朵双人床', cost:160, description:'睡个好觉，恢复精力。', x:-5.6,z:-4.4,rotation:0,width:3.3,depth:4,action:'睡觉 · 精力 +60',icon:'rest' },
 kitchen: { name:'原木厨房', cost:140, description:'自己做饭，每餐只需 ¥12。', x:5.8,z:-5.8,rotation:0,width:4.6,depth:1.6,action:'烹饪 · ¥12 / 饱腹 +55',icon:'eat' },
 sofa: { name:'柔软沙发', cost:110, description:'放下忙碌，享受居家时光。', x:-4.6,z:1.4,rotation:0,width:3.7,depth:1.6,action:'看电视 · 愉悦 +35',icon:'relax' },
 shower: { name:'玻璃淋浴间', cost:130, description:'清爽的沐浴，照顾个人卫生。', x:6.5,z:5,rotation:0,width:2,depth:2,action:'洗澡 · 清洁 +75',icon:'water' },
 desk: { name:'居家工作台', cost:180, description:'在自己的书桌旁远程办公。', x:1.6,z:-5.9,rotation:0,width:2.5,depth:1.4,action:'远程办公 · 收入 ¥90',icon:'work' },
 bookshelf: { name:'橡木书架', cost:90, description:'一本好书，一段安静的时间。', x:-8,z:4.3,rotation:Math.PI/2,width:2.2,depth:.8,action:'阅读 · 愉悦 +25',icon:'help' },
 dining: { name:'圆桌与晚餐', cost:100, description:'一杯热茶，让一天慢下来。', x:4,z:-1.4,rotation:0,width:2,depth:2,action:'喝杯茶 · 社交 +12 / 精力 +10',icon:'talk' },
 plant: { name:'室内绿植', cost:40, description:'用一点绿意装点这个家。', x:-8,z:-6,rotation:0,width:.9,depth:.9,action:'照料植物 · 愉悦 +12',icon:'tree' }
};
export const TILE = 10;
export const GRID = 24;
export const cellToWorld = (g: number) => (g - GRID / 2 + .5) * TILE;
export const worldToCell = (p: number) => Math.floor(p / TILE + GRID / 2);
export const BUILDINGS: Record<BuildingKind, BuildingDef> = {
 road:{name:'城市道路',cost:80,upkeep:2,capacity:0,jobs:0,description:'连接街区。住宅与设施需要紧邻道路。',color:'#74838a',category:'道路',icon:'road'},
 home:{name:'花园住宅',cost:900,upkeep:8,capacity:6,jobs:0,description:'有庭院的舒适小家，容纳 6 位居民。',color:'#e3b895',category:'居住',icon:'home'},
 apartment:{name:'城市公寓',cost:2600,upkeep:22,capacity:24,jobs:0,description:'让更多人住进城市，容纳 24 位居民。',color:'#bac5cc',category:'居住',icon:'building'},
 shop:{name:'街角商店',cost:1400,upkeep:12,capacity:0,jobs:8,description:'提供 8 个岗位，也能在此吃一顿热饭。',color:'#d9aa6a',category:'商业',icon:'shop'},
 office:{name:'商务中心',cost:3200,upkeep:24,capacity:0,jobs:24,description:'提供 24 个岗位。居民可以上班赚钱。',color:'#8eb6c9',category:'商业',icon:'office'},
 park:{name:'邻里公园',cost:650,upkeep:6,capacity:0,jobs:1,description:'散步、交谈与放松，让城市幸福起来。',color:'#86aa79',category:'公共',icon:'tree'},
 power:{name:'清洁能源站',cost:2200,upkeep:18,capacity:120,jobs:4,description:'为 120 单位城市需求提供电力。',color:'#b8c8bc',category:'公共',icon:'bolt'},
 water:{name:'水务中心',cost:1600,upkeep:12,capacity:120,jobs:3,description:'提供 120 单位供水能力。',color:'#8dbdc8',category:'公共',icon:'water'},
 clinic:{name:'社区医院',cost:1800,upkeep:18,capacity:0,jobs:6,description:'改善健康和幸福感。',color:'#d7d5ca',category:'公共',icon:'heart'},
 police:{name:'社区警局',cost:1800,upkeep:16,capacity:0,jobs:6,description:'巡逻降低犯罪，为监狱提供收押能力。',color:'#9aaebe',category:'管理',icon:'shield'},
 prison:{name:'矫正中心',cost:3200,upkeep:26,capacity:16,jobs:10,description:'容纳 16 人。与警局协作，提供矫正与安全管理。',color:'#c4baaa',category:'管理',icon:'lock'},
 school:{name:'社区学校',cost:2400,upkeep:22,capacity:80,jobs:10,description:'提供 80 个教育名额，提高城市教育与个人学习效率。走近学校可以进修。',color:'#c5b491',category:'公共',icon:'help'},
 firestation:{name:'滨湾消防站',cost:2200,upkeep:20,capacity:0,jobs:8,description:'提供消防覆盖，处理街区火情，保障城市生活。',color:'#b77d66',category:'管理',icon:'shield'}
};
