import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {main,parseArgs} from '../src/cli.mjs';
const emptyClient={get:async()=>({data:{items:[],total_count:0,incomplete_results:false}})};
test('positional user, flags, and environment priority',()=>{
 const o=parseArgs(['other','--limit','3','--language','ko','--json'],{PR_COMPASS_USERNAME:'octocat'});assert.equal(o.username,'other');assert.equal(o.limit,3);assert.equal(o.language,'ko');assert.equal(o.json,true);
 assert.equal(parseArgs(['--username','octocat'],{}).limit,5);
});
test('unknown flags, absent user and invalid values fail',()=>{
 for(const a of [[],['--username'],['a','b'],['a','--username','b'],['a','--readme','README.md'],['a','--limit','0'],['a','--language','xx'],['a','--include-own']])assert.throws(()=>parseArgs(a,{}));
});
test('help succeeds without API request',async()=>{
 let output='',called=false;await main(['--help'],{},{client:{get:async()=>{called=true}},write:s=>output+=s});assert.equal(called,false);assert.match(output,/Read-only/);
});
test('JSON output is one valid report, no commentary',async()=>{
 let output='';const r=await main(['octocat','--json'],{},{client:emptyClient,now:'2026-11-17T00:00:00Z',write:s=>output+=s});assert.deepEqual(JSON.parse(output),r);assert.equal(r.username,'octocat');assert.deepEqual(r.sample,{open:{shown:0,total:0},merged:{shown:0,total:0}});
});
test('plain output describes empty findings without false health claim',async()=>{
 let output='';await main(['octocat'],{},{client:emptyClient,write:s=>output+=s});assert.match(output,/octocat/);assert.doesNotMatch(output,/\x1b/);
});
test('CLI never changes local README or creates files',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pr-next-readonly-'));const file=join(dir,'README.md');await writeFile(file,'unchanged');
 try{await main(['octocat'],{PR_COMPASS_README:file},{client:emptyClient,write:()=>{}});assert.equal(await readFile(file,'utf8'),'unchanged');assert.deepEqual(await readdir(dir),['README.md']);}finally{await rm(dir,{recursive:true,force:true});}
});
test('network failure emits no misleading partial report',async()=>{
 let output='';await assert.rejects(main(['octocat'],{},{client:{get:async()=>{throw Error('API failure')}},write:s=>output+=s}));assert.equal(output,'');
});
