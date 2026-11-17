#!/usr/bin/env node
import { readFile, writeFile, rename, unlink, stat } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { collect, GitHubClient, renderMarkdown, replaceBlock, validateUsername, validateLimit } from './core.mjs';

export function parseArgs(args, env = process.env) {
  const options = {username:env.PR_COMPASS_USERNAME || env.INPUT_USERNAME || '', readme:env.PR_COMPASS_README || env.INPUT_README || 'README.md', limit:env.PR_COMPASS_LIMIT || env.INPUT_LIMIT || '5', language:env.PR_COMPASS_LANGUAGE || env.INPUT_LANGUAGE || 'en'};
  for (let i=0;i<args.length;i++) {
    const arg=args[i];
    if (arg === '--help' || arg === '-h') options.help=true;
    else if (['--username','--readme','--limit','--language'].includes(arg)) {
      if (!args[i+1] || args[i+1].startsWith('--')) throw new Error(`Missing value for ${arg}.`);
      options[arg.slice(2)]=args[++i];
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.help) {
    validateUsername(options.username); options.limit=validateLimit(options.limit);
    if (!['en','ko'].includes(options.language)) throw new Error('Language must be en or ko.');
  }
  return options;
}
export async function main(args = process.argv.slice(2), env = process.env, { client, now } = {}) {
  const options=parseArgs(args,env);
  if (options.help) {console.log('Usage: node src/cli.mjs --username USER [--readme README.md] [--limit 5] [--language en|ko]\nGITHUB_TOKEN is optional. Only the marked README block is updated.');return;}
  const path=resolve(options.readme), original=await readFile(path), source=original.toString('utf8');
  if (!Buffer.from(source,'utf8').equals(original)) throw new Error('README must be valid UTF-8.');
  // Validate markers before making any API requests.
  replaceBlock(source,'');
  const data=await collect({username:options.username,limit:options.limit,client:client || new GitHubClient({token:env.GITHUB_TOKEN || ''}), ...(now ? {now} : {})});
  const updated=replaceBlock(source,renderMarkdown(data,{language:options.language}));
  if (!(await readFile(path)).equals(original)) throw new Error('README changed during collection; refusing to overwrite concurrent edits.');
  if (updated===source) {console.log('PR Compass: no changes.');return;}
  const temp=join(dirname(path),`.pr-compass-${randomUUID()}.tmp`);
  try {await writeFile(temp,updated,{encoding:'utf8',flag:'wx',mode:(await stat(path)).mode});await rename(temp,path);} finally {await unlink(temp).catch(()=>{});}
  console.log(`PR Compass: updated ${data.open.length} open and ${data.merged.length} merged public PRs.`);
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) main().catch(error=>{console.error(`PR Compass: ${error.message}`);process.exitCode=1;});
