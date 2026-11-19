/*
 * Ouroboros — calling a model in the background.
 * Each role (Scout, Architect) uses 'main' (SillyTavern's current API) or a Connection Manager
 * profile id. If the profile is gone, it falls back to 'main'.
 */

import { looksLikeRefusal } from './lib.js';

const ctx = () => SillyTavern.getContext();
const LOG = '[Ouroboros]';

export function profiles() {
    try { return ctx().ConnectionManagerRequestService?.getSupportedProfiles?.() ?? []; } catch { return []; }
}
export function sourceLabel(id) {
    if (!id || id === 'main') return 'API หลักของ ST';
    const p = profiles().find(x => x.id === id);
    return p ? p.name : '(profile ที่ถูกลบไปแล้ว)';
}
function resolve(id) {
    if (!id || id === 'main') return 'main';
    return profiles().some(p => p.id === id) ? id : 'main';
}

// ---------------------------------------------------------------- usage today (this device)

const USAGE_KEY = 'ouroboros_usage';
const today = () => new Date().toLocaleDateString('sv'); // YYYY-MM-DD, local time
/** @returns {{date:string, roles:Record<string,{calls:number, fails:number, inChars:number, outChars:number}>}} */
export function usageToday() {
    try {
        const u = JSON.parse(localStorage.getItem(USAGE_KEY) ?? 'null');
        if (u && u.date === today() && u.roles) return u;
    } catch { /* ignore */ }
    return { date: today(), roles: {} };
}
function countUsage(role, inChars, outChars, failed) {
    const u = usageToday();
    const r = u.roles[role] ??= { calls: 0, fails: 0, inChars: 0, outChars: 0 };
    r.calls++;
    if (failed) r.fails++;
    r.inChars += inChars;
    r.outChars += outChars;
    try { localStorage.setItem(USAGE_KEY, JSON.stringify(u)); } catch { /* ignore */ }
}

async function callOne(src, messages, maxTokens, timeoutMs, signal) {
    const c = ctx();
    if (signal?.aborted) throw new Error('หยุดแล้ว');
    if (src === 'main') {
        let timer;
        const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`ไม่ตอบภายใน ${timeoutMs / 1000} วินาที`)), timeoutMs); });
        const stop = new Promise((_, rej) => signal?.addEventListener('abort', () => rej(new Error('หยุดแล้ว')), { once: true }));
        try {
            return await Promise.race([c.generateRaw({ prompt: structuredClone(messages), responseLength: maxTokens }), timeout, stop]);
        } finally { clearTimeout(timer); }
    }
    const svc = c.ConnectionManagerRequestService;
    if (!svc) throw new Error('Connection Manager ไม่พร้อมใช้งาน');
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    signal?.addEventListener('abort', () => ac.abort(), { once: true });
    try {
        const res = await svc.sendRequest(src, structuredClone(messages), maxTokens, { stream: false, signal: ac.signal, extractData: true, includePreset: true });
        return typeof res === 'string' ? res : String(res?.content ?? '');
    } catch (e) {
        if (signal?.aborted) throw new Error('หยุดแล้ว');
        if (ac.signal.aborted) throw new Error(`ไม่ตอบภายใน ${timeoutMs / 1000} วินาที`);
        throw e;
    } finally { clearTimeout(timer); }
}

/**
 * Ask the model. `accept(out)` returns the parsed value or throws when the answer is unusable.
 * The main API gets two tries; a refusal or an empty answer skips straight to the backup (if one is set),
 * which gets two tries of its own.
 * @template T
 * @param {{role?:string, source:string, backup?:string, system:string, user:string, maxTokens:number, timeoutSec:number, accept:(out:string)=>T, signal?:AbortSignal}} o
 * @returns {Promise<{value:T, label:string, ms:number, usedBackup:boolean}>}
 */
export async function ask({ role = 'other', source, backup = '', system, user, maxTokens, timeoutSec, accept, signal }) {
    const main = resolve(source);
    const chain = [main];
    if (backup && backup !== 'none') {
        const b = resolve(backup);
        if (b !== main) chain.push(b);
    }
    const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
    const inChars = system.length + user.length;
    const errors = [];
    for (const [i, src] of chain.entries()) {
        const label = sourceLabel(src);
        for (let attempt = 0; attempt < 2; attempt++) {
            const t0 = Date.now();
            let out = '';
            try {
                out = String(await callOne(src, messages, maxTokens, timeoutSec * 1000, signal) ?? '');
                if (!out.trim()) throw Object.assign(new Error('ได้คำตอบว่าง (อาจโดน safety filter, โควต้าหมด หรือโมเดลคิดจนหมดโควต้าคำตอบ)'), { skip: true });
                if (looksLikeRefusal(out)) throw Object.assign(new Error('โมเดลปฏิเสธ (กำแพงศีลธรรมของโมเดล)'), { skip: true });
                const value = accept(out);
                countUsage(role, inChars, out.length, false);
                return { value, label, ms: Date.now() - t0, usedBackup: i > 0 };
            } catch (e) {
                countUsage(role, inChars, out.length, true);
                if (signal?.aborted) throw new Error('หยุดแล้ว');
                console.warn(LOG, `${label} attempt ${attempt + 1} failed`, e);
                if (attempt === 1 || (e.skip && chain.length > i + 1)) { errors.push(`${label}: ${e?.message ?? e}`); break; }
            }
        }
    }
    throw new Error(errors.join(' · '));
}
