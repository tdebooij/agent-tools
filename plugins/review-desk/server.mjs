import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { act, imageOrigins, open, view } from './review.mjs'
import { targetOf, workflow } from './workflow.mjs'

const uri = 'ui://review-desk/review-v1.html'
const resource = {uri,name:'Review Desk',mimeType:'text/html;profile=mcp-app',_meta:{ui:{
  prefersBorder:true,csp:{connectDomains:[],resourceDomains:imageOrigins}
}}}
const text = (description,maxLength=12000) => ({type:'string',minLength:1,maxLength,description})
const integer = minimum => ({type:'integer',minimum})
const record = (properties, required=Object.keys(properties)) => ({type:'object',properties,required,additionalProperties:false})
const array = (items,minItems=0) => ({type:'array',items,minItems})
const sha = {...text('Exact GitHub commit SHA.'),pattern:'^[a-fA-F0-9]{40}$'}
const id = {...text('Review ID returned by the briefing.'),pattern:'^[a-f0-9-]{36}$'}
const version = {id,revision:integer(0)}
const options = array(record({kind:{enum:['fix','accepted','deferred','backend']},label:text('Action to take.'),reason:text('Why choose this option and its trade-off.'),patch:text('Small unified diff, required for a fix.')},['kind','label','reason']),1)
const finding = record({
  severity:{enum:['blocking','major','minor']}, title:text('Describe the observable problem.'),
  trigger:text('A concrete input, sequence of events or configuration that triggers it.'),
  mechanism:text('Walk through the affected code path and explain why this implementation produces the wrong result.'),
  impact:text('Who is affected, the observable consequence, and what should happen instead.'),
  path:text('Actual repository-relative file.'),line:integer(1),evidence:text('Short verbatim code excerpt at the reviewed revision.'),
  options:{...options,description:'First option is recommended. Include a rationale for every choice.'}
})
function tool(name,description,inputSchema,card=true,readOnly=false) {
  return {name,description,inputSchema,annotations:{readOnlyHint:readOnly,destructiveHint:false,openWorldHint:false},
    ...(card ? {_meta:{ui:{resourceUri:uri},'openai/outputTemplate':uri}} : {})}
}
const tools = [
  tool('review_pr',"Start Review Desk when a user asks to review a PR by link or PR number. Resolves the target and returns the authenticated GitHub fetch workflow. Use the user's connected GitHub app.",record({target:text('PR link, owner/repo#123 or #123.'),repository:text('Owner/repo from chat or workspace when target is a number.')},['target']),false,true),
  tool('open_briefing','Open the introductory PR card after fetching GitHub metadata and code changes. Pass the original description verbatim, including image markup. Summarize intent and implementation separately. Wait for Start findings or a chat request.',record({
    url:text('Canonical GitHub PR URL.'),title:text('PR title.'),body:{type:'string',maxLength:100000,description:'Exact GitHub PR description, empty string if absent.'},
    head:sha,base:sha,headRepository:text('Verified owner/repo of head including fork, for relative images.'),goal:text('Original problem, affected user, intended result. Identify inference when intent is undocumented.'),approach:text('Explain how changed components interact to solve it. Reference concrete code. Distinguish claimed behavior from verified changes.')
  },['url','title','body','head','base','goal','approach'])),
  tool('set_findings','After Start findings, submit severity-ranked, evidence-backed findings for this briefing. Re-fetch base/head and pass both. Coverage must describe inspected and missing files/checks. An empty list completes the review.',record({...version,head:sha,base:sha,coverage:text('Review scope, limitations, and verification performed.'),findings:array(finding)})),
  tool('resume_review','Reopen the latest review card, including any pending edit, after a chat interruption or decision. Read before acting on a card message.',record({id}),true,true),
  tool('choose_option','Record ONE explicitly confirmed choice from the active card (zero-based option). A fix becomes pending for Codex to apply locally; other decisions advance immediately. Never call on a default selection.',record({...version,option:integer(0)})),
  tool('revise_options','For a custom direction, present revised options and patch previews for the active finding. Wait for a new explicit decision.',record({...version,options})),
  tool('finish_fix','Advance only after the selected local fix was actually verified against the reviewed commits and the affected checkout. Include real check results. Keep failures open.',record({...version,base:sha,head:sha,verification:text('What changed on disk and the actual check results or limitations.')})),
  tool('reopen_choice','Release a pending choice after a failed apply or cancelled edit. Explain why. If the PR itself changed, open a fresh briefing.',record({...version,reason:text('Explain what prevented the edit.')}))
]
function valid(schema,value) {
  if (schema.enum) return schema.enum.includes(value)
  switch (schema.type) {
    case 'integer': return Number.isSafeInteger(value) && value >= schema.minimum
    case 'string': return typeof value === 'string' && value.length >= (schema.minLength ?? 0) && value.length <= schema.maxLength && (!schema.pattern || new RegExp(schema.pattern).test(value))
    case 'array': return Array.isArray(value) && value.length >= schema.minItems && value.every(item=>valid(schema.items,item))
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value) && schema.required.every(key=>Object.hasOwn(value,key)) && Object.keys(value).every(key=>Object.hasOwn(schema.properties,key) && valid(schema.properties[key],value[key]))
    default: return false
  }
}
function call(name,args) {
  const definition = tools.find(t=>t.name===name)
  if (!definition || !valid(definition.inputSchema,args)) throw Error('Invalid or missing arguments for '+name+'. Check its input schema.')
  if (name === 'review_pr') {
    const target = targetOf(args.target,args.repository)
    return {structuredContent:target,content:[{type:'text',text:'Fetch '+target.url+' now using github_get_pr_info and github_fetch_pr_patch on the connected GitHub app. If an aggregate patch is incomplete, read the affected files at the returned commits. Then call open_briefing with the verified data.\n'+workflow}]}
  }
  const state = view(name === 'open_briefing' ? open(args) : act(name,args))
  return {structuredContent:state,content:[{type:'text',text:JSON.stringify(state),annotations:{audience:['assistant']}}]}
}
for await (const input of createInterface({input:process.stdin})) {
  let msg
  try {
    msg = JSON.parse(input)
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') throw {code:-32600,message:'Invalid request'}
    if (!Object.hasOwn(msg,'id')) continue
    const p=msg.params || {}
    let result
    switch (msg.method) {
      case 'initialize': result={protocolVersion:['2024-11-05','2025-03-26','2025-06-18','2025-11-25'].includes(p.protocolVersion)?p.protocolVersion:'2025-11-25',serverInfo:{name:'review-desk',version:'0.1.3'},capabilities:{tools:{},resources:{}},instructions:workflow}; break
      case 'ping': result={}; break
      case 'resources/templates/list': result={resourceTemplates:[]}; break
      case 'tools/list': result={tools}; break
      case 'resources/list': result={resources:[resource]}; break
      case 'resources/read':
        if (p.uri !== uri) throw {code:-32602,message:'Unknown review view'}
        result={contents:[{...resource,text:readFileSync(new URL('./review.html',import.meta.url),'utf8')}]}; break
      case 'tools/call':
        try { result=call(p.name,p.arguments ?? {}) }
        catch(e) { result={isError:true,content:[{type:'text',text:e.code === 'ENOENT' ? 'Review not found for this installation. Open a new briefing.' : e.message}]} }
        break
      default: throw {code:-32601,message:'Unknown method'}
    }
    console.log(JSON.stringify({jsonrpc:'2.0',id:msg.id,result}))
  } catch(e) {
    console.log(JSON.stringify({jsonrpc:'2.0',id:msg?.id ?? null,error:{code:e.code || -32700,message:e.message}}))
  }
}
