import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {main} from '../src/cli.mjs';
const original='# Existing profile\n\n<!-- PR-COMPASS:START -->\nlast good\n<!-- PR-COMPASS:END -->\n\nMy footer.\n';
async function withFile(fn){const dir=await mkdtemp(join(tmpdir(),'pr-compass-test-'));const path=join(dir,'README.md');await writeFile(path,original);try{await fn(path)}finally{await rm(dir,{recursive:true,force:true})}}
const emptyClient={get:async()=>({data:{items:[],total_count:0,incomplete_results:false}})};
test('CLI writes only marker block with fixed timestamp',async()=>withFile(async path=>{await main(['--username','octocat','--readme',path],{},{client:emptyClient,now:'2026-11-17T00:00:00Z'});const result=await readFile(path,'utf8');assert.ok(result.startsWith('# Existing profile\n\n<!-- PR-COMPASS:START -->'));assert.ok(result.endsWith('<!-- PR-COMPASS:END -->\n\nMy footer.\n'));assert.match(result,/2026-11-17 00:00:00 UTC/);}));
test('API failure preserves last good README byte for byte',async()=>withFile(async path=>{await assert.rejects(main(['--username','octocat','--readme',path],{},{client:{get:async()=>{throw Error('API failure')}}}));assert.equal(await readFile(path,'utf8'),original);}));
test('missing markers fail before network',async()=>withFile(async path=>{await writeFile(path,'No markers');let called=false;await assert.rejects(main(['--username','octocat','--readme',path],{},{client:{get:async()=>{called=true}}}),/marker/);assert.equal(called,false);assert.equal(await readFile(path,'utf8'),'No markers');}));
test('concurrent edits are not overwritten',async()=>withFile(async path=>{const client={get:async()=>{await writeFile(path,'Someone edited this');return emptyClient.get();}};await assert.rejects(main(['--username','octocat','--readme',path],{},{client}),/concurrent edits/);assert.equal(await readFile(path,'utf8'),'Someone edited this');}));
test('invalid UTF8 fails without modifying bytes',async()=>withFile(async path=>{const bytes=Buffer.from([0xff,0xfe,0x00]);await writeFile(path,bytes);await assert.rejects(main(['--username','octocat','--readme',path],{},{client:emptyClient}),/UTF-8/);assert.deepEqual(await readFile(path),bytes);}));

test('CLI writes only README, leaves old assets untouched, and creates no new asset directory',async()=>withFile(async path=>{
 const {mkdir,readdir}=await import('node:fs/promises');const folder=join(path,'..','assets','pr-compass');await mkdir(folder,{recursive:true});await writeFile(join(folder,'overview-light.svg'),'previous asset');
 await main(['--username','octocat','--readme',path],{},{client:emptyClient,now:'2026-11-17T00:00:00Z'});
 assert.deepEqual(await readdir(folder),['overview-light.svg']);assert.equal(await readFile(join(folder,'overview-light.svg'),'utf8'),'previous asset');
 assert.doesNotMatch(await readFile(path,'utf8'),/<img|<svg|<picture|\.svg/);
}));
test('removed asset flag fails rather than silently generating images',async()=>withFile(async path=>{
 let called=false;await assert.rejects(main(['--username','octocat','--readme',path,'--assets-dir','assets/pr-compass'],{},{client:{get:async()=>{called=true}}}),/Unknown argument/);assert.equal(called,false);assert.equal(await readFile(path,'utf8'),original);
}));
test('README symlink rejected before network',async()=>withFile(async path=>{
 const {symlink}=await import('node:fs/promises');const link=join(path,'..','linked.md');await symlink(path,link);let called=false;
 await assert.rejects(main(['--username','octocat','--readme',link],{},{client:{get:async()=>{called=true}}}),/symlink/);assert.equal(called,false);
}));
