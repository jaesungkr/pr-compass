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
    throw new Error('Public repository visibility could not be verified; report aborted.');
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
    if (result.data.incomplete_results) throw new Error('GitHub search was incomplete; report aborted.');
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
