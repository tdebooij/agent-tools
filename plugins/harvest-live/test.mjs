import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function run(script, lines, directory, now) {
  const temporary = directory ?? mkdtempSync(join(tmpdir(),'harvest-check-'));
  const clock = now ? ['--import','data:text/javascript,'+encodeURIComponent(
    'globalThis.Date = class extends Date { constructor(...args) { super(...(args.length ? args : ['+now.getTime()+'])); } }'
  )] : [];
  const result = spawnSync(process.execPath, [...clock,fileURLToPath(new URL(script, import.meta.url))], {
    env: {...process.env,XDG_CONFIG_HOME:temporary,PLUGIN_DATA:temporary}, input: lines.map(line => JSON.stringify(line)).join('\n')+'\n', encoding: 'utf8'
  });
  if (!directory) rmSync(temporary,{recursive:true,force:true});
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim() ? result.stdout.trim().split('\n').map(line => JSON.parse(line)) : [];
}
test('discovery and first-use timer opening work without a token or Harvest connector', () => {
  const [init,list,read,firstUse] = run('server.mjs', [
    ['initialize',{protocolVersion:'2025-11-25'}], ['tools/list'], ['resources/read',{uri:'ui://harvest-live/timer-v7.html'}],
    ['tools/call',{name:'show_timer',arguments:{}}]
  ].map(([method,params],id)=>({jsonrpc:'2.0',id,method,params})));
  assert.equal(init.result.protocolVersion,'2025-11-25');
  assert.equal(list.result.tools[0]._meta.ui.resourceUri,read.result.contents[0].uri);
  assert.equal(read.result.contents[0]._meta['openai/widgetMinFrameHeight'],1);
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

test('both first-use entry points carry a work suggestion through account setup without carrying assignment IDs', () => {
  const suggestion = {notes:'Review checkout #127',project_hint:'Storefront',task_hint:'Design'};
  for (const name of ['show_account','show_timer']) {
    const args = name === 'show_timer' ? {...suggestion,project_id:42,task_id:7} : suggestion;
    const [reply] = run('server.mjs',[{id:1,jsonrpc:'2.0',method:'tools/call',params:{name,arguments:args}}]);
    assert.deepEqual(reply.result.structuredContent,{accountOnly:true,account:null,suggestion});
  }
});

test('resuming a chat claims one in-hours card per local day regardless of yesterday’s card action', () => {
  const dir = mkdtempSync(join(tmpdir(),'harvest-daily-'));
  try {
    const submit = (session_id,day,hour,prompt='Continue',extra={}) => run('hooks/prompt.mjs',
      [{hook_event_name:'UserPromptSubmit',session_id,prompt,...extra}],dir,new Date(2026,10,day,hour));
    for (const chat of ['started','dismissed']) {
      assert.match(submit(chat,20,17)[0].hookSpecificOutput.additionalContext,/daily check/);
      assert.equal(submit(chat,20,17).length,0);
      assert.match(submit(chat,21,12)[0].hookSpecificOutput.additionalContext,/outside/);
      assert.match(submit(chat,23,8)[0].hookSpecificOutput.additionalContext,/outside/);
      assert.equal(submit(chat,23,9,'Do the work',{agent_id:'child'}).length,0);
      assert.match(submit(chat,23,9)[0].hookSpecificOutput.additionalContext,/daily check for 2026-11-23/);
      assert.equal(submit(chat,23,11).length,0);
    }
    assert.equal(submit('private',20,8,'--no-harvest please').length,0);
    assert.equal(submit('private',23,10).length,0);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
