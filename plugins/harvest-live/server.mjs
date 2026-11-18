import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

import { days, readSchedule, saveSchedule } from './schedule.mjs';

import { currentAccount, credential, checkAccount, wrappingKey, unwrap, saveAccount, forgetAccount, withAccountLock } from './account.mjs';
import { harvest, listAccounts } from './harvest-api.mjs';

const uri = 'ui://harvest-live/timer-v7.html';
const mimeType = 'text/html;profile=mcp-app';
const id = { type: 'integer', minimum: 1 };
const label = { type: 'string', maxLength: 1000 };
const notes = { type: 'string', maxLength: 4000 };
const record = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });
const ref = {type:'string',maxLength:36};
const expected = {anyOf:[ref,{type:'null'}]};
const suggestion = {
  notes: {...notes,description:'Short action-oriented description of the work from the opening request, including its ticket ID if present.'},
  project_hint: {...label,description:'Likely project or client name inferred from the request or repository before assignments can be read.'},
  task_hint: {...label,description:'Likely Harvest task name or discipline, for example Design or Web.'}
};
const inputSchema = record({connection_ref:ref,project_id:id,task_id:id,...suggestion},[]);

const tool = {
  name: 'show_timer', title: 'Harvest Live', description: 'Open the timer with data from this plugin’s connected personal account, or display token setup on first use. Read-only. Use the harvest-live skill to handle a submitted choice.',
  inputSchema, annotations: { readOnlyHint: true, openWorldHint: false },
  _meta: { ui: { resourceUri: uri }, 'openai/outputTemplate': uri }
};
const meta = { 'openai/widgetMinFrameHeight': 1, ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } }, 'openai/ui': { preferredDisplayMode: 'inline', availableDisplayModes: ['inline'] } };
const tokenStorage = {darwin:'macOS Keychain',win32:'Windows user-protected storage'}[process.platform] ?? 'a private local file accessible to your OS user (unencrypted)';
const resource = { uri, name: 'Harvest timer', mimeType, _meta: meta };

const settings = {
  name: 'show_working_hours', title: 'Harvest working hours',
  description: 'Open Harvest Live working-hours settings on explicit request. Does not access Harvest.',
  inputSchema: record({}, []), annotations: {readOnlyHint:true}, _meta:tool._meta
};
const save = {
  name: 'save_working_hours', title: 'Save working hours', description: 'Save the local automatic timer prompt schedule.',
  inputSchema: record({days:{type:'string',enum:Object.keys(days)},start:label,end:label}, ['days','start','end']),
  annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}, _meta:{ui:{visibility:['app']}}
};

function valid(schema, value) {
  if (schema.anyOf) return schema.anyOf.some(option => valid(option, value));
  switch (schema.type) {
    case 'null': return value === null;
    case 'integer': return Number.isSafeInteger(value) && value >= schema.minimum;
    case 'string': return typeof value === 'string' && value.length <= schema.maxLength;
    case 'array': return Array.isArray(value) && value.every(v => valid(schema.items, v));
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value)
      && schema.required.every(k => Object.hasOwn(value, k))
      && Object.keys(value).every(k => Object.hasOwn(schema.properties, k) && valid(schema.properties[k], value[k]));
  }
}

const accountView = {...settings,name:'show_account',title:'Harvest account',inputSchema:record(suggestion,[]),description:'Open the private personal access token form. For onboarding from a work request, supply notes and likely project/task names for the first timer draft.'};
const contextTool = {...settings,name:'read_personal_context',title:'Read personal Harvest account',
  description:'Check for a configured personal account and read its own project assignments and running timer. If unset, open show_account.',_meta:{}};
function privateTool(name, properties, readOnlyHint = false) {
  return {name,inputSchema:record(properties,Object.keys(properties)),annotations:{readOnlyHint},_meta:{ui:{visibility:['app']}}};
}
const actions = [
  privateTool('get_token_key',{},true),
  privateTool('connect_account',{account_id:{anyOf:[id,{type:'null'}]},encrypted_token:{type:'string',maxLength:512},expected_ref:expected}),
  privateTool('disconnect_account',{expected_ref:ref}),
  privateTool('read_personal_entry',{connection_ref:ref,entry_id:id},true),
  privateTool('start_personal_timer',{connection_ref:ref,project_id:id,task_id:id,expected_running_id:{anyOf:[id,{type:'null'}]},notes})
];
const personalTools = [accountView,contextTool,...actions];
async function personal(name,args) {
  const description = 'Harvest account';
  const result = (data,text=description) => ({structuredContent:data,content:[{type:'text',text}]});
  if (name === accountView.name) {
    const account = currentAccount();
    let schedule;
    try { schedule = readSchedule(); } catch { /* Settings can be repaired separately. */ }
    const {notes,project_hint,task_hint} = args;
    return {...result({accountOnly:true,account,suggestion:{notes,project_hint,task_hint}}),_meta:{account,tokenStorage,schedule}};
  }
  if (name === contextTool.name) {
    const account = currentAccount();
    if (!account) return result({account:null},'No personal token configured.');
    const data = await harvest(account,credential(account)).context();
    const state = {account,...data};
    return result(state,JSON.stringify(state));
  }
  if (name === 'get_token_key') return {content:[],_meta:{key:wrappingKey()}};
  if (name === 'read_personal_entry') {
    const account = checkAccount(args.connection_ref);
    return result({entry:await harvest(account,credential(account)).entry(args.entry_id)},'Harvest entry status retrieved.');
  }
  return withAccountLock(async () => {
    if (name === 'connect_account') {
      checkAccount(args.expected_ref);
      const token = unwrap(args.encrypted_token);
      const accounts = await listAccounts(token);
      if (!args.account_id && accounts.length > 1) return result({accounts},'Choose a Harvest account.');
      const workspace = args.account_id ? accounts.find(a=>a.id===args.account_id) : accounts[0];
      if (!workspace) throw new Error('The selected account is no longer available. Paste the token again.');
      const user = await harvest({accountId:workspace.id},token).me();
      if (!Number.isSafeInteger(user?.id) || user.id <= 0) throw new Error('Harvest did not verify this identity.');
      return result({account:saveAccount(args.expected_ref,workspace,user,token)},'Personal Harvest account connected.');
    }
    if (name === 'disconnect_account') { forgetAccount(args.expected_ref); return result({account:null},'Saved token removed.'); }
    const account = checkAccount(args.connection_ref);
    if (!account || !args.notes.trim()) throw new Error('Review the account and description before starting.');
    return result({running:await harvest(account,credential(account)).start(args)},'Harvest confirmed the new timer.');
  });
}

async function dispatch(method, params = {}) {
  switch (method) {
    case 'initialize': return {
      protocolVersion: ['2024-11-05','2025-03-26','2025-06-18','2025-11-25'].includes(params.protocolVersion) ? params.protocolVersion : '2025-11-25',
      capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'harvest-live', version: '0.2.4' }
    };
    case 'ping': return {};
    case 'tools/list': return { tools: [tool, settings, save, ...personalTools] };
    case 'resources/templates/list': return { resourceTemplates: [] };
    case 'resources/list': return { resources: [resource] };
    case 'resources/read':
      if (params.uri !== uri && !['ui://harvest-live/timer-v1.html','ui://harvest-live/timer-v2.html','ui://harvest-live/timer-v3.html','ui://harvest-live/timer-v4.html','ui://harvest-live/timer-v5.html','ui://harvest-live/timer-v6.html'].includes(params.uri)) break;
      return { contents: [{ ...resource, uri: params.uri, text: readFileSync(new URL('./timer.html', import.meta.url), 'utf8') }] };
    case 'tools/call': {
      const operation = personalTools.find(t=>t.name===params.name);
      if (operation) {
        if (!valid(operation.inputSchema,params.arguments ?? {})) break;
        try { return await personal(params.name,params.arguments ?? {}); }
        catch (error) { return {isError:true,_meta:{reason:error.reason},content:[{type:'text',text:error.code ? 'Unable to access local account settings.' : error.message}]}; }
      }
      if (params.name === settings.name) {
        let schedule;
        try { schedule = readSchedule(); }
        catch { return {structuredContent:{settingsOnly:true,settingsError:true},content:[{type:'text',text:'Working-hours settings need repair. Choose and save a schedule.'}]}; }
        return {_meta:{account:currentAccount(),tokenStorage},structuredContent:{settingsOnly:true,schedule},content:[{type:'text',text:'Working-hours settings opened.'}]};
      }
      if (params.name === save.name) {
        try {
          const schedule = saveSchedule(params.arguments);
          return {structuredContent:{schedule},content:[{type:'text',text:'Working hours saved.'}]};
        } catch (error) {
          return {isError:true,content:[{type:'text',text:error.code ? 'Could not save the settings file.' : error.message}]};
        }
      }
      if (params.name !== tool.name || !valid(inputSchema, params.arguments ?? {})) break;
      const account = currentAccount();
      const draft = params.arguments ?? {};
      if (!account) return personal(accountView.name,draft);
      if (draft.connection_ref && account.ref !== draft.connection_ref) return personal(accountView.name,{});
      try {
        const fresh = await harvest(account,credential(account)).context();
        return {content:[{type:'text',text:'Personal Harvest timer ready for review.'}],
          structuredContent:{...draft,...fresh,notes:draft.notes ?? '',connection_ref:account.ref},_meta:{schedule:readSchedule(),account,tokenStorage}};
      } catch (error) {
        const result = await personal(accountView.name,draft);
        result.structuredContent.connectionError = error.message;
        return result;
      }
    }
    default: throw { code: -32601, message: 'Unknown method' };
  }
  throw { code: -32602, message: 'Invalid resource, tool, or timer fields' };
}

for await (const line of createInterface({ input: process.stdin })) {
  let request;
  try {
    request = JSON.parse(line);
    if (request?.jsonrpc !== '2.0' || typeof request.method !== 'string') throw { code: -32600, message: 'Invalid request' };
    if (!Object.hasOwn(request, 'id')) continue;
    const result = await dispatch(request.method, request.params);
    if (request.method === 'tools/call' && [tool.name,accountView.name,settings.name].includes(request.params?.name) && !result.isError) {
      result._meta = {...result._meta,cardId:randomUUID()};
    }
    console.log(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
  } catch (error) {
    const fallback = error instanceof SyntaxError ? { code: -32700, message: 'Invalid JSON' } : { code: -32603, message: 'Unable to load timer' };
    console.log(JSON.stringify({ jsonrpc: '2.0', id: request?.id ?? null, error: Number.isInteger(error.code) ? error : fallback }));
  }
}
