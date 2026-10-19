import {execFileSync} from 'node:child_process';
import {readFile,stat,readdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {resolve} from 'node:path';

// Uses the existing Git credential helper in memory. No token is stored in the project or logged.
const root=resolve(import.meta.dirname,'..');
const config=JSON.parse(await readFile(resolve(root,'src/release-config.json'),'utf8'));
const {owner,repo,version}=config;
if(!/^[\w-]+$/.test(owner)||!/^[\w.-]+$/.test(repo))throw new Error('Configure a valid GitHub owner/repository first.');
const credential=execFileSync('git',['-c',`safe.directory=${root}`,'credential','fill'],{input:`protocol=https\nhost=github.com\nusername=${owner}\n\n`,encoding:'utf8',windowsHide:true,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never'},stdio:['pipe','pipe','pipe']});
const token=credential.split(/\r?\n/).find(line=>line.startsWith('password='))?.slice(9);
if(!token)throw new Error('GitHub Git authentication is unavailable.');
const headers={Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'Haven-City-Release'};
async function request(route,options={}){
  const response=await fetch(`https://api.github.com${route}`,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(60000)});
  if(response.status===404)return null;
  if(!response.ok)throw new Error(`GitHub ${response.status}: ${(await response.json().catch(()=>({}))).message||response.statusText}`);
  return response.status===204?null:response.json();
}
const account=await request('/user');
if(account.login.toLowerCase()!==owner.toLowerCase())throw new Error('The configured owner does not match the authenticated account.');
if(process.argv.includes('--create-repo')){
  let repository=await request(`/repos/${owner}/${repo}`);
  if(!repository)repository=await request('/user/repos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:repo,description:'栖湾市：可建设、可居住的 3D 城市与生活模拟游戏。Windows EXE 与离线浏览器版。',private:false,auto_init:false})});
  else if(repository.private||repository.size>0)throw new Error('The repository already contains content; inspect it before publishing.');
  console.log(JSON.stringify({url:repository.html_url,visibility:repository.private?'private':'public',login:account.login,commitEmail:`${account.id}+${account.login}@users.noreply.github.com`}));
}
if(process.argv.includes('--publish-release')){
  const tag=`v${version}`;
  let release=await request(`/repos/${owner}/${repo}/releases/tags/${tag}`);
  if(!release)release=await request(`/repos/${owner}/${repo}/releases`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tag_name:tag,name:`栖湾市 ${version} · Windows 版`,draft:false,prerelease:false,body:'Windows x64：下载 HavenCity-Setup 安装版，游戏菜单中可检查、下载并确认安装后续更新。Portable 为免安装版，更新时下载新版替换。\n\n本版加入职业与技能、学校与消防站、城市事件和政策，优化夜景、连续铺路和面板可读性。支持离线游玩，更新会保留本地存档。\n\n浏览器离线版与完整源码包也包含在附件中。EXE 当前未做商业代码签名。'})});
  const directory=resolve(root,'desktop/release');
  const files=(await readdir(directory)).filter(name=>/\.(exe|blockmap)$/.test(name)||name==='latest.yml');
  // GitHub sanitizes non-ASCII asset names. Keep public download URLs stable and readable.
  const extraNames=new Map([
    ['../../栖湾市-可玩原型.zip',`HavenCity-${version}-Source.zip`],
    ['../../栖湾市.html',`HavenCity-${version}-Offline.html`],
  ]);
  files.push(...extraNames.keys());
  // Publish installers first, then latest.yml so the update manifest never points to a missing installer.
  files.sort((a,b)=>Number(a==='latest.yml')-Number(b==='latest.yml'));
  for(const relative of files){
    const path=resolve(directory,relative),name=extraNames.get(relative)||relative.split('/').pop(),size=(await stat(path)).size;
    if(release.assets.some(asset=>asset.name===name&&asset.size===size)){console.log(`Already uploaded: ${name}`);continue;}
    if(release.assets.some(asset=>asset.name===name))throw new Error(`A different asset already exists: ${name}`);
    const endpoint=release.upload_url.replace(/\{.*$/,'')+`?name=${encodeURIComponent(name)}`;
    const response=await fetch(endpoint,{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream','Content-Length':String(size)},body:createReadStream(path),duplex:'half',signal:AbortSignal.timeout(600000)});
    if(!response.ok)throw new Error(`Asset upload failed (${response.status}): ${name}`);
    const asset=await response.json();console.log(JSON.stringify({name:asset.name,size:asset.size,state:asset.state}));
  }
  const published=await request(`/repos/${owner}/${repo}/releases/tags/${tag}`);
  console.log(JSON.stringify({release:published.html_url,assets:published.assets.map(asset=>({name:asset.name,size:asset.size,state:asset.state}))}));
}
