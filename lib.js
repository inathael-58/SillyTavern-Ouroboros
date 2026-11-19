/*
 * Ouroboros — pure logic (no DOM, no SillyTavern). Tested with `npm test`.
 *
 * State lives in chat_metadata.ouroboros (see docs/SPEC.md). Everything here takes the
 * state and the chat array and returns values or mutates the state in place; the caller saves.
 */

export const STATE_VERSION = 1;

// ---------------------------------------------------------------- plan sizes

/**
 * target: visible messages for the whole story (epic: per arc)
 * fates: how many fates live at once per layer
 * lockMain / lockArc: progress (0–1) at which a layer locks (epic main: on finale)
 * arcs: number of arcs (0 = single act, Infinity = open-ended)
 * every: default Architect cadence, in bot messages
 */
export const SIZES = Object.freeze({
    short: { label: 'สั้น', target: 60, fates: { main: 2 }, lockMain: 0.5, arcs: 0, every: 6, range: '40–80 ข้อความ' },
    medium: { label: 'กลาง', target: 150, fates: { main: 3 }, lockMain: 0.6, arcs: 0, every: 8, range: '100–200 ข้อความ' },
    long: { label: 'ยาว', target: 380, fates: { main: 3, arc: 2 }, lockMain: 0.7, lockArc: 0.6, arcs: 3, every: 10, range: '250–500 ข้อความ' },
    epic: { label: 'มหากาพย์', target: 150, fates: { main: 3, arc: 2 }, lockMain: 0.5, lockArc: 0.6, arcs: Infinity, every: 12, range: '500+ ไม่จำกัด' },
});
export const SIZE_IDS = Object.keys(SIZES);
export const sizeOf = id => SIZES[id] ?? SIZES.medium;

/** Fates may still be born until this much of the layer has passed (or when none are alive). */
export const SPAWN_UNTIL = 0.45;

// ---------------------------------------------------------------- phases

export const PHASES = Object.freeze([
    { id: 'setup', label: 'ปูเรื่อง', from: 0, guide: 'Setup: establish the world, the characters and small mysteries. Plant details; explain nothing.' },
    { id: 'rising', label: 'ไต่ระดับ', from: 0.15, guide: 'Rising action: raise the pressure, add complications, deepen the mysteries. No big reveals yet.' },
    { id: 'midpoint', label: 'จุดเปลี่ยน', from: 0.45, guide: 'Midpoint: a turn that changes how things look. A partial revelation is fine.' },
    { id: 'crisis', label: 'วิกฤต', from: 0.55, guide: 'Crisis: stakes peak and things go wrong. Pull the threads tighter toward the truth.' },
    { id: 'climax', label: 'ไคลแมกซ์', from: 0.75, guide: 'Climax: the confrontation. Pay off the planted threads; the truth comes out.' },
    { id: 'resolution', label: 'คลี่คลาย', from: 0.9, guide: 'Resolution: the aftermath. Close the remaining threads and echo the beginning.' },
]);
export const PHASE_IDS = PHASES.map(p => p.id);
export const phaseInfo = id => PHASES.find(p => p.id === id) ?? PHASES[0];
export const phaseIndex = id => Math.max(0, PHASE_IDS.indexOf(id));

/** Phase for a progress value (0–1+), with the Architect's pacing shift (−0.1…0.1). */
export function phaseAt(progress, shift = 0) {
    const p = Math.max(0, Number(progress) || 0) - clamp(Number(shift) || 0, -0.1, 0.1);
    let cur = PHASES[0];
    for (const ph of PHASES) if (p >= ph.from) cur = ph;
    return cur.id;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------- tropes and moods

export const TROPES = Object.freeze({
    'ปริศนา': ['ห้องปิดตาย', 'ตัวตนที่ซ่อนไว้', 'พยานที่โกหก', 'จดหมายจากคนตาย', 'คนร้ายอยู่ใกล้ตัว', 'ความจำที่หายไป'],
    'ความสัมพันธ์': ['ศัตรูกลายเป็นคนรัก', 'แต่งงานตามสัญญา', 'รักต้องห้าม', 'เพื่อนสมัยเด็กกลับมา', 'ความลับระหว่างพี่น้อง', 'ความเข้าใจผิดครั้งใหญ่'],
    'การเดินทาง': ['ผู้ถูกเลือกที่ไม่อยากถูกเลือก', 'แผนที่ที่ไม่ครบ', 'เพื่อนร่วมทางมีวาระซ่อนเร้น', 'กลับบ้านที่ไม่เหมือนเดิม', 'การแข่งขันกับเวลา'],
    'ดาร์ก': ['การทรยศจากคนใกล้ตัว', 'ราคาของพลัง', 'ผู้ช่วยคือคนบงการ', 'ไม่มีใครบริสุทธิ์', 'ชัยชนะที่ต้องเสียบางอย่าง'],
    'แฟนตาซี': ['คำสาปที่มีราคา', 'วนลูปเวลา', 'คำทำนายที่ตีความผิด', 'เทพที่ถูกลืม', 'สายเลือดที่ถูกซ่อน'],
});
export const TROPE_CATEGORIES = Object.keys(TROPES);
export const MOODS = Object.freeze(['มืด', 'มีหวัง', 'โศก', 'อบอุ่น', 'หักมุมแรง', 'ลึกลับ', 'โรแมนติก', 'ตลก']);

/** Pick n secret tropes from the chosen categories (rand injectable for tests). */
export function pickSecretTropes(categories, n = 2, rand = Math.random) {
    const pool = [];
    for (const c of categories ?? []) for (const t of TROPES[c] ?? []) pool.push({ cat: c, trope: t });
    const out = [];
    while (pool.length && out.length < n) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
    return out;
}

// ---------------------------------------------------------------- seeds

export const SEED_KINDS = Object.freeze({
    object: { label: 'ของ', icon: 'fa-key' },
    person: { label: 'คน', icon: 'fa-user' },
    secret: { label: 'ความลับ', icon: 'fa-eye-slash' },
    promise: { label: 'คำสัญญา', icon: 'fa-handshake' },
    question: { label: 'คำถาม', icon: 'fa-circle-question' },
    place: { label: 'สถานที่', icon: 'fa-location-dot' },
    wound: { label: 'ปมในใจ', icon: 'fa-heart-crack' },
});
export const normKind = k => (SEED_KINDS[k] ? k : 'question');

// ---------------------------------------------------------------- state

/**
 * @param {{size?:string, premise?:string, tropes?:string[], secretCats?:string[], moods?:string[], startedAt?:number, owner?:object}} o
 */
export function newState(o = {}, rand = Math.random) {
    const secretCats = (o.secretCats ?? []).filter(c => TROPES[c]);
    return {
        version: STATE_VERSION,
        owner: o.owner ?? {},
        size: SIZES[o.size] ? o.size : 'medium',
        premise: String(o.premise ?? '').trim(),
        tropes: [...new Set((o.tropes ?? []).map(t => String(t).trim()).filter(Boolean))],
        secretTropes: secretCats.length ? { categories: secretCats, picked: pickSecretTropes(secretCats, 2, rand), peek: 0 } : null,
        moods: (o.moods ?? []).filter(m => MOODS.includes(m)),
        startedAt: Math.max(0, Number(o.startedAt) || 0),
        cycle: 1,
        past: [],
        arc: { index: 1, startedAt: Math.max(0, Number(o.startedAt) || 0), summaries: [] },
        seeds: [],
        fates: [],
        nextSeed: 1,
        beat: '',
        focus: [],
        secrets: [],
        shift: 0,
        finale: false,
        ended: false,
        lastArchitectAt: -1,
        lastScoutAt: -1,
        cutPending: false,
        history: [],
    };
}

/** Fill in fields a state from an older version may lack. Returns the same object. */
export function normalizeState(st) {
    if (!st || typeof st !== 'object') return null;
    const d = newState({ size: st.size, startedAt: st.startedAt });
    for (const [k, v] of Object.entries(d)) if (st[k] === undefined) st[k] = v;
    if (!Array.isArray(st.seeds)) st.seeds = [];
    if (!Array.isArray(st.fates)) st.fates = [];
    if (!st.arc || typeof st.arc !== 'object') st.arc = d.arc;
    if (!Array.isArray(st.arc.summaries)) st.arc.summaries = [];
    if (!Array.isArray(st.history)) st.history = [];
    if (!Array.isArray(st.past)) st.past = [];
    return st;
}

const visible = m => m && !m.is_system;

/** Visible messages with index >= from. */
export function countVisible(chat, from = 0) {
    let n = 0;
    for (let i = Math.max(0, from); i < (chat?.length ?? 0); i++) if (visible(chat[i])) n++;
    return n;
}
/** Visible bot messages with index > after. */
export function countBotSince(chat, after = -1) {
    let n = 0;
    for (let i = Math.max(0, after + 1); i < (chat?.length ?? 0); i++) if (visible(chat[i]) && !chat[i].is_user) n++;
    return n;
}

/**
 * Where the story stands.
 * @returns {{main:number, arc:number|null, mainPhase:string, arcPhase:string|null, phase:string, arcLen:number|null, done:boolean}}
 */
export function progressOf(st, chat) {
    const size = sizeOf(st.size);
    const count = countVisible(chat, st.startedAt) + (Number(st.offset) || 0);
    const floor = Number(st.progressFloor) || 0;
    if (!size.arcs) {
        const main = Math.max(count / size.target, floor);
        const ph = phaseAt(main, st.shift);
        return { main, arc: null, mainPhase: ph, arcPhase: null, phase: ph, arcLen: null, done: main >= 1 };
    }
    const arcLen = size.arcs === Infinity ? size.target : Math.round(size.target / size.arcs);
    let arc = Math.max((countVisible(chat, st.arc.startedAt) + (Number(st.arc.offset) || 0)) / arcLen, st.arcFloor || 0);
    let main;
    let mainPhase;
    if (size.arcs === Infinity) {
        if (st.finale) {
            main = Math.max(0.5 + arc / 2, floor); // the final arc carries the main story from its midpoint to the end
            mainPhase = phaseAt(main, st.shift);
        } else {
            main = Math.min(0.44, floor || (st.arc.index === 1 ? arc * 0.15 : 0.3));
            mainPhase = st.arc.index === 1 && arc < 1 ? 'setup' : 'rising';
        }
    } else {
        main = Math.max(count / size.target, floor);
        mainPhase = phaseAt(main, st.shift);
        if (st.arc.index >= size.arcs) arc = Math.max(arc, main >= 1 ? 1 : arc);
    }
    const arcPhase = phaseAt(arc, st.shift);
    const done = size.arcs === Infinity ? !!st.finale && arc >= 1 : main >= 1;
    return { main, arc, mainPhase, arcPhase, phase: arcPhase, arcLen, done };
}

/** Progress at which the given layer locks, or null if it waits for a button (epic main before finale). */
export function lockPoint(st, layer) {
    const size = sizeOf(st.size);
    if (layer === 'arc') return size.lockArc ?? null;
    if (size.arcs === Infinity) return st.finale ? 0.5 : null; // epic: main locks halfway through the final arc
    return size.lockMain;
}

/** Progress value used for a layer's lock and spawn decisions. */
export function layerProgress(st, prog, layer) {
    const size = sizeOf(st.size);
    if (layer === 'arc') return prog.arc ?? 0;
    if (size.arcs === Infinity) return st.finale ? prog.arc ?? 0 : 0;
    return prog.main;
}

export const layers = st => Object.keys(sizeOf(st.size).fates);
export const alive = (st, layer) => st.fates.filter(f => f.status === 'alive' && (!layer || f.layer === layer));
export const lockedFate = (st, layer) => st.fates.find(f => f.status === 'locked' && f.layer === layer) ?? null;

/** How many new fates the Architect may add to a layer right now. */
export function spawnRoom(st, prog, layer) {
    if (lockedFate(st, layer)) return 0;
    const want = sizeOf(st.size).fates[layer] ?? 0;
    const have = alive(st, layer).length;
    if (have >= want) return 0;
    if (have === 0 || st.cutPending) return want - have;
    return layerProgress(st, prog, layer) < SPAWN_UNTIL ? want - have : 0;
}

// ---------------------------------------------------------------- seeds vs swipes

/** Is the message (and swipe) that produced this still the one on screen? */
export function onScreen(chat, ref) {
    if (!ref || !Number.isInteger(ref.msgId)) return true; // added by the user, or carried from an earlier chat
    const m = chat?.[ref.msgId];
    if (!m) return false;
    const cur = Number.isInteger(m.swipe_id) ? m.swipe_id : 0;
    return (ref.swipeId ?? 0) === cur;
}

/**
 * Seeds as they stand on screen now: dormant (from a swiped-away reply) ones left out,
 * paid seeds whose payoff was swiped away count as open again.
 */
export function liveSeeds(st, chat) {
    const out = [];
    for (const s of st.seeds) {
        if (s.status === 'dropped') continue;
        if (!onScreen(chat, s)) continue;
        const paid = s.status === 'paid' && onScreen(chat, s.paidBy);
        out.push({ ...s, status: paid ? 'paid' : 'open' });
    }
    return out;
}

/** Remove seeds and payoffs that point past the end of the chat (deleted messages, branches). */
export function trimToChat(st, chat) {
    const len = chat?.length ?? 0;
    const before = st.seeds.length;
    st.seeds = st.seeds.filter(s => !Number.isInteger(s.msgId) || s.msgId < len);
    for (const s of st.seeds) {
        if (s.status === 'paid' && s.paidBy && Number.isInteger(s.paidBy.msgId) && s.paidBy.msgId >= len) {
            s.status = 'open';
            s.paidBy = null;
        }
    }
    return before - st.seeds.length;
}

const normText = t => String(t ?? '').toLowerCase().replace(/[\s"'“”‘’.,!?…:;()\-–—]+/g, '');

/** Add seeds found by the Scout. Skips near-duplicates. Returns the added seeds. */
export function addSeeds(st, items, ref, phase) {
    const known = new Set(st.seeds.filter(s => s.status !== 'dropped').map(s => normText(s.text)));
    const added = [];
    for (const it of items ?? []) {
        const text = String(it?.text ?? '').trim().slice(0, 240);
        const key = normText(text);
        if (!text || key.length < 3 || known.has(key)) continue;
        known.add(key);
        const seed = {
            id: 's' + st.nextSeed++,
            text,
            kind: normKind(it.kind),
            msgId: ref?.msgId ?? null,
            swipeId: ref?.swipeId ?? 0,
            phase: phase ?? 'setup',
            fates: [],
            status: 'open',
            paidBy: null,
            user: !!ref?.user,
        };
        st.seeds.push(seed);
        added.push(seed);
    }
    return added;
}

/** Mark seeds as paid off by the message ref. Only open, on-screen seeds count. */
export function paySeeds(st, chat, ids, ref) {
    const set = new Set((ids ?? []).map(String));
    let n = 0;
    for (const s of st.seeds) {
        if (!set.has(s.id) || s.status !== 'open' || !onScreen(chat, s)) continue;
        if (Number.isInteger(ref?.msgId) && Number.isInteger(s.msgId) && s.msgId >= ref.msgId) continue; // can't pay off in the same reply
        s.status = 'paid';
        s.paidBy = ref ? { msgId: ref.msgId, swipeId: ref.swipeId ?? 0 } : null;
        n++;
    }
    return n;
}

// ---------------------------------------------------------------- fates

const FATE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** Next unused fate id (A, B, C … then A2, B2 …). */
export function nextFateId(st) {
    const used = new Set(st.fates.map(f => f.id));
    for (let round = 1; ; round++) {
        for (const ch of FATE_LETTERS) {
            const id = round === 1 ? ch : ch + round;
            if (!used.has(id)) return id;
        }
    }
}

const strList = (v, max = 6) => (Array.isArray(v) ? v : v ? [v] : []).map(x => String(x ?? '').trim()).filter(Boolean).slice(0, max);
const str = (v, max = 600) => String(v ?? '').trim().slice(0, max);

/** Mark a fate pruned and turn seeds that only it used into red herrings. */
export function pruneFate(st, fate, at, reason) {
    fate.status = 'pruned';
    fate.prunedAt = at;
    fate.pruneReason = str(reason, 200);
    markHerrings(st);
    st.history.push({ at, event: 'pruned', fate: fate.id });
}

/** A seed whose fates are all pruned becomes a red herring (shown as open to the user). */
export function markHerrings(st) {
    const status = new Map(st.fates.map(f => [f.id, f.status]));
    for (const s of st.seeds) {
        if (!s.fates?.length) continue;
        s.herring = s.fates.every(id => status.get(id) === 'pruned');
    }
}

/**
 * Apply one Architect answer.
 * @param {object} st state
 * @param {object} out parsed JSON from the Architect
 * @param {{at:number, prog:object}} o at = chat length when asked
 * @returns {{added:string[], pruned:string[], locked:string[], changed:boolean}}
 */
export function applyArchitect(st, out, { at, prog }) {
    const res = { added: [], pruned: [], locked: [], changed: false };
    if (!out || typeof out !== 'object') return res;
    const lays = layers(st);
    const room = Object.fromEntries(lays.map(l => [l, spawnRoom(st, prog, l)]));

    for (const raw of Array.isArray(out.fates) ? out.fates : []) {
        if (!raw || typeof raw !== 'object') continue;
        const layer = lays.includes(raw.layer) ? raw.layer : lays[0];
        const fate = st.fates.find(f => f.id === String(raw.id ?? '') && f.status !== 'pruned');
        if (fate) {
            // update an existing fate; a locked fate keeps its truth
            if (fate.status !== 'locked' && raw.truth) fate.truth = str(raw.truth);
            if (raw.twists) fate.twists = strList(raw.twists, 4);
            if (raw.ending) fate.ending = str(raw.ending);
            if (raw.scent) fate.scent = str(raw.scent, 40);
            if (raw.shadow) fate.shadow = str(raw.shadow, 200);
            if (raw.needs) fate.needs = strList(raw.needs, 12);
            if (Number.isFinite(Number(raw.score))) fate.score = clamp(Math.round(Number(raw.score)), 0, 100);
            fate.lowStreak = fate.score < 25 ? (fate.lowStreak ?? 0) + 1 : 0;
            if (fate.status === 'alive') {
                const others = alive(st, fate.layer).filter(f => f !== fate).length;
                if (others > 0 && (raw.contradicted === true || fate.lowStreak >= 2)) {
                    pruneFate(st, fate, at, raw.reason || (raw.contradicted ? 'ขัดกับเรื่องที่เกิดขึ้นจริง' : 'คะแนนต่ำติดกัน'));
                    res.pruned.push(fate.id);
                }
            }
            res.changed = true;
            continue;
        }
        if (!raw.truth || room[layer] <= 0) continue;
        room[layer]--;
        const id = nextFateId(st);
        st.fates.push({
            id, layer,
            arc: layer === 'arc' ? st.arc.index : null,
            cycle: st.cycle,
            truth: str(raw.truth), twists: strList(raw.twists, 4), ending: str(raw.ending),
            scent: str(raw.scent, 40), shadow: str(raw.shadow, 200), needs: strList(raw.needs, 12),
            score: Number.isFinite(Number(raw.score)) ? clamp(Math.round(Number(raw.score)), 0, 100) : 50,
            lowStreak: 0, status: 'alive', bornAt: at, prunedAt: null, pruneReason: '', lockedAt: null, peek: 0,
        });
        // the Architect may refer to its new fate by the id it proposed
        if (raw.id && String(raw.id) !== id) remapFateId(out, String(raw.id), id);
        res.added.push(id);
        res.changed = true;
    }
    if (res.added.length) st.cutPending = false;

    // seed ↔ fate links
    const fateIds = new Set(st.fates.filter(f => f.status !== 'pruned').map(f => f.id));
    if (out.seedFates && typeof out.seedFates === 'object') {
        for (const [sid, ids] of Object.entries(out.seedFates)) {
            const s = st.seeds.find(x => x.id === sid);
            if (s) { s.fates = strList(ids, 8).filter(id => fateIds.has(id) || st.fates.some(f => f.id === id)); res.changed = true; }
        }
    }
    for (const f of st.fates) {
        if (f.status === 'pruned') continue;
        for (const sid of f.needs ?? []) {
            const s = st.seeds.find(x => x.id === sid);
            if (s && !s.fates.includes(f.id)) s.fates.push(f.id);
        }
    }
    markHerrings(st);

    // locking
    for (const layer of lays) {
        const r = lockIfDue(st, prog, layer, at);
        if (r) res.locked.push(r);
    }

    if (typeof out.beat === 'string') st.beat = str(out.beat, 400);
    if (Array.isArray(out.focus)) st.focus = strList(out.focus, 3).filter(id => st.seeds.some(s => s.id === id));
    if (Array.isArray(out.secrets)) st.secrets = normSecrets(out.secrets, lays);
    if (out.pace === 'slower') st.shift = clamp((st.shift || 0) + 0.05, -0.1, 0.1);
    else if (out.pace === 'faster') st.shift = clamp((st.shift || 0) - 0.05, -0.1, 0.1);
    if (typeof out.arcSummary === 'string' && out.arcSummary.trim()) st.arcSummaryDraft = str(out.arcSummary, 600);
    st.lastArchitectAt = at;
    return res;
}

/** Secrets as [{text, layer}]; plain strings count as the main story's. */
export function normSecrets(list, lays = ['main']) {
    return (Array.isArray(list) ? list : [])
        .map(x => (typeof x === 'string' ? { text: x, layer: 'main' } : { text: x?.text, layer: x?.layer }))
        .map(x => ({ text: str(x.text, 300), layer: lays.includes(x.layer) ? x.layer : 'main' }))
        .filter(x => x.text)
        .slice(0, 6);
}

function remapFateId(out, from, to) {
    if (out.seedFates) for (const k of Object.keys(out.seedFates)) {
        out.seedFates[k] = strList(out.seedFates[k], 8).map(x => (x === from ? to : x));
    }
}

/** Lock a layer when its lock point has passed (or when only one fate is left after the spawn window). */
export function lockIfDue(st, prog, layer, at) {
    if (lockedFate(st, layer)) return null;
    const live = alive(st, layer);
    if (!live.length) return null;
    const point = lockPoint(st, layer);
    const p = layerProgress(st, prog, layer);
    const due = point != null && p >= point;
    const lastOne = live.length === 1 && p >= SPAWN_UNTIL && !st.cutPending;
    if (!due && !lastOne) return null;
    const best = [...live].sort((a, b) => (b.score - a.score) || (a.bornAt - b.bornAt))[0];
    best.status = 'locked';
    best.lockedAt = at;
    for (const f of live) if (f !== best) pruneFate(st, f, at, 'อีกชะตาถูกเลือกเป็นความจริง');
    st.history.push({ at, event: 'locked', fate: best.id });
    return best.id;
}

/** "ตัดด้าย": throw away every unlocked fate; the Architect writes new ones next. */
export function cutThreads(st, at) {
    const live = alive(st);
    for (const f of live) pruneFate(st, f, at, 'ตัดด้าย (ผู้เล่นขอชะตาใหม่)');
    if (live.length) st.cutPending = true;
    return live.length;
}

/** Fates locked at or after this chat length are unlocked (the chat was rewound before the lock). */
export function lockedPastChat(st, chat) {
    const len = chat?.length ?? 0;
    return st.fates.filter(f => f.status === 'locked' && Number.isInteger(f.lockedAt) && f.lockedAt > len);
}
export function unlockFate(st, id) {
    const f = st.fates.find(x => x.id === id && x.status === 'locked');
    if (!f) return false;
    f.status = 'alive';
    f.lockedAt = null;
    return true;
}

/**
 * Close the current arc if it has run its length: the locked arc fate becomes a summary,
 * unlocked arc fates are pruned. Returns true when a new arc started.
 */
export function advanceArc(st, chat, prog) {
    const size = sizeOf(st.size);
    if (!size.arcs || prog.arc == null || prog.arc < 1) return false;
    if (size.arcs !== Infinity && st.arc.index >= size.arcs) return false;
    if (size.arcs === Infinity && st.finale) return false;
    const at = chat?.length ?? 0;
    const locked = lockedFate(st, 'arc');
    st.arc.summaries.push({
        index: st.arc.index,
        summary: st.arcSummaryDraft || (locked ? locked.truth : ''),
        endedAt: at,
    });
    if (locked) { locked.status = 'done'; locked.doneAt = at; }
    for (const f of alive(st, 'arc')) pruneFate(st, f, at, `องก์ ${st.arc.index} จบแล้ว`);
    st.arc = { index: st.arc.index + 1, startedAt: at, summaries: st.arc.summaries };
    st.arcSummaryDraft = '';
    st.arcFloor = 0;
    st.history.push({ at, event: 'arc', index: st.arc.index });
    return true;
}

/** Start a new cycle (ภาคใหม่) after the end: keep open seeds, archive the rest. */
export function newCycle(st, chat) {
    const at = chat?.length ?? 0;
    const truth = st.fates.filter(f => f.status === 'locked' || f.status === 'done').map(f => f.truth).filter(Boolean);
    st.past.push({ cycle: st.cycle, truths: truth, endedAt: at });
    for (const f of st.fates) if (f.status === 'locked' || f.status === 'alive') { f.status = 'done'; f.doneAt = at; }
    st.cycle++;
    st.startedAt = at;
    st.arc = { index: 1, startedAt: at, summaries: [] };
    st.finale = false;
    st.ended = false;
    st.progressFloor = 0;
    st.arcFloor = 0;
    st.shift = 0;
    st.beat = '';
    st.focus = [];
    st.secrets = [];
    st.lastArchitectAt = -1;
}

// ---------------------------------------------------------------- what the story writer gets

export const DEFAULT_TEMPLATE = `[Author's private notes. Never mention these notes or reveal them directly; let them quietly shape the story.
{{phase}}
{{beat}}
{{seeds}}
{{secrets}}]`;

/** Seeds to hand the writer this turn (max 3). */
export function pickFocus(st, chat, prog, max = 3) {
    const live = liveSeeds(st, chat).filter(s => s.status === 'open');
    const byId = new Map(live.map(s => [s.id, s]));
    const out = [];
    for (const id of st.focus ?? []) if (byId.has(id) && out.length < max) out.push(byId.get(id));
    if (!out.length) {
        // no Architect pick yet: seeds that serve the most living fates, user seeds first, oldest first
        const aliveIds = new Set(st.fates.filter(f => f.status === 'alive' || f.status === 'locked').map(f => f.id));
        const rank = s => (s.user ? 10 : 0) + (s.fates ?? []).filter(id => aliveIds.has(id)).length;
        const sorted = [...live].sort((a, b) => rank(b) - rank(a) || (a.msgId ?? 0) - (b.msgId ?? 0));
        for (const s of sorted) if (out.length < Math.min(max, 2)) out.push(s);
    }
    // the ouroboros rule: near the end, at least one seed from the setup comes back
    if (['climax', 'resolution'].includes(prog.mainPhase) && !out.some(s => s.phase === 'setup')) {
        const early = live.find(s => s.phase === 'setup');
        if (early) { if (out.length >= max) out.pop(); out.push(early); }
    }
    return out;
}

/** Locked truths split into those still held back and those the climax may release. */
export function secretsByTiming(st, prog) {
    const hold = [];
    const free = [];
    for (const sec of st.secrets ?? []) {
        if (!lockedFate(st, sec.layer)) continue; // nothing is true until its layer is locked
        const ph = sec.layer === 'arc' ? prog.arcPhase : prog.mainPhase;
        (phaseIndex(ph) >= phaseIndex('climax') ? free : hold).push(sec.text);
    }
    return { hold, free };
}

/** The text injected into the chat for the story writer. Empty string = nothing to send. */
export function buildInjection(st, chat, template = DEFAULT_TEMPLATE) {
    if (!st || st.ended) return '';
    const prog = progressOf(st, chat);
    const size = sizeOf(st.size);
    const pct = Math.round(Math.min(1, size.arcs ? prog.arc : prog.main) * 100);
    let phase = `Story phase: ${phaseInfo(prog.phase).guide} (about ${pct}% through${size.arcs ? ` act ${st.arc.index}` : ''})`;
    if (size.arcs && prog.mainPhase !== prog.phase) phase += `\nThe story as a whole is in its ${prog.mainPhase} phase.`;
    if (prog.done) phase += '\nThe planned length is reached: steer toward a satisfying close.';
    const beat = st.beat ? `Next beat: ${st.beat}` : '';
    const focus = pickFocus(st, chat, prog);
    const seeds = focus.length ? `Threads worth picking up (weave them in subtly, no exposition):\n${focus.map(s => `- ${s.text}`).join('\n')}` : '';
    const { hold, free } = secretsByTiming(st, prog);
    const secrets = [
        hold.length ? `Do not reveal yet (hint at most):\n${hold.map(s => `- ${s}`).join('\n')}` : '',
        free.length ? `Truths that may now come out, at the right dramatic moment:\n${free.map(s => `- ${s}`).join('\n')}` : '',
    ].filter(Boolean).join('\n');
    const fill = { phase, beat, seeds, secrets };
    const tpl = String(template || DEFAULT_TEMPLATE);
    let text = tpl.replace(/\{\{(phase|beat|seeds|secrets)\}\}/g, (_, k) => fill[k]);
    text = text.replace(/\n{2,}/g, '\n').trim();
    return text;
}

// ---------------------------------------------------------------- text helpers

/** Strip reasoning blocks, HTML, status JSON and code from a chat message. */
export function cleanMessage(text) {
    return String(text ?? '')
        .replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** Recent messages as "Name: text", newest last, within a character budget. */
export function recentTranscript(chat, budgetChars, until = chat?.length ?? 0) {
    const lines = [];
    let used = 0;
    for (let i = Math.min(until, chat?.length ?? 0) - 1; i >= 0; i--) {
        const m = chat[i];
        if (!visible(m)) continue;
        const t = cleanMessage(m.mes);
        if (!t) continue;
        const line = `#${i} ${m.name ?? (m.is_user ? 'User' : 'Bot')}: ${t}`;
        if (used + line.length > budgetChars && lines.length) break;
        lines.push(line.length > budgetChars ? line.slice(0, budgetChars) : line);
        used += line.length;
    }
    return lines.reverse().join('\n\n');
}

/** Parse JSON from a model answer: fences, prose around it, trailing commas, smart quotes. */
export function parseJsonLoose(text) {
    let t = String(text ?? '').trim();
    t = t.replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '').trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1].trim();
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    t = t.slice(a, b + 1);
    try { return JSON.parse(t); } catch { /* try repairs */ }
    try { return JSON.parse(t.replace(/,\s*([}\]])/g, '$1').replace(/[“”]/g, '"')); } catch { return null; }
}

/** Counts for the spoiler-free home screen. */
export function stats(st, chat) {
    const live = liveSeeds(st, chat);
    const lays = layers(st);
    return {
        planted: live.length,
        paid: live.filter(s => s.status === 'paid').length,
        open: live.filter(s => s.status === 'open').length,
        alive: Object.fromEntries(lays.map(l => [l, alive(st, l).length])),
        locked: Object.fromEntries(lays.map(l => [l, !!lockedFate(st, l)])),
        unrealized: st.fates.filter(f => f.status === 'pruned').length,
        peeked: st.fates.some(f => f.peek > 0) || (st.secretTropes?.peek ?? 0) > 0,
    };
}

// ---------------------------------------------------------------- carry a plan into a continued chat (Memory Hub chain)

/**
 * The plan of the previous chapter, continued in a new chat. Message numbers of the old chat
 * mean nothing here, so seeds become chat-less (always on screen), progress carries over as an
 * offset, and old lock/prune positions are kept only for display.
 * @param {object} prev the previous chat's state
 * @param {any[]} prevChat the previous chat's messages (only counted)
 * @param {{chatId:string, groupId?:string|null, from:string}} o
 */
export function carryState(prev, prevChat, o) {
    const st = normalizeState(structuredClone(prev));
    const visibleMain = countVisible(prevChat, st.startedAt) + (Number(st.offset) || 0);
    const visibleArc = countVisible(prevChat, st.arc.startedAt) + (Number(st.arc.offset) || 0);
    st.owner = { chatId: o.chatId, groupId: o.groupId ?? null };
    st.carriedFrom = [...(st.carriedFrom ?? []), o.from];
    st.offset = visibleMain;
    st.startedAt = 0;
    st.arc = { ...st.arc, startedAt: 0, offset: visibleArc };
    st.seeds = st.seeds
        .filter(s => s.status !== 'dropped' && onScreen(prevChat, s))
        .map(s => {
            const paid = s.status === 'paid' && onScreen(prevChat, s.paidBy);
            return { ...s, msgId: null, swipeId: 0, carried: true, status: paid ? 'paid' : 'open', paidBy: paid ? { carried: true } : null };
        });
    for (const f of st.fates) {
        if (Number.isInteger(f.lockedAt)) f.lockedAt = 0;
        if (Number.isInteger(f.prunedAt)) { f.prunedIn = o.from; }
    }
    st.scanned = [];
    st.lastArchitectAt = -1;
    st.lastScoutAt = -1;
    st.history.push({ at: 0, event: 'carried', from: o.from });
    return st;
}

// ---------------------------------------------------------------- backfill: seeds from the chat before Ouroboros started

/**
 * Where the backfill stops: the oldest message the live Scout has already read (or the end of the chat).
 */
export function backfillUntil(st, chat) {
    const idx = (st.scanned ?? []).map(k => Number(String(k).split(':')[0])).filter(Number.isInteger);
    return idx.length ? Math.min(...idx) : (chat?.length ?? 0);
}

/**
 * How to read the old part of a chat: Memory Hub summaries where they exist (cheap), raw messages
 * only for what no summary covers. At most `maxParts` raw parts; a very long uncovered stretch is read
 * from its newest end.
 * @param {any[]} chat
 * @param {any} mh chat_metadata.memory_hub (or null)
 * @param {{from?:number, until:number, chatId?:string, summaryChars?:number, chunkChars?:number, maxChunkChars?:number, maxParts?:number}} o
 * @returns {{parts:Array<{kind:'summary', text:string, ranges:Array<[number,number]>}|{kind:'chat', from:number, to:number}>, summaries:number, rawFrom:number, rawTo:number, skipped:number}}
 */
export function backfillPlan(chat, mh, o) {
    const from = Math.max(0, o.from ?? 0);
    const until = Math.min(o.until, chat?.length ?? 0);
    const summaryChars = o.summaryChars ?? 9000;
    const parts = [];
    let covered = from;
    let summaries = 0;
    if (mh && until > from) {
        const lines = [];
        if (from === 0 && String(mh.overview ?? '').trim()) lines.push({ text: `Overview: ${cleanMessage(mh.overview)}`, range: null });
        const mems = (mh.memories ?? []).filter(m => String(m?.text ?? '').trim()).sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
        for (const m of mems) {
            const foreign = !!m.origin?.chat && m.origin.chat !== o.chatId;
            const local = !foreign && Number.isInteger(m.start) && Number.isInteger(m.end) && m.end >= 0;
            if (local && (m.end < from || m.start >= until)) continue;
            if (foreign && from > 0) continue; // earlier chapters were read on the first backfill
            const label = local ? `#${m.start}–${m.end}` : '(earlier chapter)';
            lines.push({ text: `${label} ${m.title ?? ''}: ${cleanMessage(m.text)}`, range: local ? [m.start, Math.min(m.end, until - 1)] : null });
            if (local) covered = Math.max(covered, Math.min(m.end + 1, until));
            summaries++;
        }
        let cur = null;
        for (const l of lines) {
            if (!cur || (cur.text.length + l.text.length > summaryChars && cur.text)) { cur = { kind: 'summary', text: '', ranges: [] }; parts.push(cur); }
            cur.text += (cur.text ? '\n' : '') + l.text;
            if (l.range) cur.ranges.push(l.range);
        }
    }
    // raw messages that no summary covers
    const idx = [];
    for (let i = covered; i < until; i++) if (chat[i] && !chat[i].is_system && cleanMessage(chat[i].mes)) idx.push(i);
    const lens = idx.map(i => cleanMessage(chat[i].mes).length + 20);
    const total = lens.reduce((a, b) => a + b, 0);
    const maxParts = o.maxParts ?? 20;
    const chunkChars = Math.min(o.maxChunkChars ?? 24000, Math.max(o.chunkChars ?? 6000, Math.ceil(total / maxParts)));
    const chunks = [];
    let start = null, size = 0;
    for (let k = 0; k < idx.length; k++) {
        if (start == null) { start = idx[k]; size = 0; }
        size += lens[k];
        if (size >= chunkChars || k === idx.length - 1) { chunks.push({ kind: 'chat', from: start, to: idx[k] }); start = null; }
    }
    const kept = chunks.slice(-maxParts);
    parts.push(...kept);
    return { parts, summaries, rawFrom: kept[0]?.from ?? null, rawTo: kept[kept.length - 1]?.to ?? null, skipped: chunks.length - kept.length };
}

/** "msg" from the model for a backfill part: a message number inside what the part covered, else null. */
export function backfillRef(part, msg, chat) {
    if (msg == null || String(msg).trim() === '') return null; // Number(null) would be 0
    const n = Number(msg);
    if (!Number.isInteger(n) || n < 0 || n >= (chat?.length ?? 0)) return null;
    const inside = part.kind === 'chat' ? n >= part.from && n <= part.to : part.ranges.some(([a, b]) => n >= a && n <= b);
    return inside ? { msgId: n, swipeId: chat[n]?.swipe_id ?? 0 } : null;
}
