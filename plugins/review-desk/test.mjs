import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { screenshots } from './review.mjs'
import { targetOf } from './workflow.mjs'

const head = 'a'.repeat(40), base='b'.repeat(40)
const cmd = (file,input,env=process.env) => {
  const r=spawnSync(process.execPath,[fileURLToPath(new URL(file,import.meta.url))],{input:JSON.stringify(input)+'\n',encoding:'utf8',env})
  assert.equal(r.status,0,r.stderr)
  return r.stdout.trim() ? JSON.parse(r.stdout) : null
}
test('review requests trigger the bundled workflow with no skill or checkout dependency',()=>{
  for (const prompt of ["Let's review this PR: https://github.com/acme/ui/pull/12","Review PR #12","Could you review acme/ui#12?"]) {
    assert.match(cmd('./hooks/prompt.mjs',{hook_event_name:'UserPromptSubmit',prompt}).hookSpecificOutput.additionalContext,/review_pr/)
  }
  assert.equal(cmd('./hooks/prompt.mjs',{hook_event_name:'UserPromptSubmit',prompt:'Build a plugin to review PRs'}),null)
  for(const target of ['https://github.com/acme/ui/pull/12/files#diff-123','acme/ui#12','#12','PR #12']) assert.equal(targetOf(target,'acme/ui').url,'https://github.com/acme/ui/pull/12')
  assert.throws(()=>targetOf('#2'),/Which GitHub repository/)
  assert.throws(()=>targetOf('https://example.org/acme/ui/pull/2','acme/ui'))
})
test('description screenshots keep order, omit code examples and link to external hosts on demand',()=>{
  const url='https://github.com/user-attachments/assets/13d70ddf-d4c4-4aa3-ace8-45f1895f2345'
  const doc=['![Before]('+url+')','<img alt="After" src="screens/new.png">','![More][ref]','[ref]: https://assets.example.org/view.png','```md','![example](ignore.png)','```','<img src="javascript:alert(1)">',url].join('\n')
  const result=screenshots(doc,'fork/ui',head)
  assert.deepEqual(result.map(i=>i.alt),['Before','After','More'])
  assert.deepEqual(result.map(i=>i.inline),[true,true,false])
  assert.equal(result[1].url,'https://raw.githubusercontent.com/fork/ui/'+head+'/screens/new.png')
  assert.deepEqual(screenshots('',null,head),[])
})
test('stdio review survives restarts and rejects old cards and unconfirmed outcomes',t=>{
  const dir=mkdtempSync(join(tmpdir(),'review desk '))
  t.after(()=>rmSync(dir,{recursive:true,force:true}))
  const env={...process.env,PLUGIN_DATA:dir}
  const rpc=(method,params={})=>cmd('./server.mjs',{jsonrpc:'2.0',id:1,method,params},env).result
  const call=(name,args)=>rpc('tools/call',{name,arguments:args})
  assert.ok(rpc('tools/list').tools.some(t=>t.name==='review_pr'))
  const resource=rpc('resources/list').resources[0]
  assert.match(rpc('resources/read',{uri:resource.uri}).contents[0].text,/ui\/initialize/)
  assert.equal(call('review_pr',{target:'#2'}).isError,true)
  assert.equal(call('review_pr',{target:'acme/ui#2'}).structuredContent.repository,'acme/ui')
  const brief={url:'https://github.com/acme/ui/pull/2',title:'PR',body:'',head,base,goal:'Goal',approach:'Approach'}
  const start=()=>call('open_briefing',brief).structuredContent
  let s=start()
  const args=()=>({id:s.id,revision:s.revision})
  const data={severity:'minor',title:'Issue',trigger:'Condition',mechanism:'Cause',impact:'Outcome',path:'file',line:1,evidence:'code',options:[{kind:'fix',label:'Guard',reason:'Avoid corruption',patch:'@@ -1 +1 @@\n-old\n+new'},{kind:'deferred',label:'Defer',reason:'Follow up'}]}
  assert.equal(call('set_findings',{...args(),head:base,base,coverage:'All',findings:[]}).isError,true)
  assert.equal(call('set_findings',{...args(),head,base,coverage:'All',findings:[{...data,mechanism:''}]}).isError,true)
  s=call('set_findings',{...args(),head,base,coverage:'All',findings:[data,{...data,severity:'blocking'}]}).structuredContent
  assert.equal(s.finding.severity,'blocking')
  assert.equal(call('finish_fix',{...args(),head,base,verification:'Done'}).isError,true)
  const old=args()
  s=call('choose_option',{...args(),option:0}).structuredContent
  assert.equal(s.log.length,0)
  assert.equal(call('choose_option',{...old,option:1}).isError,true)
  assert.deepEqual(call('resume_review',{id:s.id}).structuredContent.pending,s.pending)
  s=call('reopen_choice',{...args(),reason:'Checkout changed'}).structuredContent
  s=call('revise_options',{...args(),options:data.options}).structuredContent
  s=call('choose_option',{...args(),option:0}).structuredContent
  s=call('finish_fix',{...args(),head,base,verification:'Focused check passed.'}).structuredContent
  s=call('choose_option',{...args(),option:1}).structuredContent
  assert.equal(s.stage,'summary')
  assert.deepEqual(s.log.map(e=>e.outcome),['applied','deferred'])
  s=start()
  s=call('set_findings',{...args(),head,base,coverage:'Two files reviewed',findings:[]}).structuredContent
  assert.equal(s.stage,'summary')
})
