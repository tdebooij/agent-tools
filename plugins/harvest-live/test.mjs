import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function run(script, lines) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url))], {
    input: lines.map(line => JSON.stringify(line)).join('\n')+'\n', encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim() ? result.stdout.trim().split('\n').map(line => JSON.parse(line)) : [];
}
test('discover and read the card, reject an unknown timer, round-trip a running proposal', () => {
  const draft = {running:{id:19,project:'Website',task:'Design',started_at:'2026-11-17T12:00:00Z'},projects:[{id:2,client:'Studio',name:'Website',tasks:[{id:3,name:'Design'}]}],notes:'Review checkout',project_id:2,task_id:3};
  const call = args => ({name:'show_timer',arguments:args});
  const uri = 'ui://harvest-live/timer-v2.html';
  const messages = [['initialize',{protocolVersion:'2025-11-25'}],['tools/list'],['resources/read',{uri}],['tools/call',call(draft)],['tools/call',call({...draft,running:undefined})],['tools/call',call({...draft,project_id:-1})],['tools/call',call({...draft,running:null})]];
  const [init,list,read,show,unknown,bad,idle] = run('server.mjs',messages.map(([method,params],id)=>({jsonrpc:'2.0',id,method,params})));
  assert.equal(init.result.protocolVersion,'2025-11-25');
  assert.equal(list.result.tools[0]._meta.ui.resourceUri,uri);
  assert.match(read.result.contents[0].text,/ui\/notifications\/initialized/);
  assert.deepEqual(show.result.structuredContent,draft);
  assert.equal(unknown.error.code,-32602);
  assert.equal(bad.error.code,-32602);
  assert.equal(idle.result.structuredContent.running,null);
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
  const original = {...process.env};
  try {
    process.env.XDG_CONFIG_HOME = dir; process.env.PLUGIN_DATA = dir;
    const rpc = (name,args) => run('server.mjs',[{id:1,jsonrpc:'2.0',method:'tools/call',params:{name,arguments:args}}])[0].result;
    const s = {days:'never',start:'09:15',end:'17:30'};
    assert.deepEqual(rpc('save_working_hours',s).structuredContent.schedule,s);
    assert.deepEqual(rpc('show_working_hours',{}).structuredContent.schedule,s);
    assert.equal(rpc('save_working_hours',{...s,end:'25:70'}).isError,true);
    const prompt = (session_id,text) => run('hooks/prompt.mjs',[{hook_event_name:'UserPromptSubmit',prompt:text,session_id}]);
    assert.match(prompt('a','Hello')[0].hookSpecificOutput.additionalContext,/Skip the entire automatic/);
    assert.equal(prompt('a','next').length,0);
    assert.equal(prompt('b','--no-harvest hello').length,0);
    assert.equal(prompt('b','next').length,0);
  } finally {
    for (const key of ['XDG_CONFIG_HOME','PLUGIN_DATA']) {
      if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
    }
    rmSync(dir,{recursive:true,force:true});
  }
});
