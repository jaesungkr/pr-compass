const labels = {
  en: {title:'Merge stream',merged:'Recently merged',open:'Open',draft:'Draft',closed:'Closed',other:'Open search snapshot',mergedState:'Merged',emptyMerged:'No verified merged PRs in this snapshot.',emptyOpen:'No open PRs in this snapshot.',note:'Moving dots represent verified merges only.',sample:'Snapshot preview · not a CI signal'},
  ko: {title:'기여의 흐름',merged:'최근 병합',open:'진행 중',draft:'초안',closed:'닫힘',other:'열린 PR 조회 결과',mergedState:'병합',emptyMerged:'이 스냅샷에 확인된 병합 PR이 없습니다.',emptyOpen:'이 스냅샷에 진행 중인 PR이 없습니다.',note:'움직이는 점은 확인된 병합만 나타냅니다.',sample:'스냅샷 미리보기 · CI 상태와 무관'}
};
const palettes={
  light:{ink:'#19372e',muted:'#65776d',line:'#c9d6cd',accent:'#27836e',open:'#91a59a'},
  dark:{ink:'#dcebe2',muted:'#a2b6a9',line:'#40584a',accent:'#80d2b3',open:'#819c8d'}
};
export function escapeStreamXml(value) {
  return String(value??'').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
}
function weight(char) {return /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\uff01-\uff60]/u.test(char)||char.codePointAt(0)>0xffff?1:/[il.,:;'!| ]/.test(char)?.28:/[MW@%]/.test(char)?.85:.56;}
function shortLabel(value,max=15) {
  const text=String(value??'').replace(/\s+/g,' ').trim();const chars=Array.from(text);let width=0;
  if(chars.reduce((n,c)=>n+weight(c),0)<=max)return text;
  let out='';for(const c of chars){if(width+weight(c)>max-1)break;out+=c;width+=weight(c);}return out.trimEnd()+'…';
}
function entries(data) {
  const seen=new Set(),items=[];
  for(const p of [...(data.merged||[]),...(data.open||[])]) {
    const key=String(p.repo).toLowerCase()+'#'+p.number;
    if(seen.has(key))continue;seen.add(key);items.push(p);
  }
  // Only an explicit detail response saying merged=true can animate. Search
  // category membership, success checks and approval records are insufficient.
  const merged=items.filter(p=>p.merged===true),open=items.filter(p=>p.merged!==true);
  return {merged:merged.slice(0,3),open:open.slice(0,2),totals:{merged:merged.length,open:open.length}};
}
export function renderStream(data,{language='en',theme='auto'}={}) {
  const t=labels[language];if(!t||!['auto','light','dark'].includes(theme))throw new Error('Unsupported stream language or theme.');
  const groups=entries(data),palette=palettes[theme==='dark'?'dark':'light'];
  const vars=p=>`--ink:${p.ink};--muted:${p.muted};--line:${p.line};--accent:${p.accent};--open:${p.open};`;
  const css=`svg{${vars(palette)}}text{fill:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}.muted{fill:var(--muted)}.spine{stroke:var(--line)}.merged-line{stroke:var(--accent)}.open-line{stroke:var(--open)}.merged-node,.particle{fill:var(--accent)}.open-node{fill:transparent;stroke:var(--open)}@media(prefers-reduced-motion:reduce){.particle{display:none}}${theme==='auto'?`@media(prefers-color-scheme:dark){svg{${vars(palettes.dark)}}}`:''}`;
  const body=[];
  const text=(value,x,y,size=18,cls='',extra='')=>body.push(`<text x="${x}" y="${y}" font-size="${size}" class="${cls}" ${extra}>${escapeStreamXml(value)}</text>`);
  let y=26;
  const spineStart=y+30,sections=[];
  for(const kind of ['merged','open']) {
    const items=groups[kind],caption=kind==='open'&&items.some(p=>p.closed)?t.other:t[kind];
    text(`${caption} · ${items.length}/${groups.totals[kind]} ${language==='ko'?'표시':'shown'}`,16,y,20,'','font-weight="600"');y+=26;
    if(!items.length) {text(t[kind==='merged'?'emptyMerged':'emptyOpen'],16,y+16,16,'muted');y+=49;}
    for(const p of items) {
      const center=y+22,merged=kind==='merged';
      body.push(`<g class="${merged?'verified-merge':'unjoined'}"><title>${escapeStreamXml(`${p.repo} #${p.number} · ${merged?t.mergedState:p.closed?t.closed:p.draft?t.draft:t.open}`)}</title>`);
      text(shortLabel(p.repo),16,y+17,18,'','font-weight="550"');
      text(`#${p.number} · ${merged?t.mergedState:p.closed?t.closed:p.draft?t.draft:t.open}`,16,y+38,16,'muted');
      if(merged) {
        const d=`M 304 ${center} H 338 Q 360 ${center} 372 ${center+16} T 404 ${center+32}`;
        body.push(`<path d="${d}" class="merged-line" stroke-width="1.5" fill="none"/><circle cx="304" cy="${center}" r="3" class="merged-node"/><circle cx="404" cy="${center+32}" r="3" class="merged-node"/>`);
        body.push(`<circle r="3" class="particle" opacity="0"><animateMotion dur="6s" begin="${(sections.length%5)*1.1}s" repeatCount="indefinite" path="${d}" calcMode="paced"/><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.12;0.82;1" dur="6s" begin="${(sections.length%5)*1.1}s" repeatCount="indefinite"/></circle>`);
      } else {
        body.push(`<path d="M 304 ${center} H 366" class="open-line" stroke-width="1.5" fill="none"/><circle cx="304" cy="${center}" r="3" class="open-node" stroke-width="1.5"/><circle cx="366" cy="${center}" r="3" class="open-node" stroke-width="1.5"/>`);
      }
      body.push('</g>');sections.push(center);y+=50;
    }
    y+=18;
  }
  const spineEnd=sections.length?Math.max(...sections)+32:spineStart;
  if(sections.length)body.unshift(`<path d="M 404 ${spineStart} V ${spineEnd}" class="spine" stroke-width="1.5" fill="none"/>`);
  text(t.note,16,y+3,16,'muted');text(t.sample,16,y+26,16,'muted');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="${y+43}" viewBox="0 0 440 ${y+43}" role="img" aria-labelledby="stream-title stream-desc"><title id="stream-title">${escapeStreamXml(t.title)}</title><desc id="stream-desc">${escapeStreamXml(t.note+' '+t.sample)}</desc><style>${css}</style>${body.join('')}</svg>\n`;
}
export function renderStreamAssets(data,{language='en'}={}) {
  return {'stream-light.svg':renderStream(data,{language,theme:'light'}),'stream-dark.svg':renderStream(data,{language,theme:'dark'})};
}
