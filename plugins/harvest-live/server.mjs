import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

import { days, readSchedule, saveSchedule } from './schedule.mjs';

const uri = 'ui://harvest-live/timer-v2.html';
const mimeType = 'text/html;profile=mcp-app';
const id = { type: 'integer', minimum: 1 };
const label = { type: 'string', maxLength: 1000 };
const notes = { type: 'string', maxLength: 4000 };
const record = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });
const task = record({ id, name: label }, ['id', 'name']);
const project = record({ id, name: label, client: label, tasks: { type: 'array', items: task } }, ['id', 'name', 'client']);
const running = record({ id, project: label, task: label, client: label, notes, started_at: { ...label, description: 'ISO timestamp of current timer segment, if known.' } }, ['id', 'project', 'task']);
const inputSchema = record({
  projects: { type: 'array', items: project, description: 'Active projects. Omit tasks for projects whose assignments have not been fetched.' },
  running: { anyOf: [running, { type: 'null' }] }, project_id: id, task_id: id, notes
}, ['projects', 'running', 'notes']);

const tool = {
  name: 'show_timer', title: 'Harvest Live', description: 'Display an editable Harvest proposal from verified connector data. Read-only. Use the harvest-live skill to handle a submitted choice.',
  inputSchema, annotations: { readOnlyHint: true, openWorldHint: false },
  _meta: { ui: { resourceUri: uri }, 'openai/outputTemplate': uri }
};
const meta = { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } }, 'openai/ui': { preferredDisplayMode: 'inline', availableDisplayModes: ['inline'] } };
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

function dispatch(method, params = {}) {
  switch (method) {
    case 'initialize': return {
      protocolVersion: ['2024-11-05','2025-03-26','2025-06-18','2025-11-25'].includes(params.protocolVersion) ? params.protocolVersion : '2025-11-25',
      capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'harvest-live', version: '0.1.1' }
    };
    case 'ping': return {};
    case 'tools/list': return { tools: [tool, settings, save] };
    case 'resources/templates/list': return { resourceTemplates: [] };
    case 'resources/list': return { resources: [resource] };
    case 'resources/read':
      if (params.uri !== uri && params.uri !== 'ui://harvest-live/timer-v1.html') break;
      return { contents: [{ ...resource, uri: params.uri, text: readFileSync(new URL('./timer.html', import.meta.url), 'utf8') }] };
    case 'tools/call':
      if (params.name === settings.name) {
        let schedule;
        try { schedule = readSchedule(); }
        catch { return {structuredContent:{settingsOnly:true,settingsError:true},content:[{type:'text',text:'Working-hours settings need repair. Choose and save a schedule.'}]}; }
        return {structuredContent:{settingsOnly:true,schedule},content:[{type:'text',text:'Working-hours settings opened.'}]};
      }
      if (params.name === save.name) {
        try {
          const schedule = saveSchedule(params.arguments);
          return {structuredContent:{schedule},content:[{type:'text',text:'Working hours saved.'}]};
        } catch (error) {
          return {isError:true,content:[{type:'text',text:error.code ? 'Could not save the settings file.' : error.message}]};
        }
      }
      if (params.name !== tool.name || !valid(inputSchema, params.arguments)) break;
      return {
        content: [{ type: 'text', text: 'Harvest proposal ready for review. No timer action has been taken.' }],
        structuredContent: params.arguments, _meta: {schedule:readSchedule()}
      };
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
    const result = dispatch(request.method, request.params);
    console.log(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
  } catch (error) {
    const fallback = error instanceof SyntaxError ? { code: -32700, message: 'Invalid JSON' } : { code: -32603, message: 'Unable to load timer' };
    console.log(JSON.stringify({ jsonrpc: '2.0', id: request?.id ?? null, error: Number.isInteger(error.code) ? error : fallback }));
  }
}
