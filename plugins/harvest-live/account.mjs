import { generateKeyPairSync, privateDecrypt, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const directory = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'harvest-live');
const metadata = join(directory, 'account.json');
const service = 'software.tdebooij.codex.harvest-live';
let keys;

// Only ciphertext traverses the MCP bridge. The private key lives in this server process.
export function wrappingKey() {
  keys ??= generateKeyPairSync('rsa', { modulusLength: 3072 });
  return keys.publicKey.export({format:'jwk'});
}
export function unwrap(ciphertext) {
  try {
    if (!keys || typeof ciphertext !== 'string' || ciphertext.length !== 512) throw new Error();
    const value = privateDecrypt({key:keys.privateKey,oaepHash:'sha256'},Buffer.from(ciphertext,'base64')).toString('utf8');
    if (!/^[\x21-\x7e]{1,300}$/.test(value)) throw new Error();
    return value;
  } catch { throw new Error('Could not read the token. Paste it again and retry.'); }
}

function vault(action, ref, token) {
  if (!/^[a-f0-9-]{36}$/.test(ref)) throw new Error('Invalid local connection.');
  if (process.platform === 'darwin') {
    const common = ['-s',service,'-a',ref];
    const args = action === 'store' ? ['-i'] : [action === 'get' ? 'find-generic-password' : 'delete-generic-password',...common,...(action === 'get' ? ['-w'] : [])];
    // Interactive mode keeps the secret off argv. Base64 restricts the command to a single safe word.
    const input = action === 'store' ? 'add-generic-password '+common.join(' ')+' -w '+Buffer.from(token).toString('base64')+'\n' : '';
    const res = spawnSync('/usr/bin/security',args,{input,encoding:'utf8',timeout:30000});
    if (res.error || res.status !== 0) throw new Error('Could not access macOS Keychain. Unlock it and try again.');
    if (action === 'get') return Buffer.from(res.stdout.trim(),'base64').toString();
    return;
  }
  const path = join(directory,ref+'.credential');
  if (action === 'erase') { unlinkSync(path); return; }
  let value = action === 'get' ? readFileSync(path,'utf8') : token;
  if (process.platform === 'win32') {
    const method = action === 'get' ? 'Unprotect' : 'Protect';
    const source = action === 'get' ? '[Convert]::FromBase64String($value)' : '[Text.Encoding]::UTF8.GetBytes($value)';
    const convert = action === 'get' ? '[Text.Encoding]::UTF8.GetString($bytes)' : '[Convert]::ToBase64String($bytes)';
    const script = "$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$value=[Console]::In.ReadToEnd();$bytes=[Security.Cryptography.ProtectedData]::"+method+'('+source+', $null, [Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Write('+convert+')';
    const res = spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{input:value,encoding:'utf8',timeout:10000,windowsHide:true});
    if (res.error || res.status !== 0) throw new Error('Windows could not access your protected token.');
    value = res.stdout;
  }
  if (action === 'get') return value;
  writeFileSync(path,value,{flag:'wx',mode:0o600});
}
export function currentAccount() {
  try { return JSON.parse(readFileSync(metadata,'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error('Could not read the local account settings.'); }
}
export function checkAccount(ref) {
  const account = currentAccount();
  if ((account?.ref ?? null) !== ref) throw new Error('The connected account changed. Reopen Harvest Live and review it.');
  return account;
}
export function credential(account) { return vault('get',account.ref); }
export function saveAccount(expected, workspace, user, token) {
  const previous = checkAccount(expected);
  const account = {ref:randomUUID(),accountId:workspace.id,workspace:workspace.name,userId:user.id,name:[user.first_name,user.last_name].filter(Boolean).join(' ')};
  mkdirSync(directory,{recursive:true,mode:0o700});
  vault('store',account.ref,token);
  try {
    if (credential(account) !== token) throw new Error('Could not verify secure token storage.');
    const temp = metadata+'.'+account.ref;
    writeFileSync(temp,JSON.stringify(account),{mode:0o600,flag:'wx'});
    checkAccount(expected);
    renameSync(temp,metadata);
  } catch (error) { vault('erase',account.ref); throw error; }
  if (previous) {
    try { vault('erase',previous.ref); }
    catch { throw new Error('The new account was saved, but cleanup of the old credential failed. Reopen the card and revoke the old token on Harvest.'); }
  }
  return account;
}
export function forgetAccount(ref) {
  const account = checkAccount(ref);
  if (account) { vault('erase',ref); unlinkSync(metadata); }
}

// Codex may launch a separate server per chat. Serialize account changes and timer switches.
export async function withAccountLock(operation) {
  mkdirSync(directory,{recursive:true,mode:0o700});
  const lock = join(directory,'account-operation.lock');
  try { writeFileSync(lock,String(process.pid),{flag:'wx',mode:0o600}); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new Error('Another Harvest operation is in progress. If the plugin exited unexpectedly, see lock recovery in the README.');
  }
  try { return await operation(); } finally { unlinkSync(lock); }
}
