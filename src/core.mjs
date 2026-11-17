export const START = '<!-- PR-COMPASS:START -->';
export const END = '<!-- PR-COMPASS:END -->';
const USER = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;
export function validateUsername(value) {
  if (!USER.test(value || '') || value.includes('--')) throw new Error('Invalid GitHub username.');
  return value;
}
export function validateLimit(value = 5) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 20) throw new Error('Limit must be an integer from 1 to 20.');
  return n;
}
export function validateIncludeOwn(value = false) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error('include-own must be true or false.');
}
export function escapeMarkdown(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/&/g, '&amp;').replace(/[<>@|]/g, c => ({'<':'&lt;','>':'&gt;','@':'&#64;','|':'&#124;'}[c]))
    .replace(/[\\`*_{}\[\]()!#]/g, '\\$&');
}
export function replaceBlock(source, content) {
  const starts = source.split(START).length - 1, ends = source.split(END).length - 1;
  const nl = source.includes('\r\n') ? '\r\n' : '\n';
  const body = content.replace(/\r?\n/g, nl);
  if (starts !== 1 || ends !== 1 || source.indexOf(START) > source.indexOf(END)) throw new Error('README needs exactly one ordered PR-COMPASS marker pair.');
  return source.slice(0, source.indexOf(START) + START.length) + nl + body + nl + source.slice(source.indexOf(END));
}
export function summarizeReviews(reviews, sha) {
  const latest = new Map();
  for (const r of [...reviews].sort((a,b) => String(a.submitted_at || '').localeCompare(String(b.submitted_at || '')) || (a.id || 0) - (b.id || 0))) {
    if (['APPROVED','CHANGES_REQUESTED','DISMISSED'].includes(r.state)) latest.set(r.user?.login || r.id, r);
  }
  const active = [...latest.values()];
  return { approvals: active.filter(r => r.state === 'APPROVED').length,
    current: active.filter(r => r.state === 'APPROVED' && r.commit_id === sha).length,
    changes: active.filter(r => r.state === 'CHANGES_REQUESTED').length };
}
export function summarizeChecks(runs, statuses) {
  const states = [...runs.map(r => r.status === 'completed' ? r.conclusion : 'pending'), ...statuses.map(s => s.state)];
  const result = { total: states.length, success: 0, failed: 0, pending: 0, attention: 0, other: 0 };
  for (const state of states) {
    if (state === 'success') result.success++;
    else if (['failure','error','timed_out'].includes(state)) result.failed++;
    else if (['pending','queued','in_progress','waiting','requested','expected'].includes(state)) result.pending++;
    else if (['action_required','cancelled','stale','startup_failure'].includes(state)) result.attention++;
    else result.other++;
  }
  return result;
}
export class GitHubClient {
  constructor({ token = '', fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
    this.token = token; this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs; this.blocked = false;
  }
  async get(path) {
    if (this.blocked) throw new Error('GitHub rate limit reached; further requests stopped.');
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid API path.');
    let response;
    try {
      response = await this.fetchImpl('https://api.github.com' + path, {redirect:'error', signal:AbortSignal.timeout(this.timeoutMs), headers:{
        Accept:'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28', 'User-Agent':'pr-compass',
        ...(this.token ? {Authorization:`Bearer ${this.token}`} : {})
      }});
    } catch { throw new Error('GitHub network request failed or timed out.'); }
    if (!response.ok) {
      if (response.status === 429 || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.get('retry-after')))) {
        this.blocked = true;
        throw new Error('GitHub rate limit reached; try a later scheduled run.');
      }
      throw new Error(`GitHub API returned HTTP ${response.status}.`);
    }
    let data;
    try { data = await response.json(); } catch { throw new Error('GitHub returned an invalid JSON response.'); }
    return {data, partial:(response.headers.get('link') || '').includes('rel="next"')};
  }
}
function itemIdentity(item) {
  const match = /^https:\/\/api\.github\.com\/repos\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/.exec(item.repository_url || '');
  if (!match || !Number.isSafeInteger(item.number) || item.number < 1 || !item.pull_request) throw new Error('Unexpected GitHub PR search result.');
  return {repo:match[1] + '/' + match[2], number:item.number};
}
async function detail(client, item, username, includeOwn) {
  const {repo, number} = itemIdentity(item), base = '/repos/' + repo;
  const {data:p} = await client.get(`${base}/pulls/${number}`);
  // A token may see private repositories. Do not render any content unless public visibility is confirmed.
  if (p.base?.repo?.private !== false || p.base.repo.full_name?.toLowerCase() !== repo.toLowerCase() || p.number !== number)
    throw new Error('Public repository visibility could not be verified; README unchanged.');
  if (!includeOwn && p.base.repo.full_name.split('/')[0].toLowerCase() === username.toLowerCase()) return null;
  if (!/^[a-f0-9]{40,64}$/i.test(p.head?.sha || '')) throw new Error('Invalid PR head SHA.');
  const results = [];
  for (const path of [`${base}/pulls/${number}/reviews?per_page=100`, `${base}/commits/${p.head.sha}/check-runs?per_page=100&filter=latest`, `${base}/commits/${p.head.sha}/status?per_page=100`]) {
    try { results.push(await client.get(path)); } catch { results.push({error:true}); }
  }
  const [reviews, checks, status] = results;
  const reviewValid = Array.isArray(reviews.data), checksValid = Array.isArray(checks.data?.check_runs), statusValid = Array.isArray(status.data?.statuses);
  return {repo, number, title:p.title, url:`https://github.com/${repo}/pull/${number}`, draft:p.draft, merged:!!p.merged, closed:p.state === 'closed', mergedAt:p.merged_at,
    sha:p.head.sha, review: summarizeReviews(reviewValid ? reviews.data : [], p.head.sha),
    checks:summarizeChecks(checksValid ? checks.data.check_runs : [], statusValid ? status.data.statuses : []),
    reviewUnknown:!reviewValid, checksUnknown:!checksValid || !statusValid,
    partial:results.some(r => r.error || r.partial) || !reviewValid || !checksValid || !statusValid || checks.data?.total_count > checks.data?.check_runs?.length || status.data?.total_count > status.data?.statuses?.length};
}
export async function collect({username, limit = 5, includeOwn = false, client = new GitHubClient(), now = new Date()} = {}) {
  validateUsername(username); limit = validateLimit(limit); includeOwn = validateIncludeOwn(includeOwn);
  const lists = {};
  // Fetch both lists first. Any search failure aborts rather than replacing good data with false zeroes.
  for (const kind of ['open','merged']) {
    const q = encodeURIComponent(`author:${username} is:pr is:public is:${kind}${includeOwn ? '' : ` -user:${username}`}`);
    const result = await client.get(`/search/issues?q=${q}&per_page=100&sort=updated&order=desc`);
    if (!Array.isArray(result.data?.items) || !Number.isInteger(result.data.total_count)) throw new Error('Invalid GitHub search response.');
    if (result.data.incomplete_results) throw new Error('GitHub search was incomplete; README unchanged.');
    const items = result.data.items.filter(item => includeOwn || itemIdentity(item).repo.split('/')[0].toLowerCase() !== username.toLowerCase());
    const excluded = result.data.items.length - items.length;
    lists[kind] = {items, total:Math.max(0,result.data.total_count - excluded), truncated:result.partial || result.data.total_count > result.data.items.length};
  }
  lists.merged.items.sort((a,b) => new Date(b.pull_request?.merged_at || 0) - new Date(a.pull_request?.merged_at || 0));
  const result = {username, includeOwn, observedAt:new Date(now).toISOString(), open:[], merged:[], totals:{open:lists.open.total, merged:lists.merged.total}, truncated:{open:lists.open.truncated, merged:lists.merged.truncated}};
  for (const kind of ['open','merged']) for (const item of lists[kind].items.slice(0,limit)) {
    const entry = await detail(client,item,username,includeOwn);
    if (entry) result[kind].push(entry);
  }
  return result;
}
const texts = {
  en:{heading:'Contribution activity',allHeading:'Public pull requests',external:'External repositories only',allScope:'All public repositories',showing:(shown,total)=>`Showing ${shown} of ${total}`,details:'PR links & status details',method:'About this snapshot',open:'Open',merged:'Recently merged',empty:'No public PRs found.',columns:'Contribution | Status | Checks · review',draft:'Draft',closed:'Closed',mergedState:'Merged',openState:'Open',unknown:'Unavailable',partial:'Partial data',none:'No public HEAD checks',success:'success',failed:'failed',pending:'pending',attention:'cancelled / action needed',other:'neutral / skipped / other',noReviews:'No active decision reviews',approved:'approved',current:'on current HEAD',changes:'changes requested',at:'Observed',scope:'Public PRs only. HEAD checks and review records are not a merge-readiness verdict. Required checks, branch protection, test-merge checks, and resolved conversations are not evaluated.',cap:'Lists are sampled from up to 100 most recently updated matches; merged items are sorted by merge date within that sample.',count:'search matches'},
  ko:{heading:'최근 기여 현황',allHeading:'공개 Pull Request',external:'외부 저장소 기여만 표시',allScope:'모든 공개 저장소',showing:(shown,total)=>`${total}건 중 ${shown}건 표시`,details:'PR 링크와 상세 상태',method:'조회 범위와 상태 안내',open:'진행 중',merged:'최근 병합',empty:'조회된 공개 PR이 없습니다.',columns:'기여 | 상태 | 검사 · 리뷰',draft:'초안',closed:'닫힘',mergedState:'병합',openState:'진행 중',unknown:'조회 불가',partial:'일부 정보',none:'공개 HEAD 검사 없음',success:'성공',failed:'실패',pending:'진행',attention:'취소·조치 필요',other:'중립·생략·기타',noReviews:'유효한 결정 리뷰 없음',approved:'승인',current:'현재 HEAD',changes:'수정 요청',at:'확인',scope:'공개 PR만 표시합니다. HEAD 검사와 리뷰 기록은 병합 가능 판정이 아닙니다. 필수 검사·브랜치 보호·테스트 병합 커밋 검사·대화 해결 여부는 확인하지 않습니다.',cap:'최근 업데이트순 최대 100건에서 조회하며, 병합 목록은 그 결과 안에서 병합일순입니다.',count:'검색 결과'}
};
export function renderMarkdown(data, {language='en', visual} = {}) {
  const t = texts[language]; if (!t) throw new Error('Language must be en or ko.');
  const lines = [`### ${data.includeOwn ? t.allHeading : t.heading}`, '', `**${t.merged} ${data.totals.merged} · ${t.open} ${data.totals.open}**`, '', `<sub>${data.includeOwn ? t.allScope : t.external} · ${t.at}: ${data.observedAt.replace('T',' ').replace(/\.\d{3}Z$/,' UTC')}</sub>`, ''];
  if (visual) {
    const directory = visual.directory;
    if (typeof directory !== 'string' || !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(directory) || directory.split('/').some(p => p === '.' || p === '..')) throw new Error('Invalid visual directory.');
    const version = encodeURIComponent(data.observedAt);
    const asset = name => `${directory}/${name}.svg?v=${version}`;
    const alt = `${t.merged}: ${data.totals.merged}; ${t.open}: ${data.totals.open}. ${data.includeOwn ? t.allScope : t.external}.`;
    // GitHub rewrites prefers-color-scheme source media, dropping compound width conditions.
    // Theme fragments hide one image; each independent picture keeps its width-only source.
    lines.splice(0, lines.length);
    for (const theme of ['light','dark']) lines.push(`<a href="${asset('overview-'+theme)}#gh-${theme}-mode-only">`, '<picture>', `  <source media="(max-width: 600px)" srcset="${asset('overview-mobile-'+theme)}#gh-${theme}-mode-only">`, `  <img src="${asset('overview-'+theme)}#gh-${theme}-mode-only" alt="${alt}" width="920">`, '</picture>', '</a>');
    lines.push('');
    if (data.merged.length) lines.push(`**${t.merged}:** ` + data.merged.slice(0,3).map(p => `[${escapeMarkdown(p.repo)} #${p.number}](${p.url})`).join(' · '), '');
    lines.push('<details>', `<summary>${t.details}</summary>`, '', `> ${t.at}: ${data.observedAt.replace('T',' ').replace(/\.\d{3}Z$/,' UTC')}`, '');
  }
  for (const kind of ['merged','open']) {
    lines.push(`#### ${t[kind]}`, ``, `<sub>${t.showing(data[kind].length,data.totals[kind])}</sub>`, '');
    if (!data[kind].length) {lines.push(t.empty,''); continue;}
    lines.push(`| ${t.columns} |`,'| --- | --- | --- |');
    for (const p of data[kind]) {
      const state = p.merged ? t.mergedState : p.closed ? t.closed : p.draft ? t.draft : t.openState;
      const c = p.checks, r = p.review;
      const ci = p.checksUnknown ? t.unknown : !c.total ? t.none : [['success',t.success],['failed',t.failed],['pending',t.pending],['attention',t.attention],['other',t.other]].filter(([key]) => c[key]).map(([key,label]) => `${c[key]} ${label}`).join('; ');
      const review = p.reviewUnknown ? t.unknown : !r.approvals && !r.changes ? t.noReviews : [r.approvals ? `${r.approvals} ${t.approved} (${r.current} ${t.current})` : '', r.changes ? `${r.changes} ${t.changes}` : ''].filter(Boolean).join('; ');
      lines.push(`| [**${escapeMarkdown(p.repo)}#${p.number}**](${p.url})<br>${escapeMarkdown(p.title)} | **${state}**<br>[\`${p.sha.slice(0,7)}\`](https://github.com/${p.repo}/commit/${p.sha})${p.partial ? `<br>⚠ ${t.partial}` : ''} | ${ci}<br><sub>${review}</sub> |`);
    }
    lines.push('');
  }
  lines.push('<details>', `<summary>${t.method}</summary>`, '', `${t.scope} ${t.cap}`, '', '</details>');
  if (visual) lines.push('', '</details>');
  return lines.join('\n');
}
