#!/usr/bin/env node
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {collect,GitHubClient,validateUsername,validateLimit} from './core.mjs';
import {analyze,renderText} from './next-action.mjs';

export function parseArgs(args,env={}) {
  const o={username:env.PR_COMPASS_USERNAME||'',limit:env.PR_COMPASS_LIMIT||5,language:env.PR_COMPASS_LANGUAGE||'en',json:false,help:false,color:'auto',width:null};
  let suppliedUser=false;
  for(let i=0;i<args.length;i++){
    const a=args[i];
    if(a==='--help'||a==='-h'){o.help=true;continue;}
    if(a==='--json'){o.json=true;continue;}
    if(['--username','--limit','--language','--color','--width'].includes(a)){
      if(!args[i+1]||args[i+1].startsWith('--'))throw new Error('Missing value for '+a+'.');
      if(a==='--username'){if(suppliedUser)throw new Error('Specify username only once.');suppliedUser=true;}
      o[a.slice(2)]=args[++i];continue;
    }
    if(!a.startsWith('-')&&!suppliedUser){o.username=a;suppliedUser=true;continue;}
    throw new Error('Unknown or duplicate argument. Use --help for supported options.');
  }
  if(!o.help){validateUsername(o.username);o.limit=validateLimit(o.limit);if(!['en','ko'].includes(o.language))throw new Error('Language must be en or ko.');}
  if(!['auto','always','never'].includes(o.color))throw new Error('Color must be auto, always, or never.');
  if(o.width!==null){if(!/^\d+$/.test(o.width)||Number(o.width)<20||Number(o.width)>240)throw new Error('Width must be 20..240.');o.width=Number(o.width);}
  return o;
}
export const HELP=`PR Compass — what should I look at next?
Usage: node src/cli.mjs USER [--language en|ko] [--limit 1..20] [--json]
       [--color auto|always|never] [--width 20..240]

Public external PRs only. Read-only: no files or GitHub state are changed.
Default: up to 5 open and 5 recently merged PRs from a bounded search sample.
Auto color uses a capable TTY only. NO_COLOR or TERM=dumb disables color.
Width follows the terminal (80 in pipes); links remain whole for copying.
GITHUB_TOKEN is optional and read only from the environment.
--json prints one machine-readable report. Exit 0 means the lookup succeeded,
not that checks passed or a PR is ready to merge.`;
export async function main(args=process.argv.slice(2),env=process.env,{client,now,write=s=>process.stdout.write(s),isTTY=!!process.stdout.isTTY,columns=process.stdout.columns}={}){
  const o=parseArgs(args,env);
  if(o.help){write(HELP+'\n');return;}
  const data=await collect({username:o.username,limit:o.limit,includeOwn:false,client:client||new GitHubClient({token:env.GITHUB_TOKEN||''}),...(now?{now}:{})});
  const report=analyze(data,{language:o.language});
  write((o.json?JSON.stringify(report,null,2):renderText(report,{color:!(Object.hasOwn(env,'NO_COLOR')||env.TERM==='dumb')&&(o.color==='always'||(o.color==='auto'&&isTTY)),width:o.width??(isTTY&&Number.isInteger(columns)&&columns>0?Math.max(20,Math.min(240,columns)):80)}))+'\n');
  return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{console.error('PR Compass: '+error.message);process.exitCode=1;});
