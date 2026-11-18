import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { linkSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { targetOf } from './workflow.mjs'

export const imageOrigins = ['https://github.com','https://user-images.githubusercontent.com','https://private-user-images.githubusercontent.com','https://raw.githubusercontent.com','https://camo.githubusercontent.com','https://github-production-user-asset-6210df.s3.amazonaws.com']
export function screenshots(body, headRepo, sha) {
  const images = new Map()
  const prose = body.replace(/<!--[^]*?-->|^`{3,}[^]*?^`{3,}[^\n]*|^~{3,}[^]*?^~{3,}[^\n]*|`[^`\n]+`/gm,'')
  const refs = new Map([...prose.matchAll(/^\s{0,3}\[([^\]]+)\]:\s*<?([^\s>]+)>?/gm)].map(m=>[m[1].toLowerCase(),m[2]]))
  function add(src, alt) {
    if (!src) return
    src = src.replace(/&amp;/gi,'&')
    if (!/^[a-z][a-z\d+.-]*:/i.test(src) && !src.startsWith('//')) {
      if (!headRepo) return
      src = 'https://raw.githubusercontent.com/' + headRepo + '/' + sha + '/' + src.replace(/^\.?\//,'')
    }
    let url
    try { url = new URL(src) } catch { return }
    if (url.protocol !== 'https:' || url.username || url.password) return
    if (url.hostname === 'github.com' && /^\/[^/]+\/[^/]+\/blob\//.test(url.pathname)) {
      url.hostname = 'raw.githubusercontent.com'
      url.pathname = url.pathname.replace('/blob/','/')
    }
    const trusted = imageOrigins.includes(url.origin) && (url.hostname !== 'github.com' || url.pathname.startsWith('/user-attachments/assets/'))
    if (!images.has(url.href)) images.set(url.href,{url:url.href, alt:alt?.trim() || 'PR screenshot', inline:trusted})
  }
  const pattern = /!\[([^\]\n]*)\]\((?:<([^>]+)>|([^\s)]+(?:\([^()\s]*\)[^\s)]*)?))(?:\s+["'][^\n]*?["'])?\)|!\[([^\]\n]*)\]\[([^\]\n]*)\]|<img\b[^>]*>|https:\/\/github\.com\/user-attachments\/assets\/[\da-f-]{36}\b/gi
  for (const match of prose.matchAll(pattern)) {
    if (match[0].startsWith('<')) {
      const attrs = Object.fromEntries([...match[0].matchAll(/\s(src|alt)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)].map(m=>[m[1].toLowerCase(),m[2] ?? m[3] ?? m[4]]))
      add(attrs.src,attrs.alt)
    } else if (match[1] !== undefined) add(match[2] ?? match[3],match[1])
    else if (match[4] !== undefined) add(refs.get((match[5] || match[4]).toLowerCase()),match[4])
    else add(match[0])
  }
  return [...images.values()]
}

// Immutable snapshots let two Codex processes race safely to publish the next revision.
const folder = id => join(process.env.PLUGIN_DATA || join(process.env.XDG_DATA_HOME || join(homedir(),'.local','share'),'review-desk'), 'reviews', id)
function save(state) {
  const dir = folder(state.id)
  mkdirSync(dir,{recursive:true,mode:0o700})
  const tmp = join(dir,randomUUID()+'.tmp')
  writeFileSync(tmp,JSON.stringify(state),{flag:'wx',mode:0o600})
  try { linkSync(tmp,join(dir,state.revision+'.json')) }
  catch (e) { if (e.code === 'EEXIST') throw Error('Another view already changed this review. Resume it to see the latest decision.'); throw e }
  finally { unlinkSync(tmp) }
  return state
}
function read(id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('Invalid review ID.')
  const dir = folder(id)
  const versions = readdirSync(dir).filter(s=>/^\d+\.json$/.test(s)).map(s=>parseInt(s,10))
  return JSON.parse(readFileSync(join(dir,Math.max(...versions)+'.json'),'utf8'))
}
export function open({url,title,body,head,base,headRepository,goal,approach}) {
  const pr = targetOf(url)
  if (headRepository) targetOf(headRepository+'#1')
  return save({id:randomUUID(),revision:0,pr:{...pr,title,head,base,goal,approach,images:screenshots(body,headRepository,head)},findings:null,log:[],pending:null})
}
export function view(s) {
  const list = s.findings || []
  return {id:s.id,revision:s.revision,pr:s.pr,stage:s.findings === null ? 'briefing' : s.log.length === list.length ? 'summary' : 'finding',
    total:list.length,index:s.log.length,counts:Object.fromEntries(['blocking','major','minor'].map(level=>[level,list.filter(f=>f.severity===level).length])),
    coverage:s.coverage,finding:list[s.log.length],pending:s.pending,log:s.log}
}
export function act(name,args) {
  const s = read(args.id)
  if (name === 'resume_review') return s
  if (args.revision !== s.revision) throw Error('This card is out of date. Resume the review before making another decision.')
  const finding = s.findings?.[s.log.length]
  if (name === 'set_findings') {
    if (s.findings !== null || args.head !== s.pr.head || args.base !== s.pr.base) throw Error('Review revision changed. Open the current PR again.')
    const rank = {blocking:0,major:1,minor:2}
    s.findings = args.findings.sort((a,b)=>rank[a.severity]-rank[b.severity])
    for (const f of s.findings) checkOptions(f.options)
    s.coverage = args.coverage
  } else {
    if (!finding) throw Error('There is no active finding.')
    const record = (outcome,details) => {
      s.log.push({title:finding.title,severity:finding.severity,path:finding.path,line:finding.line,outcome,details})
      s.pending = null
    }
    if (name === 'choose_option') {
      if (s.pending) throw Error('The current choice is already awaiting verification.')
      const opt = finding.options[args.option]
      if (!opt) throw Error('Choose an option shown on this finding.')
      if (opt.kind === 'fix') s.pending = {option:args.option,label:opt.label}
      else record(opt.kind,opt.label+' — '+opt.reason)
    } else if (name === 'revise_options') {
      if (s.pending) throw Error('Resolve the pending edit first.')
      checkOptions(args.options)
      finding.options = args.options
    } else if (name === 'finish_fix') {
      if (!s.pending || s.pr.head !== args.head || s.pr.base !== args.base) throw Error('Verify the approved edit and reviewed revision first.')
      record('applied',s.pending.label+' — '+args.verification)
    } else if (name === 'reopen_choice') {
      if (!s.pending) throw Error('There is no pending edit.')
      s.pending = null
      finding.notice = args.reason
    } else throw Error('Unknown review action.')
  }
  s.revision++
  return save(s)
}
function checkOptions(options) {
  for (const option of options) {
    if (option.kind === 'fix' && (!option.patch || !/^@@ /m.test(option.patch))) throw Error('Every fix needs a unified diff with a hunk header.')
    if (option.kind !== 'fix' && option.patch) throw Error('Only code fixes can carry a patch.')
  }
}
