async function readJson(response) {
  try { return await response.json(); }
  catch { throw new Error('Harvest returned an unreadable response. Refresh before retrying.'); }
}
export async function listAccounts(token, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl('https://id.getharvest.com/api/v2/accounts',{
      redirect:'error',signal:AbortSignal.timeout(10000),
      headers:{Authorization:'Bearer '+token,'User-Agent':'Harvest Live (github.com/tdebooij/agent-tools)'}
    });
  } catch { throw new Error('Could not reach Harvest ID. Try again.'); }
  if (!response.ok) throw new Error('Harvest ID could not verify this token (HTTP '+response.status+').');
  const {accounts} = await readJson(response);
  const list = accounts.filter(a=>a.product==='harvest' && Number.isSafeInteger(a.id)).map(({id,name})=>({id,name}));
  if (!list.length) throw new Error('No Harvest time-tracking accounts are available for that token.');
  return list;
}

export function harvest(account, token, fetchImpl = fetch) {
  async function api(path, method = 'GET', body) {
    let response;
    try {
      response = await fetchImpl('https://api.harvestapp.com/v2/'+path,{
        method,redirect:'error',signal:AbortSignal.timeout(10000),
        headers:{Authorization:'Bearer '+token,'Harvest-Account-Id':String(account.accountId),'User-Agent':'Harvest Live (github.com/tdebooij/agent-tools)','Content-Type':'application/json'},
        body:body && JSON.stringify(body)
      });
    } catch { throw new Error('Harvest did not confirm the request. Refresh before retrying.'); }
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403
      ? 'Harvest denied access. Check the account ID, token, and permissions.'
      : 'Harvest returned HTTP '+response.status+'. Refresh before retrying.');
    return readJson(response);
  }
  async function projects() {
    const list = [];
    let page = 1;
    while (page) {
      const result = await api('users/me/project_assignments?is_active=true&per_page=2000&page='+page);
      for (const a of result.project_assignments) {
        if (a.is_active === false) continue;
        list.push({id:a.project.id,name:a.project.name,client:a.client.name,tasks:a.task_assignments.filter(t=>t.is_active).map(t=>({id:t.task.id,name:t.task.name}))});
      }
      if (result.next_page != null && (!Number.isSafeInteger(result.next_page) || result.next_page <= page)) throw new Error('Harvest returned invalid pagination.');
      page = result.next_page;
    }
    return list;
  }
  function summary(e) {
    if (e.user?.id !== account.userId || !Number.isSafeInteger(e.id) || typeof e.is_running !== 'boolean') throw new Error('Harvest returned an unexpected entry.');
    const start = Date.parse(e.timer_started_at);
    const seconds = e.is_running && Number.isFinite(start) && Number.isFinite(e.hours_without_timer)
      ? e.hours_without_timer * 3600 + Math.max(0,(Date.now()-start)/1000)
      : Number.isFinite(e.hours) ? e.hours * 3600 : null;
    return {id:e.id,project:e.project.name,task:e.task.name,client:e.client.name,notes:e.notes || '',
      is_running:e.is_running,seconds,started_at:e.timer_started_at};
  }
  async function entry(id) {
    const e = await api('time_entries/'+id);
    if (e.id !== id) throw new Error('Harvest returned a different entry.');
    return summary(e);
  }
  async function running() {
    const {time_entries:entries} = await api('time_entries?is_running=true&user_id='+account.userId+'&per_page=2');
    if (!Array.isArray(entries) || entries.length > 1) throw new Error('Could not identify a single running timer. Review it in Harvest.');
    if (!entries.length) return null;
    const [e] = entries;
    if (e.is_running !== true) throw new Error('Harvest returned an unexpected timer.');
    return summary(e);
  }
  async function start(choice) {
    const assigned = await projects();
    if (!assigned.find(p=>p.id===choice.project_id)?.tasks.some(t=>t.id===choice.task_id)) throw new Error('This project and task are no longer assigned. Refresh the card.');
    const company = await api('company');
    const current = await running();
    if ((current?.id ?? null) !== choice.expected_running_id) throw Object.assign(new Error('The running timer changed. Review it before switching.'),{reason:'timer_changed'});
    if (current) {
      const stopped = await api('time_entries/'+current.id+'/stop','PATCH');
      if (stopped.id !== current.id || stopped.is_running !== false) throw new Error('Harvest did not confirm the stop. Refresh the card.');
    }
    const now = new Date();
    const pad = value=>String(value).padStart(2,'0');
    const spent_date = [now.getFullYear(),pad(now.getMonth()+1),pad(now.getDate())].join('-');
    try {
      const created = await api('time_entries','POST',{project_id:choice.project_id,task_id:choice.task_id,notes:choice.notes,spent_date,
        ...(company.wants_timestamp_timers && {started_time:pad(now.getHours())+':'+pad(now.getMinutes())})});
      if (!created.is_running || created.user?.id !== account.userId || created.project?.id !== choice.project_id || created.task?.id !== choice.task_id)
        throw new Error('Harvest did not confirm the new timer. Refresh the card.');
      return summary(created);
    } catch (error) { if (current) throw new Error('The previous timer was stopped. '+error.message); throw error; }
  }
  return {me:()=>api('users/me'), async context(){const [list,timer]=await Promise.all([projects(),running()]);return {projects:list,running:timer};}, entry, start};
}
