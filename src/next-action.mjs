const CATEGORIES = ['attention', 'waiting', 'done', 'unknown'];
const copy = {
  en: {
    title: 'PR Next Action', observed: 'Observed', empty: 'No public PRs in this snapshot.',
    labels: {attention:'Attention', waiting:'Waiting', done:'Done', unknown:'Unknown'},
    scope: 'Public PR snapshot; HEAD checks and review records only.',
    limits: 'Not a merge-readiness verdict. Required checks, branch protection, test-merge checks, and conversation resolution are not evaluated.',
    sample: 'Search is bounded; merged PRs are ordered by merge date within the fetched sample.',
    partial: 'Some details are missing or truncated. Known signals are shown, not a complete assessment.',
    merged: 'GitHub reports this PR as merged.', closed: 'GitHub reports this PR as closed without merge.',
    failed: n => `${n} failing or timed-out HEAD check(s) observed.`,
    changes: n => `${n} change-request review record(s) observed.`,
    attention: n => `${n} cancelled, stale, or action-required HEAD check(s) observed.`,
    draft: 'This PR is still a draft.',
    pending: n => `${n} HEAD check(s) are pending or running.`,
    missing: 'Check or review information is incomplete or unavailable.',
    none: 'No public HEAD checks were found; this does not mean checks passed.',
    other: n => `${n} neutral, skipped, or other HEAD result(s); these are not counted as successes.`,
    clear: 'All observed HEAD checks succeeded and no change-request review record was found. No failure or change-request signal in these results.',
    fallback: 'The available evidence does not establish a next-action state.',
    mergedNext: 'No open-PR action indicated; check linked issues or release inclusion if relevant.',
    closedNext: 'Read the closure discussion if the reason or a possible follow-up matters.',
    failedNext: 'Inspect the failing logs and compare the baseline before deciding whether a code change is needed.',
    changesNext: 'Read the review thread and check whether its requests have already been addressed.',
    attentionNext: 'Check the run details for cancellation, execution permissions, or a required action before rerunning.',
    draftNext: 'Review the draft’s readiness and any remaining work before requesting review.',
    pendingNext: 'Wait for the running checks, then refresh this read-only snapshot.',
    clearNext: 'Wait or inspect the PR discussion and required conditions on GitHub; green checks alone do not mean ready to merge.',
    unknownNext: 'Open the PR and Checks tab to confirm the missing or ambiguous information.',
  },
  ko: {
    title: 'PR Next Action', observed: '확인 시각', empty: '이 스냅샷에 공개 PR이 없습니다.',
    labels: {attention:'확인 필요', waiting:'대기', done:'완료', unknown:'판단 불가'},
    scope: '공개 PR 스냅샷이며 HEAD 검사와 리뷰 기록만 확인합니다.',
    limits: '병합 가능 판정이 아닙니다. 필수 검사·브랜치 보호·테스트 병합 커밋 검사·대화 해결 여부는 확인하지 않습니다.',
    sample: '검색 범위에는 상한이 있으며 병합 목록은 조회된 표본 안에서 병합일순입니다.',
    partial: '일부 상세 정보가 없거나 잘렸습니다. 확인된 신호만 표시하며 전체 상태를 확정하지 않습니다.',
    merged: 'GitHub에서 병합 완료로 확인됩니다.', closed: 'GitHub에서 병합 없이 닫힌 것으로 확인됩니다.',
    failed: n => `HEAD 검사 ${n}건의 실패 또는 시간 초과가 확인됩니다.`,
    changes: n => `수정 요청 리뷰 기록 ${n}건이 확인됩니다.`,
    attention: n => `HEAD 검사 ${n}건이 취소·오래된 실행·조치 필요 상태입니다.`,
    draft: '아직 초안 PR입니다.',
    pending: n => `HEAD 검사 ${n}건이 대기 또는 실행 중입니다.`,
    missing: '검사 또는 리뷰 정보가 불완전하거나 조회되지 않았습니다.',
    none: '공개 HEAD 검사가 없습니다. 검사가 통과했다는 뜻은 아닙니다.',
    other: n => `중립·생략·기타 HEAD 결과 ${n}건은 성공으로 집계하지 않습니다.`,
    clear: '조회된 HEAD 검사는 모두 성공했고 수정 요청 리뷰 기록은 없습니다. 조회된 검사·리뷰에 실패나 수정 요청 신호가 없습니다.',
    fallback: '현재 근거만으로 다음 행동 상태를 판단할 수 없습니다.',
    mergedNext: '열린 PR에서 할 일은 없습니다. 필요하면 연결된 이슈나 릴리스 반영 여부를 확인하세요.',
    closedNext: '종료 이유나 후속 작업이 필요하면 닫힘 관련 대화를 확인하세요.',
    failedNext: '실패 로그와 기존 기준 상태를 비교한 뒤 코드 변경이 필요한지 판단하세요.',
    changesNext: '리뷰 원문을 읽고 요청이 이미 반영됐는지 먼저 확인하세요.',
    attentionNext: '다시 실행하기 전에 실행 상세에서 취소 이유·실행 권한·필요 조치를 확인하세요.',
    draftNext: '리뷰를 요청하기 전에 초안 준비 상태와 남은 작업을 확인하세요.',
    pendingNext: '검사 결과를 기다린 뒤 읽기 전용 스냅샷을 다시 조회하세요.',
    clearNext: '기다리거나 GitHub에서 대화와 필수 조건을 확인하세요. 검사 성공만으로 병합 준비 완료를 뜻하지 않습니다.',
    unknownNext: 'PR 원문과 Checks 탭에서 누락되거나 모호한 정보를 확인하세요.',
  },
};

function positive(value) { return Number.isSafeInteger(value) && value > 0; }
function completeChecks(checks) {
  const keys = ['total','failed','attention','pending','success','other'];
  return checks && keys.every(key => Number.isSafeInteger(checks[key]) && checks[key] >= 0)
    && checks.total === checks.failed + checks.attention + checks.pending + checks.success + checks.other;
}
function classify(pr, t) {
  const c = pr.checks || {}, r = pr.review || {};
  const missing = !!(pr.partial || pr.checksUnknown || pr.reviewUnknown)
    || !completeChecks(c) || !['approvals','current','changes'].every(k => Number.isSafeInteger(r[k]) && r[k] >= 0);
  const base = {repo:oneLine(pr.repo), number:pr.number, title:oneLine(pr.title), url:oneLine(pr.url),
    state:pr.merged === true ? 'merged' : pr.closed === true ? 'closed' : pr.draft === true ? 'draft' : 'open',
    sha:oneLine(pr.sha), category:'unknown', reasons:[], nextStep:t.unknownNext, caveats:missing ? [t.partial] : []};
  const reason = (code, message) => base.reasons.push({code, message});
  if (pr.merged === true) {
    base.category='done'; reason('merged',t.merged); base.nextStep=t.mergedNext; return base;
  }
  if (pr.closed === true) {
    base.category='done'; reason('closed_without_merge',t.closed); base.nextStep=t.closedNext; return base;
  }
  // Confirmed signals stay actionable even when another endpoint failed.
  if (positive(c.failed)) reason('checks_failed',t.failed(c.failed));
  if (positive(r.changes)) reason('changes_requested',t.changes(r.changes));
  if (positive(c.attention)) reason('checks_need_attention',t.attention(c.attention));
  if (pr.draft === true) reason('draft',t.draft);
  if (base.reasons.length) {
    base.category='attention';
    base.nextStep=positive(c.failed) ? t.failedNext : positive(r.changes) ? t.changesNext : positive(c.attention) ? t.attentionNext : t.draftNext;
    return base;
  }
  if (missing) { reason('incomplete_data',t.missing); return base; }
  if (positive(c.pending)) {
    base.category='waiting'; reason('checks_pending',t.pending(c.pending)); base.nextStep=t.pendingNext; return base;
  }
  if (!c.total) { reason('no_public_checks',t.none); return base; }
  if (positive(c.other)) { reason('non_success_results',t.other(c.other)); return base; }
  if (c.total === c.success) {
    base.category='waiting'; reason('no_public_blocker_observed',t.clear); base.nextStep=t.clearNext; return base;
  }
  reason('insufficient_evidence',t.fallback); return base;
}

/** Analyze the verified, public-only collect() result. No network calls or side effects. */
export function analyze(data, {language='en'} = {}) {
  const t=copy[language]; if (!t) throw new Error('Language must be en or ko.');
  if (!data || !Array.isArray(data.open) || !Array.isArray(data.merged)) throw new Error('Expected a collected PR snapshot.');
  // A PR can move from open to merged between the two searches. A verified terminal state wins.
  const unique=new Map();
  const rank=p => p.merged === true ? 2 : p.closed === true ? 1 : 0;
  for (const pr of [...data.open,...data.merged]) {
    const key=`${String(pr.repo).toLowerCase()}#${pr.number}`, old=unique.get(key);
    if (!old || rank(pr)>rank(old)) unique.set(key,pr);
  }
  const items=[...unique.values()].map(pr=>classify(pr,t));
  const summary=Object.fromEntries(CATEGORIES.map(category=>[category,items.filter(p=>p.category===category).length]));
  return {formatVersion:1,language,username:oneLine(data.username),observedAt:oneLine(data.observedAt),includeOwn:!!data.includeOwn,
    summary,items,sample:{open:{shown:data.open.length,total:Number.isSafeInteger(data.totals?.open)?data.totals.open:null},merged:{shown:data.merged.length,total:Number.isSafeInteger(data.totals?.merged)?data.totals.merged:null}},scope:t.scope,limitations:[t.limits,t.sample],truncated:{...data.truncated}};
}

function oneLine(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/g,' ');
}
/** Plain terminal output. color is accepted for CLI compatibility; ANSI is never emitted. */
export function renderText(report, {color=false} = {}) {
  void color;
  const t=copy[report.language || 'en']; if (!t) throw new Error('Language must be en or ko.');
  const lines=[`${t.title} · @${oneLine(report.username)}`,`${t.observed}: ${oneLine(report.observedAt)}`,
    CATEGORIES.map(k=>`${t.labels[k]} ${report.summary[k]}`).join(' · '),''];
  if(report.sample){const x=report.sample;lines.splice(2,0,report.language==='ko'?`조회 표본: 열린 PR ${x.open.shown}/${x.open.total??'?'} · 병합 PR ${x.merged.shown}/${x.merged.total??'?'}`:`Sample: open ${x.open.shown}/${x.open.total??'?'} · merged ${x.merged.shown}/${x.merged.total??'?'}`);}
  if (!report.items.length) lines.push(t.empty,'');
  for (const category of CATEGORIES) {
    const items=report.items.filter(p=>p.category===category); if (!items.length) continue;
    lines.push(`${t.labels[category]} (${items.length})`);
    for (const p of items) {
      lines.push(`  ${oneLine(p.repo)}#${p.number} — ${oneLine(p.title)}`,`  ${oneLine(p.url)}`);
      for (const r of p.reasons) lines.push(`  • ${oneLine(r.message)}`);
      lines.push(`  → ${oneLine(p.nextStep)}`);
      for (const caveat of p.caveats) lines.push(`  ! ${oneLine(caveat)}`);
      lines.push('');
    }
  }
  lines.push(oneLine(report.scope),...report.limitations.map(oneLine));
  return lines.join('\n');
}
