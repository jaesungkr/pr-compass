import test from 'node:test';
import assert from 'node:assert/strict';
import {renderSvg,renderAssets,wrapText,escapeXml} from '../src/visual.mjs';
const entry=(n=1)=>({repo:'scipy/scipy',number:n,title:'Remove an unused scalar function wrapper',sha:'a'.repeat(40),merged:true,mergedAt:'2026-11-16T21:57:00Z',checks:{total:2,success:1,other:1},review:{approvals:1,current:1,changes:0}});
const sample=()=>({username:'octocat',includeOwn:false,observedAt:'2026-11-17T09:00:00.000Z',totals:{merged:2,open:9},merged:[entry(),{...entry(2),repo:'joblib/joblib',title:'Clarify dump return values for file objects'}],open:[{...entry(3),merged:false,repo:'scikit-learn/scikit-learn',title:'Clarify n_jobs in LocallyLinearEmbedding',checks:{total:44,success:38,other:6}},{...entry(4),merged:false,repo:'Cysharp/UniTask',title:'Consume succeeded sources in SuppressCancellationThrow',checks:{total:0}}]});
test('visual assets are deterministic, themed, separate mobile layouts and do not mutate data',()=>{const data=sample(),original=JSON.stringify(data),assets=renderAssets(data);assert.equal(JSON.stringify(data),original);assert.deepEqual(renderAssets(data),assets);assert.equal(Object.keys(assets).length,4);assert.match(assets['overview-light.svg'],/viewBox="0 0 920 /);assert.match(assets['overview-mobile-light.svg'],/viewBox="0 0 440 /);assert.notEqual(assets['overview-dark.svg'],assets['overview-light.svg']);});
test('merged comes before open, caps previews at two, retains factual counts',()=>{const data=sample();data.open.push({...entry(99),merged:false});const svg=renderSvg(data);assert.ok(svg.indexOf('scipy/scipy #1')<svg.indexOf('scikit-learn/scikit-learn #3'));assert.doesNotMatch(svg,/#99/);assert.match(svg,/2 shown \/ 9 matches/);assert.match(svg,/No public HEAD checks/);assert.match(svg,/38 passed/);assert.match(svg,/neutral \/ skipped \/ other/);});
test('SVG escapes titles and control characters without active or remote content',()=>{const data=sample();data.merged[0].title='<script>x</script> & "evil"';const svg=renderSvg(data);assert.doesNotMatch(svg,/<script|foreignObject|<a\s|<image\s|@import|url\(|href=/);assert.match(svg,/&lt;script&gt;/);assert.equal(escapeXml('\u0000<>&"\''),' &lt;&gt;&amp;&quot;&apos;');});
test('long titles wrap by Unicode width and truncate at the permitted line count',()=>{assert.equal(wrapText('기여'.repeat(100),10,2).length,2);assert.match(wrapText('기여'.repeat(100),10,2)[1],/…$/);assert.ok(wrapText('W'.repeat(500),20,3).every(s=>s.length<30));});
test('Korean, empty, partial and unavailable states render honestly',()=>{const data=sample();data.open[0].checksUnknown=true;data.open[0].partial=true;let svg=renderSvg(data,{language:'ko',mobile:true});assert.match(svg,/최근 병합/);assert.match(svg,/검사 조회 불가/);assert.match(svg,/일부 정보/);data.merged=[];data.open=[];svg=renderSvg(data);assert.match(svg,/Your next contribution belongs here/);assert.match(svg,/No open pull requests/);});
export {sample};

test('partial warning leads the visible metadata even when long check summaries truncate',()=>{const data=sample();data.open[0].partial=true;data.open[0].checks={total:999999,failed:1000,pending:2000,attention:3000,success:4000,other:5000};const svg=renderSvg(data,{mobile:true});assert.match(svg,/>Partial data · Open/);assert.ok(svg.indexOf('Partial data · Open')<svg.indexOf('1000 failed'));});

test('open search entry that merged during collection uses verified merged state',()=>{const data=sample();data.open=[{...entry(42),closed:true,merged:true}];const svg=renderSvg(data,{mobile:true});assert.match(svg,/>Merged · 1 passed/);assert.doesNotMatch(svg,/>Closed ·/);});

test('word-aware wrapping keeps scalar function wrapper and other English words intact',()=>{
  assert.deepEqual(wrapText('scalar function wrapper',6,3),['scalar','function','wrapper']);
  const lines=wrapText('Remove an unused scalar function wrapper',12,4);
  assert.equal(lines.join(' '),'Remove an unused scalar function wrapper');
  assert.ok(lines.some(line=>line.includes('scalar')));
  assert.ok(lines.every(line=>!line.endsWith(' s')&&!line.startsWith('calar')));
  const values=wrapText('Clarify dump return values for file objects',13,4);
  assert.equal(values.join(' '),'Clarify dump return values for file objects');
  assert.ok(values.every(line=>!line.endsWith(' f')&&!line.startsWith('or ')));
  assert.match(wrapText('scalar function wrapper',6,2)[1],/…$/);
});
