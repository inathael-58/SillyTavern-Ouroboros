/*
 * Ouroboros — calling a model in the background.
 * Each role (Scout, Architect) uses 'main' (SillyTavern's current API) or a Connection Manager
 * profile id. If the profile is gone, it falls back to 'main'.
 */

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
 * Ask the model. `accept(out)` returns the parsed value or throws when the answer is unusable;
 * one retry on the same API, then the error goes up.
 * @template T
 * @param {{source:string, system:string, user:string, maxTokens:number, timeoutSec:number, accept:(out:string)=>T, signal?:AbortSignal}} o
 * @returns {Promise<{value:T, label:string, ms:number}>}
 */
export async function ask({ source, system, user, maxTokens, timeoutSec, accept, signal }) {
    const src = resolve(source);
    const label = sourceLabel(src);
    const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
        const t0 = Date.now();
        try {
            const out = String(await callOne(src, messages, maxTokens, timeoutSec * 1000, signal) ?? '');
            if (!out.trim()) throw new Error('ได้คำตอบว่าง (อาจโดน safety filter หรือโควต้าหมด)');
            return { value: accept(out), label, ms: Date.now() - t0 };
        } catch (e) {
            if (signal?.aborted) throw new Error('หยุดแล้ว');
            console.warn(LOG, `${label} attempt ${attempt + 1} failed`, e);
            lastErr = e;
        }
    }
    throw new Error(`${label}: ${lastErr?.message ?? lastErr}`);
}
