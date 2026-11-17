import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { inHours, readSchedule } from '../schedule.mjs';

const event = JSON.parse(readFileSync(0, 'utf8'));
if (event.hook_event_name !== 'UserPromptSubmit' || !event.prompt?.trim() || event.agent_id) process.exit(0);
// Claim the opening prompt even if it opts out. Keep only a hash of the session ID.
if (process.env.PLUGIN_DATA && event.session_id) {
  const folder = join(process.env.PLUGIN_DATA, 'seen-chats');
  const key = createHash('sha256').update(event.session_id).digest('hex');
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  try { writeFileSync(join(folder, key), '', {flag:'wx', mode:0o600}); }
  catch (error) { if (error.code === 'EEXIST') process.exit(0); throw error; }
}
if (!/(?:^|\s)--no-harvest(?:\s|$)/.test(event.prompt)) {
  let active = false;
  try { active = inHours(readSchedule()); } catch { /* Unreadable settings suppress automatic prompts. */ }
  console.log(JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext: !active ? 'Harvest Live is outside configured working hours or disabled. Skip the entire automatic Harvest check, including personal fallback questions. Continue the substantive request silently.' : 'During configured working hours, on the first substantive prompt of a new root chat, use the harvest-live skill and show_timer tool for one editable Harvest card, then immediately continue the main request. The card replaces the Harvest multiple-choice prompt when available. Do not show both. Skip delegated work, follow-ups, confirmations, resumed chats, and chats opened with the standalone --no-harvest flag. If the card cannot be shown, follow any personal Harvest fallback instructions. This hook never authorizes a timer change.'
  }}));
}
