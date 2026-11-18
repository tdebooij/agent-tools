import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicEncrypt, createPublicKey } from 'node:crypto';
import { unwrap, wrappingKey } from './account.mjs';
import { harvest,listAccounts } from './harvest-api.mjs';

test('private form envelope round trips and rejects invalid input', () => {
  const token = 'synthetic-test-token';
  const key = createPublicKey({key:wrappingKey(),format:'jwk'});
  const ciphertext = publicEncrypt({key,oaepHash:'sha256'},Buffer.from(token)).toString('base64');
  assert.ok(!ciphertext.includes(token));
  assert.equal(unwrap(ciphertext),token);
  assert.throws(()=>unwrap(token),/Paste it again/);
});

test('discovery excludes Forecast and does not forward a redirect', async () => {
  const list=await listAccounts('fixture',async (url,options)=>{
    assert.equal(url,'https://id.getharvest.com/api/v2/accounts');
    assert.equal(options.redirect,'error');
    return Response.json({accounts:[{id:4,product:'forecast'},{name:'Team',id:5,product:'harvest'}]});
  });
  assert.deepEqual(list,[{id:5,name:'Team'}]);
});
for (const mode of ['switch','stale','wrong assignment','stop fails','start fails']) {
  test('authenticated timer operation: '+mode, async () => {
    const writes=[];
    const client=harvest({accountId:21,userId:11},'fixture',async (url,init)=>{
      const path=new URL(url);
      assert.equal(path.origin,'https://api.harvestapp.com');
      assert.equal(init.headers.Authorization,'Bearer fixture');
      assert.equal(init.headers['Harvest-Account-Id'],'21');
      const project={id:1,name:'Website'}, task={id:2,name:'Design'}, user={id:11}, client={name:'Studio'};
      const entry={id:3,is_running:true,project,task,user,client};
      if(path.pathname.endsWith('/project_assignments')) return Response.json({project_assignments:[{project,client,task_assignments:[{task,is_active:true}]}],next_page:null});
      if(path.pathname.endsWith('/company')) return Response.json({wants_timestamp_timers:true});
      if(init.method==='GET'){
        assert.equal(path.searchParams.get('user_id'),'11');
        return Response.json({time_entries:[entry]});
      }
      writes.push(init.method);
      if(init.method==='PATCH') return mode==='stop fails' ? new Response(null,{status:409}) : Response.json({...entry,is_running:false});
      const body=JSON.parse(init.body);
      assert.equal(body.notes,'Exact note');assert.match(body.started_time,/^\d\d:\d\d$/);
      return mode==='start fails' ? new Response(null,{status:422}) : Response.json({...entry,id:4});
    });
    const promise=client.start({project_id:mode==='wrong assignment'?7:1,task_id:2,notes:'Exact note',expected_running_id:mode==='stale'?null:3});
    if(mode==='switch') assert.equal((await promise).id,4);
    else await assert.rejects(promise,mode==='start fails'?/previous timer was stopped/:/Harvest|changed|assigned/);
    assert.deepEqual(writes,mode==='switch'||mode==='start fails'?['PATCH','POST']:mode==='stop fails'?['PATCH']:[]);
  });
}

test('summary reads the selected entry and checks its owner and duration', async () => {
  const entry = {id:7,user:{id:11},client:{name:'Studio'},project:{name:'Website'},task:{name:'Design'},
    notes:'Review checkout',is_running:false,hours:1.25};
  const client = harvest({accountId:21,userId:11},'fixture',async (url,init) => {
    assert.equal(new URL(url).pathname,'/v2/time_entries/7');
    assert.equal(init.method,'GET');
    return Response.json(entry);
  });
  assert.equal((await client.entry(7)).seconds,4500);
  Object.assign(entry,{is_running:true,hours_without_timer:1,timer_started_at:new Date(Date.now()-60000).toISOString()});
  const running = await client.entry(7);
  assert.ok(running.seconds >= 3660 && running.seconds < 3665);
  entry.user.id = 12;
  await assert.rejects(client.entry(7),/unexpected entry/);
  entry.id = 8;
  await assert.rejects(client.entry(7),/different entry/);
});
