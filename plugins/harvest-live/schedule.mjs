import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const path = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'harvest-live', 'schedule.json');
export const days = {'weekdays':[1,2,3,4,5], 'mon-sat':[1,2,3,4,5,6], 'every-day':[0,1,2,3,4,5,6], 'never':[]};
const defaults = {days:'weekdays',start:'09:00',end:'18:00'};
export function validateSchedule(s) {
  const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!s || !Object.hasOwn(days,s.days) || !clock.test(s.start) || !(clock.test(s.end) || s.end === '24:00') || s.start >= s.end)
    throw new Error('Choose working days and an end time later than the start. Use HH:MM.');
  return {days:s.days,start:s.start,end:s.end};
}
export function readSchedule() {
  try { return validateSchedule(JSON.parse(readFileSync(path, 'utf8'))); }
  catch (err) { if (err.code === 'ENOENT') return {...defaults}; throw err; }
}
export function saveSchedule(input) {
  const value = validateSchedule(input);
  mkdirSync(dirname(path), {recursive:true, mode:0o700});
  const tmp = path+'.'+randomUUID();
  writeFileSync(tmp, JSON.stringify(value)+'\n',{mode:0o600, flag:'wx'});
  renameSync(tmp,path);
  return value;
}
export function inHours(s, now = new Date()) {
  const minutes = now.getHours()*60+now.getMinutes();
  const [sh,sm] = s.start.split(':').map(Number), [eh,em] = s.end.split(':').map(Number);
  return days[s.days].includes(now.getDay()) && minutes >= sh*60+sm && minutes < eh*60+em;
}
