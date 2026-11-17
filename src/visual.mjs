const copy = {
  en: {brand:'PR COMPASS',title:'Contributions, landed.',allTitle:'Public work, in motion.',merged:'Recently merged',open:'Open',external:'External repositories',all:'Public repositories',emptyMerged:'Your next contribution belongs here.',emptyOpen:'No open pull requests.',details:'Full PR links and status details below.',observed:'Observed',noChecks:'No public HEAD checks',unknown:'Checks unavailable',partial:'Partial data',success:'passed',failed:'failed',pending:'running',attention:'need attention',other:'neutral / skipped / other',draft:'Draft',openState:'Open',mergedState:'Merged',closed:'Closed',shown:(n,total)=>`${n} shown / ${total} matches`},
  ko: {brand:'PR COMPASS',title:'기여가 쌓이는 곳.',allTitle:'공개 작업, 한눈에.',merged:'최근 병합',open:'진행 중',external:'외부 저장소 기여',all:'공개 저장소',emptyMerged:'다음 기여를 기다리는 자리입니다.',emptyOpen:'진행 중인 PR이 없습니다.',details:'PR 링크와 자세한 상태는 아래에서 확인하세요.',observed:'확인',noChecks:'공개 HEAD 검사 없음',unknown:'검사 조회 불가',partial:'일부 정보',success:'성공',failed:'실패',pending:'진행',attention:'조치 필요',other:'중립·생략·기타',draft:'초안',openState:'진행 중',mergedState:'병합',closed:'닫힘',shown:(n,total)=>`${total}건 중 ${n}건 표시`}
};
const themes = {
  light:{bg:'#f4f7f5',panel:'#ffffff',ink:'#183b32',muted:'#65766f',line:'#dce6df',accent:'#227955',tint:'#e8f2eb',soft:'#edf1ee',warning:'#97551b'},
  dark:{bg:'#111b17',panel:'#18271f',ink:'#e3efe7',muted:'#a1b5a8',line:'#30473a',accent:'#a4d8ad',tint:'#243d2c',soft:'#1c2d23',warning:'#f0be81'}
};
export function escapeXml(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
}
function unit(char) { return /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\uff01-\uff60]/u.test(char) || char.codePointAt(0)>0xffff ? 1 : /[MW@%]/.test(char) ? .85 : /[il.,:;'!| ]/.test(char) ? .28 : .56; }
export function wrapText(value,maxUnits,maxLines=2) {
  let remaining=Array.from(String(value??'').replace(/\s+/g,' ').trim());
  const lines=[];
  const fitted=(chars,budget)=>{let count=0,width=0;for(const char of chars){if(width+unit(char)>budget)break;width+=unit(char);count++;}return Math.max(1,count);};
  while(remaining.length && lines.length<maxLines) {
    const count=fitted(remaining,maxUnits);
    if(count>=remaining.length){lines.push(remaining.join('').trim());break;}
    const lastLine=lines.length===maxLines-1;
    const limit=lastLine?fitted(remaining,Math.max(1,maxUnits-1)):count;
    let cut=limit;
    // Keep words intact whenever a whitespace boundary is available. Long
    // individual tokens and scripts without spaces still use a hard break.
    if(remaining[limit]!==' ' && remaining[limit-1]!==' ') {
      const whitespace=remaining.slice(0,limit).lastIndexOf(' ');
      if(whitespace>0)cut=whitespace;
    }
    lines.push(remaining.slice(0,cut).join('').trimEnd()+(lastLine?'…':''));
    if(lastLine)break;
    remaining=remaining.slice(cut);
    while(remaining[0]===' ')remaining.shift();
  }
  return lines.length?lines:[''];
}
function checkLabel(p,t) {
  if(p.checksUnknown)return t.unknown;
  const c=p.checks;
  if(!c?.total)return t.noChecks;
  return [['failed',t.failed],['pending',t.pending],['attention',t.attention],['success',t.success],['other',t.other]].filter(([key])=>c[key]>0).map(([key,label])=>`${c[key]} ${label}`).join(' · ');
}
export function renderSvg(data,{language='en',theme='light',mobile=false}={}) {
  const t=copy[language],c=themes[theme];if(!t||!c)throw new Error('Unsupported visual language or theme.');
  const width=mobile?440:920,pad=mobile?24:40,inner=width-pad*2;const chunks=[];
  const text=(value,x,y,size=18,fill=c.ink,weight=400,extra='')=>chunks.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}" ${extra}>${escapeXml(value)}</text>`);
  const rect=(x,y,w,h,fill=c.panel,rx=16,stroke=c.line)=>chunks.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}"/>`);
  text(t.brand,pad,38,18,c.accent,700,'letter-spacing="2"');
  text(data.includeOwn?t.allTitle:t.title,pad,80,mobile?30:38,c.ink,650);
  text(data.includeOwn?t.all:t.external,pad,110,18,c.muted);
  const metricY=mobile?137:25,metricX=mobile?pad:590,metricW=mobile?inner:290;
  rect(metricX,metricY,metricW,86,c.tint,16,c.tint);
  text(String(data.totals.merged),metricX+20,metricY+47,38,c.accent,700);
  text(t.merged,metricX+20,metricY+71,18,c.muted,500);
  chunks.push(`<path d="M ${metricX+metricW*.57} ${metricY+18} v 50" stroke="${c.line}"/>`);
  text(String(data.totals.open),metricX+metricW*.64,metricY+43,29,c.ink,650);
  text(t.open,metricX+metricW*.64,metricY+69,18,c.muted,500);
  let y=mobile?252:165;
  for(const kind of ['merged','open']) {
    const rows=data[kind].slice(0,2),merged=kind==='merged';
    text(t[kind],pad,y,mobile?23:26,c.ink,650);
    text(t.shown(rows.length,data.totals[kind]),width-pad,y,18,c.muted,400,'text-anchor="end"');
    y+=23;
    if(!rows.length) {rect(pad,y,inner,66,c.soft,14,c.soft);text(t[kind==='merged'?'emptyMerged':'emptyOpen'],pad+18,y+41,18,c.muted);y+=78;}
    if(merged && rows.length) {
      const gap=16,cardW=mobile?inner:(inner-gap)/2,cardH=mobile?150:176;
      rows.forEach((p,index)=>{
        const x=mobile?pad:pad+index*(cardW+gap),top=mobile?y+index*(cardH+12):y;
        rect(x,top,cardW,cardH,c.panel,16,c.line);
        chunks.push(`<rect x="${x+18}" y="${top+19}" width="5" height="21" rx="2" fill="${c.accent}"/>`);
        text(wrapText(`${p.repo} #${p.number}`,(cardW-58)/(mobile?20:18),1)[0],x+34,top+34,mobile?20:18,c.accent,600);
        const titleLines=wrapText(p.title,(cardW-40)/(mobile?22:23),mobile?2:3);
        titleLines.forEach((line,i)=>text(line,x+20,top+65+i*(mobile?25:28),mobile?22:23,c.ink,550));
        const date=p.mergedAt?String(p.mergedAt).slice(0,10):'';
        text(`${t.mergedState}${date?' · '+date:''}`,x+20,top+cardH-19,18,c.muted,500);
      });
      y+=mobile?rows.length*(cardH+12):cardH+12;
    } else for(const p of rows) {
      const h=mobile?112:105;
      rect(pad,y,inner,h,c.soft,14,c.soft);
      text(wrapText(`${p.repo} #${p.number}`,(inner-40)/(mobile?20:18),1)[0],pad+20,y+28,mobile?20:18,c.ink,600);
      text(wrapText(p.title,(inner-40)/(mobile?22:20),1)[0],pad+20,y+55,mobile?22:20,c.muted,500);
      const state=p.merged?t.mergedState:p.closed?t.closed:p.draft?t.draft:t.openState;
      const meta=`${p.partial?t.partial+' · ':''}${state} · ${checkLabel(p,t)}`;
      const metaLines=wrapText(meta,(inner-40)/18,mobile?2:1);
      metaLines.forEach((line,i)=>text(line,pad+20,y+80+i*21,18,p.checks?.failed||p.checks?.attention?c.warning:c.muted));
      y+=h+10;
    }
    y+=23;
  }
  chunks.push(`<path d="M ${pad} ${y-5} H ${width-pad}" stroke="${c.line}"/>`);
  const footerLines=wrapText(t.details,inner/18,2);
  footerLines.forEach((line,i)=>text(line,pad,y+23+i*23,18,c.muted));
  y+=(footerLines.length-1)*23;
  const time=String(data.observedAt).replace('T',' ').replace(/\.\d{3}Z$/,' UTC');
  text(`${t.observed} ${time}`,pad,y+49,18,c.muted);
  const height=y+76;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc"><title id="title">${escapeXml(t.brand+' — '+t.merged+' '+data.totals.merged+', '+t.open+' '+data.totals.open)}</title><desc id="desc">${escapeXml(t.details+' '+t.observed+' '+time)}</desc><rect x=".5" y=".5" width="${width-1}" height="${height-1}" rx="24" fill="${c.bg}" stroke="${c.line}"/><g font-family="Noto Sans CJK KR, Apple SD Gothic Neo, Malgun Gothic, -apple-system, BlinkMacSystemFont, Segoe UI, Arial, sans-serif">${chunks.join('')}</g></svg>\n`;
}
export function renderAssets(data,{language='en'}={}) {
  return Object.fromEntries([['overview-light.svg','light',false],['overview-dark.svg','dark',false],['overview-mobile-light.svg','light',true],['overview-mobile-dark.svg','dark',true]].map(([name,theme,mobile])=>[name,renderSvg(data,{language,theme,mobile})]));
}
