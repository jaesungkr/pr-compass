import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze,renderText} from '../src/next-action.mjs';
const base=()=>({repo:'external/project',number:42,title:'Fix a useful bug',url:'https://github.com/external/project/pull/42',sha:'a'.repeat(40),draft:false,merged:false,closed:false,partial:false,checksUnknown:false,reviewUnknown:false,
  checks:{total:2,success:2,failed:0,pending:0,attention:0,other:0},review:{approvals:0,current:0,changes:0}});
const snapshot=(prs,merged=[])=>({username:'octocat',observedAt:'2026-11-17T00:00:00.000Z',open:prs,merged,truncated:{open:false,merged:false}});
const classify=(overrides={},options)=>analyze(snapshot([{...base(),...overrides}]),options).items[0];
const checks=changes=>({...base().checks,...changes});
test('observed green is waiting, never a ready-to-merge verdict',()=>{const p=classify();assert.equal(p.category,'waiting');assert.equal(p.reasons[0].code,'no_public_blocker_observed');assert.match(p.nextStep,/do not mean ready to merge/);assert.doesNotMatch(p.nextStep,/maintainer|owes/);});
test('failed checks are attention and inspection rather than blame',()=>{const p=classify({checks:checks({success:1,failed:1})});assert.equal(p.category,'attention');assert.match(p.nextStep,/compare the baseline/);assert.equal(p.reasons[0].code,'checks_failed');});
test('known failure beats partial data with explicit caveat',()=>{const p=classify({partial:true,checksUnknown:true,checks:checks({success:1,failed:1})});assert.equal(p.category,'attention');assert.equal(p.caveats.length,1);});
test('changes requested stays an inspect signal even with unavailable checks',()=>{const p=classify({checksUnknown:true,review:{approvals:0,current:0,changes:1}});assert.equal(p.category,'attention');assert.match(p.nextStep,/already been addressed/);assert.equal(p.caveats.length,1);});
test('multiple signals retained; failure next step has precedence',()=>{const p=classify({draft:true,checks:checks({success:0,failed:1,pending:1}),review:{approvals:0,current:0,changes:1}});assert.equal(p.category,'attention');assert.deepEqual(p.reasons.map(r=>r.code),['checks_failed','changes_requested','draft']);assert.match(p.nextStep,/failing logs/);});
test('draft is attention even with no checks or partial details',()=>{const p=classify({draft:true,partial:true,checks:checks({total:0,success:0})});assert.equal(p.category,'attention');assert.equal(p.reasons[0].code,'draft');});
test('known merged overrides failures and draft',()=>{const p=classify({merged:true,closed:true,draft:true,checks:checks({success:1,failed:1})});assert.equal(p.category,'done');assert.equal(p.state,'merged');assert.deepEqual(p.reasons.map(r=>r.code),['merged']);});
test('closed without merge is explicit done, not merged',()=>{const p=classify({closed:true,partial:true});assert.equal(p.category,'done');assert.equal(p.state,'closed');assert.equal(p.reasons[0].code,'closed_without_merge');assert.match(p.reasons[0].message,/without merge/);});
test('merged search membership alone cannot establish merged state',()=>{const report=analyze(snapshot([],[base()]));assert.equal(report.items[0].category,'waiting');assert.equal(report.items[0].state,'open');});
test('merge race deduplicates and prefers verified terminal state',()=>{const open=base(),merged={...base(),merged:true,closed:true};const report=analyze(snapshot([open],[merged]));assert.equal(report.items.length,1);assert.equal(report.summary.done,1);assert.equal(report.items[0].state,'merged');});
test('pending is waiting only when data is known',()=>{const p=classify({checks:checks({success:1,pending:1})});assert.equal(p.category,'waiting');assert.equal(p.reasons[0].code,'checks_pending');assert.equal(classify({partial:true,checks:checks({success:1,pending:1})}).category,'unknown');});
test('unavailable reviews prevent green from becoming waiting',()=>{const p=classify({reviewUnknown:true});assert.equal(p.category,'unknown');assert.equal(p.reasons[0].code,'incomplete_data');});
test('empty checks are unknown, even with approvals',()=>{const p=classify({checks:checks({total:0,success:0}),review:{approvals:2,current:2,changes:0}});assert.equal(p.category,'unknown');assert.equal(p.reasons[0].code,'no_public_checks');});
test('neutral and skipped outcomes do not become success',()=>{const p=classify({checks:checks({success:0,other:2})});assert.equal(p.category,'unknown');assert.equal(p.reasons[0].code,'non_success_results');});
test('cancelled/action-required outcomes need attention unlike neutral',()=>{const p=classify({checks:checks({success:1,attention:1})});assert.equal(p.category,'attention');assert.equal(p.reasons[0].code,'checks_need_attention');assert.match(p.nextStep,/before rerunning/);});
test('invalid/missing count data cannot falsely establish waiting',()=>{assert.equal(classify({checks:{total:2,success:2}}).category,'unknown');assert.equal(classify({checks:checks({total:5})}).category,'unknown');});
test('English/Korean reasons and next steps have same stable codes',()=>{const en=classify({draft:true}),ko=classify({draft:true},{language:'ko'});assert.equal(en.reasons[0].code,ko.reasons[0].code);assert.match(ko.reasons[0].message,/초안/);assert.match(ko.nextStep,/리뷰/);});
test('analysis does not mutate input and creates JSON structured report',()=>{const data=snapshot([base()]);const before=JSON.stringify(data),report=analyze(data);assert.equal(JSON.stringify(data),before);assert.deepEqual(JSON.parse(JSON.stringify(report)).summary,{attention:0,waiting:1,done:0,unknown:0});});
test('text groups categories, includes links and never emits ANSI from hostile title',()=>{const p={...base(),title:'evil\u001b[31m\ntext\u202e'};const report=analyze(snapshot([p]));const text=renderText(report,{color:false});assert.match(text,/https:\/\/github.com\/external\/project\/pull\/42/);assert.match(text,/Waiting \(1\)/);assert.equal(text.includes('\u001b'),false);assert.equal(text.includes('\u202e'),false);assert.equal(text.includes('evil\n'),false);});
test('empty reports remain explicit and contain limitations',()=>{const report=analyze(snapshot([]));assert.deepEqual(report.summary,{attention:0,waiting:0,done:0,unknown:0});assert.match(renderText(report),/No public PRs/);assert.match(renderText(report),/Not a merge-readiness verdict/);});
test('unsupported language and invalid input fail explicitly',()=>{assert.throws(()=>analyze(snapshot([]),{language:'fr'}));assert.throws(()=>analyze({}));});

test('structured JSON display fields strip control and bidi characters too',()=>{const p={...base(),title:'bad\u001b[31m\u202e',repo:'external/\nproject'};const report=analyze(snapshot([p]));assert.equal(report.items[0].title.includes('\u001b'),false);assert.equal(report.items[0].title.includes('\u202e'),false);assert.equal(report.items[0].repo.includes('\n'),false);});

test('sample counts survive JSON and plain output without implying full coverage',()=>{const report=analyze({username:'octocat',open:[],merged:[],totals:{open:9,merged:2},observedAt:'2026-11-17'});assert.equal(report.sample.open.total,9);assert.match(renderText(report),/Sample: open 0\/9 \| merged 0\/2/);});

const stripAnsi=s=>s.replace(/\u001b\[[0-9;]*m/g,'');
const displayCells=s=>[...new Intl.Segmenter('ko',{granularity:'grapheme'}).segment(stripAnsi(s))].reduce((sum,{segment})=>sum+(/\p{Script=Hangul}|\p{Script=Han}|\p{Extended_Pictographic}/u.test(segment)?2:1),0);
test('render cards rank attention, unknown, waiting, done without altering JSON',()=>{
 const all=[{...base(),number:1},{...base(),number:2,merged:true,closed:true},{...base(),number:3,checksUnknown:true},{...base(),number:4,draft:true}];
 const report=analyze(snapshot(all)),before=JSON.stringify(report),text=renderText(report);
 assert.ok(text.indexOf('Attention (1)')<text.indexOf('Unknown (1)'));assert.ok(text.indexOf('Unknown (1)')<text.indexOf('Waiting (1)'));assert.ok(text.indexOf('Waiting (1)')<text.indexOf('Done (1)'));
 assert.match(text,/01\. external\/project#4/);assert.match(text,/02\. external\/project#3/);assert.equal(JSON.stringify(report),before);
});
test('attention ranking prioritizes failed checks over draft without changing classification',()=>{
 const draft={...base(),number:1,draft:true},fail={...base(),number:2,checks:checks({success:1,failed:1})};const text=renderText(analyze(snapshot([draft,fail])));
 assert.match(text,/01\. external\/project#2/);assert.match(text,/02\. external\/project#1/);
});
test('40/60/80-column Korean display wrapping respects cells except intact URLs',()=>{
 const p={...base(),title:'아주긴한글제목을공백없이사용하여터미널표시너비를검증합니다'.repeat(4),draft:true,partial:true,url:'https://github.com/very-long-organization/very-long-repository-name/pull/12345678'};
 for(const width of [40,60,80]) for(const color of [false,true]) {
  const text=renderText(analyze(snapshot([p]),{language:'ko'}),{width,color});
  for(const line of text.split('\n'))if(!line.includes(p.url))assert.ok(displayCells(line)<=width,`${width}: ${stripAnsi(line)} (${displayCells(line)})`);
  assert.ok(text.split('\n').includes('    '+p.url));assert.match(stripAnsi(text),/근거:/);assert.match(stripAnsi(text),/다음:/);
 }
});
test('ASCII layout and opt-in color preserve identical plain meaning',()=>{
 const report=analyze(snapshot([{...base(),draft:true}])),plain=renderText(report),colored=renderText(report,{color:true});
 assert.equal(stripAnsi(colored),plain);assert.equal(plain.includes('\u001b'),false);assert.ok(colored.includes('\u001b['));
 assert.doesNotMatch(plain,/[\u2500-\u257f→•·—]/);assert.match(plain,/Signal:/);assert.match(plain,/Evidence:/);assert.match(plain,/Next:/);
 const urlLine=colored.split('\n').find(l=>l.includes('https://github.com'));assert.equal(urlLine.includes('\u001b'),false);
});
test('wrapping does not split combining characters or emoji grapheme sequences',()=>{
 const title=('e\u0301한👨‍👩‍👧‍👦 ').repeat(25),report=analyze(snapshot([{...base(),title}]));const text=renderText(report,{width:40});
 assert.ok(text.includes('👨‍👩‍👧‍👦'));assert.ok(text.includes('e\u0301'));assert.doesNotMatch(text,/\n\s*\u0301/);
});
test('width default equals explicit 80 and invalid widths fail clearly',()=>{
 const report=analyze(snapshot([base()]));assert.equal(renderText(report),renderText(report,{width:80}));for(const width of [0,19,241,501,40.5,NaN,'40'])assert.throws(()=>renderText(report,{width}),/Width/);
});

test('empty color-enabled report still colors the heading',()=>{const report=analyze(snapshot([]));const colored=renderText(report,{color:true,width:40});assert.ok(colored.startsWith('\u001b[1m'));assert.equal(stripAnsi(colored),renderText(report,{width:40}));});
