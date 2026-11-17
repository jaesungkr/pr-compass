import test from 'node:test';
import assert from 'node:assert/strict';
import {START,END,replaceBlock,escapeMarkdown,validateUsername,validateLimit,summarizeReviews,summarizeChecks,GitHubClient,collect,renderMarkdown} from '../src/core.mjs';
import {parseArgs} from '../src/cli.mjs';
const sha='a'.repeat(40), repo='upstream/example';
const item=(n=1)=>({repository_url:`https://api.github.com/repos/${repo}`,number:n,pull_request:{merged_at:'2026-01-01T00:00:00Z'}});
const pr=(n=1)=>({number:n,title:'Fix thing',base:{repo:{private:false,full_name:repo}},head:{sha},state:'open',draft:false,merged:false});
const search=items=>({items,total_count:items.length,incomplete_results:false});
const detailResponses=(p=pr())=>[{data:p},{data:[]},{data:{total_count:0,check_runs:[]}},{data:{total_count:0,statuses:[]}}];
function fixture(responses) { const calls=[]; const client = new GitHubClient({token:'test-token',fetchImpl:async(url,options)=>{calls.push({url,options});const r=responses.shift();if(!r)throw Error('No fixture');if(r.throw)throw Error('network');return {ok:!r.status,status:r.status||200,headers:{get:k=>r.headers?.[k]||null},json:async()=>r.data};}});return{client,calls}; }
test('preserves all bytes outside marker pair including BOM and CRLF',()=>{
 const source=`\ufeff# Hello\r\nold\r\n${START}\r\nstale\r\n${END}\r\n## Footer\r\n`;
 assert.equal(replaceBlock(source,'new\nblock'),`\ufeff# Hello\r\nold\r\n${START}\r\nnew\r\nblock\r\n${END}\r\n## Footer\r\n`);
});
test('missing, duplicate, reversed, incomplete markers fail',()=>{for(const s of ['',START,END,`${END}${START}`,`${START}${END}${START}`,`${START}${END}${END}`])assert.throws(()=>replaceBlock(s,'new'));});
test('Markdown escapes title injection and controls',()=>{const s=escapeMarkdown('<img src=x> [x](evil) | @everyone\n### test');assert.equal(s.includes('<img'),false);assert.equal(s.includes('@everyone'),false);assert.equal(s.includes('|'),false);assert.equal(s.includes('\n'),false);assert.match(s,/\\\[x\\\]/);});
test('username and bounded limit validation',()=>{for(const u of ['', 'bad_name','-bad','bad-','a--b','a'.repeat(40)])assert.throws(()=>validateUsername(u));assert.equal(validateUsername('octo-cat'),'octo-cat');for(const n of [0,21,1.2,'wat'])assert.throws(()=>validateLimit(n));assert.equal(validateLimit('20'),20);});
test('CLI options and env priorities',()=>{const p=parseArgs(['--username','other','--limit','3'],{PR_COMPASS_USERNAME:'octocat',PR_COMPASS_README:'profile.md'});assert.equal(p.username,'other');assert.equal(p.limit,3);assert.equal(p.readme,'profile.md');assert.equal(p.language,'en');assert.throws(()=>parseArgs(['--username'],{}));assert.throws(()=>parseArgs(['--init'],{}));});
test('reviews preserve prior approval across comment and classify current SHA',()=>{assert.deepEqual(summarizeReviews([{id:1,user:{login:'a'},state:'APPROVED',commit_id:sha},{id:2,user:{login:'a'},state:'COMMENTED'}],sha),{approvals:1,current:1,changes:0});assert.equal(summarizeReviews([{id:1,user:{login:'a'},state:'APPROVED',commit_id:'old'}],sha).current,0);});
test('reviews ordered by timestamp; dismissed supersedes',()=>{const rs=[{id:2,user:{login:'a'},state:'DISMISSED',submitted_at:'2026-02-01'},{id:1,user:{login:'a'},state:'APPROVED',submitted_at:'2026-01-01'}];assert.equal(summarizeReviews(rs,sha).approvals,0);});
test('latest decision per reviewer wins',()=>{assert.deepEqual(summarizeReviews([{id:1,user:{login:'a'},state:'CHANGES_REQUESTED'},{id:2,user:{login:'a'},state:'APPROVED',commit_id:sha},{id:3,user:{login:'b'},state:'CHANGES_REQUESTED'}],sha),{approvals:1,current:1,changes:1});});
test('checks distinguish skipped, cancelled, pending, failed, no checks',()=>{
 const c=summarizeChecks([{status:'completed',conclusion:'success'},{status:'completed',conclusion:'skipped'},{status:'completed',conclusion:'neutral'},{status:'completed',conclusion:'cancelled'},{status:'completed',conclusion:'action_required'},{status:'completed',conclusion:'timed_out'},{status:'queued'}],[{state:'failure'},{state:'pending'}]);assert.deepEqual(c,{total:9,success:1,failed:2,pending:2,attention:2,other:2});assert.equal(summarizeChecks([],[]).success,0);
});
test('collection forces public query and fixed timestamp, no false green for absent checks',async()=>{const f=fixture([{data:search([item()])},{data:search([])},...detailResponses()]);const d=await collect({username:'octocat',client:f.client,now:'2026-11-17T00:00:00Z'});assert.match(decodeURIComponent(f.calls[0].url),/is:public/);assert.match(decodeURIComponent(f.calls[1].url),/is:public/);assert.equal(d.observedAt,'2026-11-17T00:00:00.000Z');assert.match(renderMarkdown(d),/No public HEAD checks/);assert.match(renderMarkdown(d),/not a merge-readiness verdict/);assert.equal(f.calls.length,6);assert.equal(f.calls[0].options.redirect,'error');});
test('empty public result is explicit, not an error',async()=>{const f=fixture([{data:search([])},{data:search([])}]);const d=await collect({username:'octocat',client:f.client});assert.match(renderMarkdown(d),/No public PRs found/);assert.equal(f.calls.length,2);});
test('search failure aborts collection',async()=>{const f=fixture([{status:503}]);await assert.rejects(collect({username:'octocat',client:f.client}),/HTTP 503/);});
test('incomplete search fails safe',async()=>{const f=fixture([{data:{...search([]),incomplete_results:true}}]);await assert.rejects(collect({username:'octocat',client:f.client}),/incomplete/);});
test('private or unverified PR fails without rendering title',async()=>{for(const privateValue of [true,undefined]){const p=pr();p.title='SECRET';p.base.repo.private=privateValue;const f=fixture([{data:search([item()])},{data:search([])},{data:p}]);await assert.rejects(collect({username:'octocat',client:f.client}),e=>!e.message.includes('SECRET')&&/visibility/.test(e.message));assert.equal(f.calls.length,3);}});
test('repository identity mismatch fails',async()=>{const p=pr();p.base.repo.full_name='other/repo';const f=fixture([{data:search([item()])},{data:search([])},{data:p}]);await assert.rejects(collect({username:'octocat',client:f.client}),/visibility/);});
test('detail failure is unavailable, not no-checks or green',async()=>{const f=fixture([{data:search([item()])},{data:search([])},{data:pr()},{status:500},{status:500},{data:{statuses:[],total_count:0}}]);const d=await collect({username:'octocat',client:f.client});assert.equal(d.open[0].partial,true);assert.equal(d.open[0].reviewUnknown,true);assert.equal(d.open[0].checksUnknown,true);const md=renderMarkdown(d);assert.match(md,/Partial data/);assert.match(md,/Unavailable/);assert.equal(md.includes('No public HEAD checks'),false);});
test('truncated detail explicitly partial',async()=>{const responses=detailResponses();responses[1].headers={link:'<https://api.github.com/next>; rel="next"'};const f=fixture([{data:search([item()])},{data:search([])},...responses]);const d=await collect({username:'octocat',client:f.client});assert.equal(d.open[0].partial,true);});
test('429 stops further network attempts and never prints secret',async()=>{const f=fixture([{status:429}]);await assert.rejects(f.client.get('/test'),/rate limit/);await assert.rejects(f.client.get('/next'),/rate limit/);assert.equal(f.calls.length,1);});
test('403 without rate metadata is ordinary unavailable, not blanket global cooldown',async()=>{const f=fixture([{status:403},{data:[]}]);await assert.rejects(f.client.get('/test'),/HTTP 403/);await f.client.get('/other');assert.equal(f.calls.length,2);});
test('network errors hide sensitive error details',async()=>{const f=fixture([{throw:true}]);await assert.rejects(f.client.get('/test'),/network request failed/);});
test('merged sample sorted by actual merge date',async()=>{const old={...item(1),pull_request:{merged_at:'2026-01-01T00:00:00Z'}},recent={...item(2),pull_request:{merged_at:'2026-02-01T00:00:00Z'}};const p=pr(2);p.merged=true;p.state='closed';const f=fixture([{data:search([])},{data:search([old,recent])},...detailResponses(p)]);const d=await collect({username:'octocat',limit:1,client:f.client});assert.equal(d.merged[0].number,2);assert.match(renderMarkdown(d),/Merged/);});
test('non-GitHub repository URL cannot inject network target',async()=>{const bad={...item(),repository_url:'https://evil.test/owner/repo'};const f=fixture([{data:search([bad])},{data:search([])}]);await assert.rejects(collect({username:'octocat',client:f.client}),/Unexpected/);assert.equal(f.calls.length,1);});

test('malformed JSON errors do not leak raw response text',async()=>{const client=new GitHubClient({fetchImpl:async()=>({ok:true,headers:{get:()=>null},json:async()=>{throw Error('SECRET response body');}})});await assert.rejects(client.get('/test'),e=>e.message==='GitHub returned an invalid JSON response.');});

test('external scope is default and excludes own repositories case-insensitively',async()=>{
 const own={...item(2),repository_url:'https://api.github.com/repos/OCTOCAT/own-fork'};
 const f=fixture([{data:search([own,item()])},{data:search([])},...detailResponses()]);
 const d=await collect({username:'Octocat',client:f.client});
 assert.match(decodeURIComponent(f.calls[0].url),/-user:Octocat/);
 assert.equal(d.includeOwn,false);assert.equal(d.open.length,1);assert.equal(d.totals.open,1);
 assert.equal(f.calls.some(c=>c.url.includes('/OCTOCAT/own-fork/')),false);
 assert.match(renderMarkdown(d),/External repositories only/);
});
test('include-own opt-in includes own repositories and removes exclusion query',async()=>{
 const own={...item(),repository_url:'https://api.github.com/repos/Octocat/own'};
 const p=pr();p.base.repo.full_name='Octocat/own';
 const f=fixture([{data:search([own])},{data:search([])},...detailResponses(p)]);
 const d=await collect({username:'octocat',includeOwn:true,client:f.client});
 assert.equal(decodeURIComponent(f.calls[0].url).includes('-user:'),false);
 assert.equal(d.open.length,1);assert.equal(d.open[0].repo,'Octocat/own');
 assert.match(renderMarkdown(d),/All public repositories/);
});
test('organizations remain included in external-only scope',async()=>{
 const f=fixture([{data:search([item()])},{data:search([])},...detailResponses()]);
 const d=await collect({username:'octocat',client:f.client});assert.equal(d.open[0].repo,'upstream/example');
});
test('include-own CLI and environment settings have strict boolean semantics',()=>{
 assert.equal(parseArgs(['--username','octocat'],{}).includeOwn,false);
 assert.equal(parseArgs(['--username','octocat','--include-own'],{}).includeOwn,true);
 assert.equal(parseArgs([],{INPUT_USERNAME:'octocat',INPUT_INCLUDE_OWN:'true'}).includeOwn,true);
 assert.equal(parseArgs([],{INPUT_USERNAME:'octocat',INPUT_INCLUDE_OWN:'true',PR_COMPASS_INCLUDE_OWN:'false'}).includeOwn,false);
 for(const bad of ['yes','1','FALSE',''])assert.throws(()=>parseArgs([],{INPUT_USERNAME:'octocat',INPUT_INCLUDE_OWN:bad}),/include-own/);
});
test('native output shows counts, exact HEAD, active review and localized scope',async()=>{
 const p=pr();p.draft=true;
 const responses=detailResponses(p);responses[2].data={total_count:3,check_runs:[{status:'completed',conclusion:'success'},{status:'completed',conclusion:'skipped'},{status:'completed',conclusion:'failure'}]};
 const f=fixture([{data:{...search([item()]),total_count:7}},{data:search([])},...responses]);
 const d=await collect({username:'octocat',client:f.client});const md=renderMarkdown(d);
 assert.match(md,/Showing 1 of 7/);assert.doesNotMatch(md,/\| ---/);
 assert.doesNotMatch(md,/\| --- \| --- \| --- \| --- \|/);
 assert.match(md,/\*\*Draft\*\*/);assert.match(md,new RegExp(`/commit/${sha}`));
 assert.match(md,/1 failed; 1 success; 1 neutral \/ skipped \/ other/);
 assert.doesNotMatch(md,/0 pending|0 approved|0 changes requested/);
 assert.match(md,/No active decision reviews/);assert.match(md,/<details>/);
 const ko=renderMarkdown(d,{language:'ko'});assert.match(ko,/외부 저장소 기여만 표시/);assert.match(ko,/7건 중 1건 표시/);assert.match(ko,/초안/);
});
test('include-own cannot opt into private data',async()=>{
 const p=pr();p.base.repo.private=true;
 const f=fixture([{data:search([item()])},{data:search([])},{data:p}]);
 await assert.rejects(collect({username:'octocat',includeOwn:true,client:f.client}),/visibility/);
});

test('native merged-first entries remain visible, have no dates or images, and collapse only status detail',async()=>{
 const p=pr();p.merged=true;p.state='closed';p.merged_at='2026-01-02T00:00:00Z';
 const f=fixture([{data:search([item(2)])},{data:search([item()])},...detailResponses(pr(2)),...detailResponses(p)]);
 const data=await collect({username:'octocat',client:f.client,now:'2026-01-03T00:00:00Z'});
 const md=renderMarkdown(data);
 assert.ok(md.indexOf('### Recently merged')<md.indexOf('#### Open'));
 assert.ok(md.indexOf('#### Open')<md.indexOf('<details>'));
 assert.match(md,/- \*\*\[Fix thing\]\(https:\/\/github.com\/upstream\/example\/pull\/1\)\*\*/);
 assert.match(md,/Checks &amp; review/);
 assert.ok(md.indexOf('Observed:')>md.indexOf('<summary>About this snapshot</summary>'));
 assert.doesNotMatch(md,/2026-01-02|<img|<svg|<picture|\.svg|!\[|\| ---/);
 assert.match(md,/Observed: 2026-01-03 00:00:00 UTC/);
});
test('native titles escape injected Markdown and HTML in both visible lists',async()=>{
 const p=pr();p.title='[bad](https://evil.test) <img src=x> | @everyone';
 const f=fixture([{data:search([item()])},{data:search([])},...detailResponses(p)]);
 const md=renderMarkdown(await collect({username:'octocat',client:f.client}));
 assert.doesNotMatch(md,/<img|@everyone|\]\(https:\/\/evil\.test\)/);
 assert.match(md,/&lt;img/);
});
test('stream embedding keeps native links, uses theme anchors and validates relative path',()=>{
 const data={merged:[],open:[],totals:{merged:0,open:0},observedAt:'2026-11-17T00:00:00.000Z',includeOwn:false};
 const md=renderMarkdown(data,{stream:{directory:'assets/pr-compass'}});
 assert.equal((md.match(/<a href=/g)||[]).length,2);
 assert.match(md,/stream-light\.svg\?v=.*#gh-light-mode-only/);
 assert.match(md,/stream-dark\.svg\?v=.*#gh-dark-mode-only/);
 assert.ok(md.indexOf('Recently merged')<md.indexOf('#### Open'));
 assert.throws(()=>renderMarkdown(data,{stream:{directory:'../evil'}}),/Invalid stream/);
});
