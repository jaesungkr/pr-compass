#!/usr/bin/env node
import { readFile, writeFile, rename, unlink, stat, lstat, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { renderStreamAssets } from './stream.mjs';
import { collect, GitHubClient, renderMarkdown, replaceBlock, validateUsername, validateLimit, validateIncludeOwn } from './core.mjs';

export function validateAssetsDir(value = 'assets/pr-compass') {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\') || value.split('/').some(part=>!part || part==='.' || part==='..' || part==='.git' || !/^[a-zA-Z0-9._-]+$/.test(part))) throw new Error('assets-dir must be a safe relative directory without traversal.');
  return value;
}
async function assertSafeAssets(base, relative) {
  let current=base;
  for (const part of relative.split('/')) {
    current=join(current,part);
    try { const info=await lstat(current);if(info.isSymbolicLink() || !info.isDirectory()) throw new Error('Asset directories must not contain symlinks or non-directories.'); }
    catch(error) { if(error.code!=='ENOENT') throw error; }
  }
  for(const name of ['stream-light.svg','stream-dark.svg']) {
    try { const info=await lstat(join(current,name));if(info.isSymbolicLink() || !info.isFile()) throw new Error('Asset files must be regular files, not symlinks.'); }
    catch(error) { if(error.code!=='ENOENT') throw error; }
  }
  return current;
}
async function atomicWrite(path,content,mode) {
  const temp=join(dirname(path),`.pr-compass-${randomUUID()}.tmp`);
  try {await writeFile(temp,content,{flag:'wx',mode});await rename(temp,path);} finally {await unlink(temp).catch(()=>{});}
}
export function parseArgs(args, env = process.env) {
  const options = {stream:env.PR_COMPASS_STREAM ?? env.INPUT_STREAM ?? 'true', assetsDir:env.PR_COMPASS_ASSETS_DIR || env.INPUT_ASSETS_DIR || 'assets/pr-compass', username:env.PR_COMPASS_USERNAME || env.INPUT_USERNAME || '', readme:env.PR_COMPASS_README || env.INPUT_README || 'README.md', limit:env.PR_COMPASS_LIMIT || env.INPUT_LIMIT || '5', language:env.PR_COMPASS_LANGUAGE || env.INPUT_LANGUAGE || 'en', includeOwn:env.PR_COMPASS_INCLUDE_OWN ?? env.INPUT_INCLUDE_OWN ?? 'false'};
  for (let i=0;i<args.length;i++) {
    const arg=args[i];
    if (arg === '--help' || arg === '-h') options.help=true;
    else if (arg === '--no-stream') options.stream = false;
    else if (arg === '--include-own') options.includeOwn = true;
    else if (['--username','--readme','--limit','--language','--assets-dir'].includes(arg)) {
      if (!args[i+1] || args[i+1].startsWith('--')) throw new Error(`Missing value for ${arg}.`);
      options[arg==='--assets-dir'?'assetsDir':arg.slice(2)]=args[++i];
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.help) {
    if (![true,false,'true','false'].includes(options.stream)) throw new Error('stream must be true or false.');
    options.stream=options.stream===true || options.stream==='true';options.assetsDir=validateAssetsDir(options.assetsDir);validateUsername(options.username); options.limit=validateLimit(options.limit); options.includeOwn=validateIncludeOwn(options.includeOwn);
    if (!['en','ko'].includes(options.language)) throw new Error('Language must be en or ko.');
  }
  return options;
}
export async function main(args = process.argv.slice(2), env = process.env, { client, now } = {}) {
  const options=parseArgs(args,env);
  if (options.help) {console.log('Usage: node src/cli.mjs --username USER [--readme README.md] [--limit 5] [--language en|ko] [--include-own] [--assets-dir assets/pr-compass] [--no-stream]\nGITHUB_TOKEN is optional. Only the marked README block and two generated animation assets (unless --no-stream) are updated.');return;}
  const path=resolve(options.readme), original=await readFile(path), source=original.toString('utf8');
  if (!Buffer.from(source,'utf8').equals(original)) throw new Error('README must be valid UTF-8.');
  if ((await lstat(path)).isSymbolicLink()) throw new Error('README must not be a symlink.');
  if(options.stream)await assertSafeAssets(dirname(path),options.assetsDir);
  // Validate markers before making any API requests.
  replaceBlock(source,'');
  const data=await collect({username:options.username,limit:options.limit,includeOwn:options.includeOwn,client:client || new GitHubClient({token:env.GITHUB_TOKEN || ''}), ...(now ? {now} : {})});
  const assets=options.stream?renderStreamAssets(data,{language:options.language}):{};
  const updated=replaceBlock(source,renderMarkdown(data,{language:options.language,stream:options.stream?{directory:options.assetsDir}:undefined}));
  if (!(await readFile(path)).equals(original)) throw new Error('README changed during collection; refusing to overwrite concurrent edits.');
  const assetsPath=options.stream?await assertSafeAssets(dirname(path),options.assetsDir):undefined;
  if(options.stream){await mkdir(assetsPath,{recursive:true});await assertSafeAssets(dirname(path),options.assetsDir);}
  const backups=new Map(),written=[];
  try {
    for(const [name,svg] of Object.entries(assets)) {
      const file=join(assetsPath,name);
      let previous=null;try {previous=await readFile(file);}catch(error){if(error.code!=='ENOENT')throw error;}
      backups.set(file,previous);
      if(previous?.equals(Buffer.from(svg)))continue;
      await atomicWrite(file,svg,0o644);written.push(file);
    }
    if (!(await readFile(path)).equals(original)) throw new Error('README changed during collection; refusing to overwrite concurrent edits.');
    if(updated!==source)await atomicWrite(path,updated,(await stat(path)).mode);
  } catch(error) {
    for(const file of written.reverse()) {
      const previous=backups.get(file);
      if(previous===null)await unlink(file).catch(()=>{});else await atomicWrite(file,previous,0o644);
    }
    throw error;
  }
  console.log(`PR Compass: updated ${data.open.length} open and ${data.merged.length} merged public PRs.`);
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) main().catch(error=>{console.error(`PR Compass: ${error.message}`);process.exitCode=1;});
