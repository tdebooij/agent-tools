import { readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { inHours, readSchedule } from '../schedule.mjs';

const event = JSON.parse(readFileSync(0, 'utf8'));
if (event.hook_event_name !== 'UserPromptSubmit' || !event.prompt?.trim() || event.agent_id) process.exit(0);

const now = new Date();
const localDay = date => [date.getFullYear(),date.getMonth()+1,date.getDate()].join('-');
const today = localDay(now);
const skip = /(?:^|\s)--no-harvest(?:\s|$)/.test(event.prompt);
let active = false;
try { active = inHours(readSchedule(),now); } catch { /* Invalid schedules suppress automatic checks. */ }

function claim(path,value = '') {
  try { writeFileSync(path,value,{flag:'wx',mode:0o600}); return true; }
  catch (error) { if (error.code === 'EEXIST') return false; throw error; }
}

if (process.env.PLUGIN_DATA && event.session_id) {
  const folder = join(process.env.PLUGIN_DATA,'seen-chats');
  mkdirSync(folder,{recursive:true,mode:0o700});
  const key = createHash('sha256').update(event.session_id).digest('hex');
  const chat = join(folder,key);
  if (!claim(chat,skip ? 'opt-out' : 'enabled')) {
    const opening = readFileSync(chat,'utf8');
    if (opening === 'opt-out') process.exit(0);
    // Prior releases recorded the opening day in the empty marker's modification time.
    if (opening === '' && localDay(statSync(chat).mtime) === today) process.exit(0);
  }
  if (skip || !claim(chat+'.'+today+(active ? '.card' : '.outside'))) process.exit(0);
} else if (skip) process.exit(0);

const additionalContext = active
  ? 'Harvest Live daily check for '+today+' (local date). On this first in-hours message today in this root chat, open one fresh editable Harvest card using the harvest-live skill, including when resuming after Start, Switch or Dismiss on an earlier day. Skip if the opening message opted out with standalone --no-harvest or a card was already offered today. Read the current account, assignments and timer. Suggest the work being resumed from the current request and chat. If setup is needed, pass the same description and project/task hints to show_account. Continue the main request immediately. Only the card can authorize a timer change.'
  : 'Harvest Live is outside configured working hours or disabled. Skip the entire automatic Harvest check. A later message within working hours can trigger today’s card.';
console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'UserPromptSubmit',additionalContext}}));
