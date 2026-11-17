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
async function detail(client, item) {
  const {repo, number} = itemIdentity(item), base = '/repos/' + repo;
  const {data:p} = await client.get(`${base}/pulls/${number}`);
  // A token may see private repositories. Do not render any content unless public visibility is confirmed.
  if (p.base?.repo?.private !== false || p.base.repo.full_name?.toLowerCase() !== repo.toLowerCase() || p.number !== number)
    throw new Error('Public repository visibility could not be verified; README unchanged.');
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
export async function collect({username, limit = 5, client = new GitHubClient(), now = new Date()} = {}) {
  validateUsername(username); limit = validateLimit(limit);
  const lists = {};
  // Fetch both lists first. Any search failure aborts rather than replacing good data with false zeroes.
  for (const kind of ['open','merged']) {
    const q = encodeURIComponent(`author:${username} is:pr is:public is:${kind}`);
    const result = await client.get(`/search/issues?q=${q}&per_page=100&sort=updated&order=desc`);
    if (!Array.isArray(result.data?.items) || !Number.isInteger(result.data.total_count)) throw new Error('Invalid GitHub search response.');
    if (result.data.incomplete_results) throw new Error('GitHub search was incomplete; README unchanged.');
    lists[kind] = {items:result.data.items, total:result.data.total_count, truncated:result.partial || result.data.total_count > result.data.items.length};
  }
  lists.merged.items.sort((a,b) => new Date(b.pull_request?.merged_at || 0) - new Date(a.pull_request?.merged_at || 0));
  const result = {username, observedAt:new Date(now).toISOString(), open:[], merged:[], totals:{open:lists.open.total, merged:lists.merged.total}, truncated:{open:lists.open.truncated, merged:lists.merged.truncated}};
  for (const kind of ['open','merged']) for (const item of lists[kind].items.slice(0,limit)) result[kind].push(await detail(client,item));
  return result;
}
const texts = {
  en:{heading:'Public pull requests',open:'Open',merged:'Recently merged',empty:'No public PRs found.',columns:'Pull request | State | HEAD checks | Review records',draft:'Draft',closed:'Closed',mergedState:'Merged',openState:'Open',unknown:'Unavailable',partial:'Partial data',none:'No public HEAD checks',success:'success',failed:'failed',pending:'pending',attention:'cancelled / action needed',other:'neutral / skipped / other',noReviews:'No active decision reviews',approved:'approved',current:'on current HEAD',changes:'changes requested',at:'Observed',scope:'Public PRs only. HEAD checks and review records are not a merge-readiness verdict. Required checks, branch protection, test-merge checks, and resolved conversations are not evaluated.',cap:'Lists are sampled from up to 100 most recently updated matches; merged items are sorted by merge date within that sample.',count:'search matches'},
  ko:{heading:'공개 Pull Request',open:'진행 중',merged:'최근 병합',empty:'조회된 공개 PR이 없습니다.',columns:'Pull request | 상태 | HEAD 검사 | 리뷰 기록',draft:'초안',closed:'닫힘',mergedState:'병합',openState:'진행 중',unknown:'조회 불가',partial:'일부 정보',none:'공개 HEAD 검사 없음',success:'성공',failed:'실패',pending:'진행',attention:'취소·조치 필요',other:'중립·생략·기타',noReviews:'유효한 결정 리뷰 없음',approved:'승인',current:'현재 HEAD',changes:'수정 요청',at:'확인',scope:'공개 PR만 표시합니다. HEAD 검사와 리뷰 기록은 병합 가능 판정이 아닙니다. 필수 검사·브랜치 보호·테스트 병합 커밋 검사·대화 해결 여부는 확인하지 않습니다.',cap:'최근 업데이트순 최대 100건에서 조회하며, 병합 목록은 그 결과 안에서 병합일순입니다.',count:'검색 결과'}
};
export function renderMarkdown(data, {language='en'} = {}) {
  const t = texts[language]; if (!t) throw new Error('Language must be en or ko.');
  const lines = [`### ${t.heading}`, '', `> ${t.at}: ${data.observedAt.replace('T',' ').replace(/\.\d{3}Z$/,' UTC')}`, ''];
  for (const kind of ['open','merged']) {
    lines.push(`#### ${t[kind]} · ${data.totals[kind]} ${t.count}`, '');
    if (!data[kind].length) {lines.push(t.empty,''); continue;}
    lines.push(`| ${t.columns} |`,'| --- | --- | --- | --- |');
    for (const p of data[kind]) {
      const state = p.merged ? t.mergedState : p.closed ? t.closed : p.draft ? t.draft : t.openState;
      const c = p.checks, r = p.review;
      const ci = p.checksUnknown ? t.unknown : !c.total ? t.none : [['success',t.success],['failed',t.failed],['pending',t.pending],['attention',t.attention],['other',t.other]].filter(([key]) => c[key]).map(([key,label]) => `${c[key]} ${label}`).join('; ');
      const review = p.reviewUnknown ? t.unknown : !r.approvals && !r.changes ? t.noReviews : `${r.approvals} ${t.approved} (${r.current} ${t.current}); ${r.changes} ${t.changes}`;
      lines.push(`| [${escapeMarkdown(p.repo)}#${p.number}: ${escapeMarkdown(p.title)}](${p.url}) | ${state}${p.partial ? ` · ${t.partial}` : ''} | [\`${p.sha.slice(0,7)}\`](https://github.com/${p.repo}/commit/${p.sha})<br>${ci} | ${review} |`);
    }
    lines.push('');
  }
  lines.push(`<sub>${t.scope} ${t.cap}</sub>`);
  return lines.join('\n');
}
