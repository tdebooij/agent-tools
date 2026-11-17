import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function run(script, lines, directory) {
  const temporary = directory ?? mkdtempSync(join(tmpdir(),'harvest-check-'));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url))], {
    env: {...process.env,XDG_CONFIG_HOME:temporary,PLUGIN_DATA:temporary}, input: lines.map(line => JSON.stringify(line)).join('\n')+'\n', encoding: 'utf8'
  });
  if (!directory) rmSync(temporary,{recursive:true,force:true});
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim() ? result.stdout.trim().split('\n').map(line => JSON.parse(line)) : [];
}
test('discovery and first-use timer opening work without a token or Harvest connector', () => {
  const [init,list,read,firstUse] = run('server.mjs', [
    ['initialize',{protocolVersion:'2025-11-25'}], ['tools/list'], ['resources/read',{uri:'ui://harvest-live/timer-v3.html'}],
    ['tools/call',{name:'show_timer',arguments:{}}]
  ].map(([method,params],id)=>({jsonrpc:'2.0',id,method,params})));
  assert.equal(init.result.protocolVersion,'2025-11-25');
  assert.equal(list.result.tools[0]._meta.ui.resourceUri,read.result.contents[0].uri);
  assert.match(read.result.contents[0].text,/id="token"/);
  assert.equal(firstUse.result.structuredContent.accountOnly,true);
});
test('first-prompt guidance is available at any hour and respects the standalone opt-out', () => {
  const event = prompt => ({hook_event_name:'UserPromptSubmit',prompt});
  assert.equal(run('hooks/prompt.mjs',[event('fix --no-harvest please')]).length,0);
  assert.equal(run('hooks/prompt.mjs',[event('fix --no-harvesters')]).length,1);
  assert.equal(run('hooks/prompt.mjs',[{hook_event_name:'Stop',prompt:'done'}]).length,0);
});

import { inHours, validateSchedule } from './schedule.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('working days, local boundaries, midnight and invalid schedules', () => {
  const s = {days:'weekdays',start:'09:00',end:'18:00'};
  const at = (day,h,m) => new Date(2026,10,day,h,m);
  assert.equal(inHours(s,at(16,8,59)),false);
  assert.equal(inHours(s,at(16,9,0)),true);
  assert.equal(inHours(s,at(16,17,59)),true);
  assert.equal(inHours(s,at(16,18,0)),false);
  assert.equal(inHours(s,at(21,12,0)),false);
  assert.equal(inHours({...s,days:'mon-sat'},at(21,12,0)),true);
  assert.equal(inHours({...s,days:'every-day',end:'24:00'},at(22,23,59)),true);
  assert.equal(inHours({...s,days:'never'},at(16,12,0)),false);
  assert.throws(()=>validateSchedule({...s,end:'25:00'}));
  assert.throws(()=>validateSchedule({...s,start:'20:00'}));
});

test('schedule saves across processes and hook suppresses fallback and duplicate prompts', () => {
  const dir = mkdtempSync(join(tmpdir(),'harvest-live-test-'));
  try {
    const rpc = (name,args) => run('server.mjs',[{id:1,jsonrpc:'2.0',method:'tools/call',params:{name,arguments:args}}],dir)[0].result;
    const s = {days:'never',start:'09:15',end:'17:30'};
    assert.deepEqual(rpc('save_working_hours',s).structuredContent.schedule,s);
    assert.deepEqual(rpc('show_working_hours',{}).structuredContent.schedule,s);
    assert.equal(rpc('save_working_hours',{...s,end:'25:70'}).isError,true);
    const prompt = (session_id,text) => run('hooks/prompt.mjs',[{hook_event_name:'UserPromptSubmit',prompt:text,session_id}],dir);
    assert.match(prompt('a','Hello')[0].hookSpecificOutput.additionalContext,/Skip the entire automatic/);
    assert.equal(prompt('a','next').length,0);
    assert.equal(prompt('b','--no-harvest hello').length,0);
    assert.equal(prompt('b','next').length,0);
  } finally {
    rmSync(dir,{recursive:true,force:true});
  }
});
