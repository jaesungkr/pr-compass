import test from 'node:test';
import assert from 'node:assert/strict';
import {validateUsername,validateLimit,summarizeReviews,summarizeChecks,GitHubClient,collect} from '../src/core.mjs';
const sha='a'.repeat(40), repo='upstream/example';
const item=(n=1)=>({repository_url:`https://api.github.com/repos/${repo}`,number:n,pull_request:{merged_at:'2026-01-01T00:00:00Z'}});
const pr=(n=1)=>({number:n,title:'Fix thing',base:{repo:{private:false,full_name:repo}},head:{sha},state:'open',draft:false,merged:false});
const search=items=>({items,total_count:items.length,incomplete_results:false});
const detailResponses=(p=pr())=>[{data:p},{data:[]},{data:{total_count:0,check_runs:[]}},{data:{total_count:0,statuses:[]}}];
function fixture(responses) { const calls=[]; const client = new GitHubClient({token:'test-token',fetchImpl:async(url,options)=>{calls.push({url,options});const r=responses.shift();if(!r)throw Error('No fixture');if(r.throw)throw Error('network');return {ok:!r.status,status:r.status||200,headers:{get:k=>r.headers?.[k]||null},json:async()=>r.data};}});return{client,calls}; }
test('username and bounded limit validation',()=>{for(const u of ['', 'bad_name','-bad','bad-','a--b','a'.repeat(40)])assert.throws(()=>validateUsername(u));assert.equal(validateUsername('octo-cat'),'octo-cat');for(const n of [0,21,1.2,'wat'])assert.throws(()=>validateLimit(n));assert.equal(validateLimit('20'),20);});
test('reviews preserve prior approval across comment and classify current SHA',()=>{assert.deepEqual(summarizeReviews([{id:1,user:{login:'a'},state:'APPROVED',commit_id:sha},{id:2,user:{login:'a'},state:'COMMENTED'}],sha),{approvals:1,current:1,changes:0});assert.equal(summarizeReviews([{id:1,user:{login:'a'},state:'APPROVED',commit_id:'old'}],sha).current,0);});
test('reviews ordered by timestamp; dismissed supersedes',()=>{const rs=[{id:2,user:{login:'a'},state:'DISMISSED',submitted_at:'2026-02-01'},{id:1,user:{login:'a'},state:'APPROVED',submitted_at:'2026-01-01'}];assert.equal(summarizeReviews(rs,sha).approvals,0);});
test('latest decision per reviewer wins',()=>{assert.deepEqual(summarizeReviews([{id:1,user:{login:'a'},state:'CHANGES_REQUESTED'},{id:2,user:{login:'a'},state:'APPROVED',commit_id:sha},{id:3,user:{login:'b'},state:'CHANGES_REQUESTED'}],sha),{approvals:1,current:1,changes:1});});
test('checks distinguish skipped, cancelled, pending, failed, no checks',()=>{
 const c=summarizeChecks([{status:'completed',conclusion:'success'},{status:'completed',conclusion:'skipped'},{status:'completed',conclusion:'neutral'},{status:'completed',conclusion:'cancelled'},{status:'completed',conclusion:'action_required'},{status:'completed',conclusion:'timed_out'},{status:'queued'}],[{state:'failure'},{state:'pending'}]);assert.deepEqual(c,{total:9,success:1,failed:2,pending:2,attention:2,other:2});assert.equal(summarizeChecks([],[]).success,0);
});
test('collection forces public query and fixed timestamp, no false green for absent checks',async()=>{const f=fixture([{data:search([item()])},{data:search([])},...detailResponses()]);const d=await collect({username:'octocat',client:f.client,now:'2026-11-17T00:00:00Z'});assert.match(decodeURIComponent(f.calls[0].url),/is:public/);assert.match(decodeURIComponent(f.calls[1].url),/is:public/);assert.equal(d.observedAt,'2026-11-17T00:00:00.000Z');assert.equal(d.open[0].checks.total,0);assert.equal(f.calls.length,6);assert.equal(f.calls[0].options.redirect,'error');});
test('empty public result is explicit, not an error',async()=>{const f=fixture([{data:search([])},{data:search([])}]);const d=await collect({username:'octocat',client:f.client});assert.equal(d.open.length,0);assert.equal(f.calls.length,2);});
test('search failure aborts collection',async()=>{const f=fixture([{status:503}]);await assert.rejects(collect({username:'octocat',client:f.client}),/HTTP 503/);});
test('incomplete search fails safe',async()=>{const f=fixture([{data:{...search([]),incomplete_results:true}}]);await assert.rejects(collect({username:'octocat',client:f.client}),/incomplete/);});
test('private or unverified PR fails without rendering title',async()=>{for(const privateValue of [true,undefined]){const p=pr();p.title='SECRET';p.base.repo.private=privateValue;const f=fixture([{data:search([item()])},{data:search([])},{data:p}]);await assert.rejects(collect({username:'octocat',client:f.client}),e=>!e.message.includes('SECRET')&&/visibility/.test(e.message));assert.equal(f.calls.length,3);}});
test('repository identity mismatch fails',async()=>{const p=pr();p.base.repo.full_name='other/repo';const f=fixture([{data:search([item()])},{data:search([])},{data:p}]);await assert.rejects(collect({username:'octocat',client:f.client}),/visibility/);});
test('detail failure is unavailable, not no-checks or green',async()=>{const f=fixture([{data:search([item()])},{data:search([])},{data:pr()},{status:500},{status:500},{data:{statuses:[],total_count:0}}]);const d=await collect({username:'octocat',client:f.client});assert.equal(d.open[0].partial,true);assert.equal(d.open[0].reviewUnknown,true);assert.equal(d.open[0].checksUnknown,true);});
test('truncated detail explicitly partial',async()=>{const responses=detailResponses();responses[1].headers={link:'<https://api.github.com/next>; rel="next"'};const f=fixture([{data:search([item()])},{data:search([])},...responses]);const d=await collect({username:'octocat',client:f.client});assert.equal(d.open[0].partial,true);});
test('429 stops further network attempts and never prints secret',async()=>{const f=fixture([{status:429}]);await assert.rejects(f.client.get('/test'),/rate limit/);await assert.rejects(f.client.get('/next'),/rate limit/);assert.equal(f.calls.length,1);});
test('403 without rate metadata is ordinary unavailable, not blanket global cooldown',async()=>{const f=fixture([{status:403},{data:[]}]);await assert.rejects(f.client.get('/test'),/HTTP 403/);await f.client.get('/other');assert.equal(f.calls.length,2);});
test('network errors hide sensitive error details',async()=>{const f=fixture([{throw:true}]);await assert.rejects(f.client.get('/test'),/network request failed/);});
test('merged sample sorted by actual merge date',async()=>{const old={...item(1),pull_request:{merged_at:'2026-01-01T00:00:00Z'}},recent={...item(2),pull_request:{merged_at:'2026-02-01T00:00:00Z'}};const p=pr(2);p.merged=true;p.state='closed';const f=fixture([{data:search([])},{data:search([old,recent])},...detailResponses(p)]);const d=await collect({username:'octocat',limit:1,client:f.client});assert.equal(d.merged[0].number,2);assert.equal(d.merged[0].merged,true);});
test('non-GitHub repository URL cannot inject network target',async()=>{const bad={...item(),repository_url:'https://evil.test/owner/repo'};const f=fixture([{data:search([bad])},{data:search([])}]);await assert.rejects(collect({username:'octocat',client:f.client}),/Unexpected/);assert.equal(f.calls.length,1);});

test('malformed JSON errors do not leak raw response text',async()=>{const client=new GitHubClient({fetchImpl:async()=>({ok:true,headers:{get:()=>null},json:async()=>{throw Error('SECRET response body');}})});await assert.rejects(client.get('/test'),e=>e.message==='GitHub returned an invalid JSON response.');});

test('external scope is default and excludes own repositories case-insensitively',async()=>{
 const own={...item(2),repository_url:'https://api.github.com/repos/OCTOCAT/own-fork'};
 const f=fixture([{data:search([own,item()])},{data:search([])},...detailResponses()]);
 const d=await collect({username:'Octocat',client:f.client});
 assert.match(decodeURIComponent(f.calls[0].url),/-user:Octocat/);
 assert.equal(d.includeOwn,false);assert.equal(d.open.length,1);assert.equal(d.totals.open,1);
 assert.equal(f.calls.some(c=>c.url.includes('/OCTOCAT/own-fork/')),false);
 assert.equal(d.includeOwn,false);
});
test('include-own opt-in includes own repositories and removes exclusion query',async()=>{
 const own={...item(),repository_url:'https://api.github.com/repos/Octocat/own'};
 const p=pr();p.base.repo.full_name='Octocat/own';
 const f=fixture([{data:search([own])},{data:search([])},...detailResponses(p)]);
 const d=await collect({username:'octocat',includeOwn:true,client:f.client});
 assert.equal(decodeURIComponent(f.calls[0].url).includes('-user:'),false);
 assert.equal(d.open.length,1);assert.equal(d.open[0].repo,'Octocat/own');
 assert.equal(d.includeOwn,true);
});
test('organizations remain included in external-only scope',async()=>{
 const f=fixture([{data:search([item()])},{data:search([])},...detailResponses()]);
 const d=await collect({username:'octocat',client:f.client});assert.equal(d.open[0].repo,'upstream/example');
});
test('include-own cannot opt into private data',async()=>{
 const p=pr();p.base.repo.private=true;
 const f=fixture([{data:search([item()])},{data:search([])},{data:p}]);
 await assert.rejects(collect({username:'octocat',includeOwn:true,client:f.client}),/visibility/);
});
