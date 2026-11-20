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
    { id: 'setup', label: 'ปูเรื่อง', from: 0, guide: 'Setup: establish the world, the characters and small mysteries. Plant details; explain nothing; resolve nothing important.' },
    { id: 'rising', label: 'ไต่ระดับ', from: 0.15, guide: 'Rising action: raise the pressure, add complications, deepen the mysteries. No big reveals yet, and do not resolve the central conflict: let problems linger and cost something.' },
    { id: 'midpoint', label: 'จุดเปลี่ยน', from: 0.45, guide: 'Midpoint: a turn that changes how things look. A partial revelation is fine; the central conflict stays open.' },
    { id: 'crisis', label: 'วิกฤต', from: 0.55, guide: 'Crisis: stakes peak and things go wrong. Pull the threads tighter toward the truth. No rescue, no easy fix yet.' },
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

// ---------------------------------------------------------------- intensity and tones (guards against a model's habits)

/**
 * How hard the story may hit. Fiction framing only: it sets genre expectations, it never asks a model to
 * drop its own safety rules.
 * tones: the tones new fates are asked to take, in order (code assigns them, so the fates really differ).
 */
export const INTENSITY = Object.freeze({
    soft: {
        label: 'นุ่มนวล', hint: 'อบอุ่น ความขัดแย้งคลี่คลายด้วยความเข้าใจได้',
        architect: 'Gentle story: real problems with warm stakes. Conflicts may resolve through understanding, but each fate still needs a genuine secret and a turn the player will not see coming.',
        writer: '',
        tones: ['bright', 'bittersweet', 'bright'],
    },
    real: {
        label: 'สมจริง', hint: 'ชัยชนะมีราคา ไม่จบด้วย "เข้าใจผิดกัน"',
        architect: 'Real stakes. No fate may hinge on "it was all a misunderstanding" or "everyone was good all along". Victories cost something; antagonists act on real motives and do not redeem easily; mistakes have consequences that stay.',
        writer: 'Problems linger and cost something; do not soften consequences or let a conflict dissolve on its own.',
        tones: ['bittersweet', 'dark', 'bright'],
    },
    dark: {
        label: 'มืดหม่น', hint: 'มีการสูญเสียจริง คนร้ายร้ายจริง',
        architect: 'Grim story. At least one fate ends with a real, lasting loss. Villains can be truly villainous, betrayals land, and hope, where there is any, is paid for. No rescue at the last second unless it costs dearly.',
        writer: 'Do not rescue characters from consequences; losses stick and betrayals hurt.',
        tones: ['dark', 'bittersweet', 'dark'],
    },
});
export const INTENSITY_IDS = Object.keys(INTENSITY);
export const intensityOf = id => INTENSITY[id] ?? INTENSITY.real;
export const TONES = Object.freeze({ bright: 'สดใส', bittersweet: 'ขมหวาน', dark: 'มืด' });
export const normTone = t => (TONES[String(t ?? '').toLowerCase()] ? String(t).toLowerCase() : '');

/**
 * Tones to ask for when the Architect adds `room` fates to a layer: the intensity's list, skipping tones
 * the living fates of that layer already cover, so a respawn fills the gap.
 */
export function tonesFor(st, layer, room) {
    if (room <= 0) return [];
    const order = intensityOf(st.intensity).tones;
    const have = alive(st, layer).map(f => f.tone).filter(Boolean);
    const out = [];
    for (const t of [...order, ...order]) {
        if (out.length >= room) break;
        const left = have.indexOf(t);
        if (left >= 0) { have.splice(left, 1); continue; }
        out.push(t);
    }
    while (out.length < room) out.push(order[out.length % order.length]);
    return out;
}

/** New fates of one layer that all came back with the same tone (when 2+ were asked for different tones). */
export function sameToneBirth(fates, asked) {
    const tones = (fates ?? []).map(f => normTone(f?.tone));
    if (tones.length < 2 || tones.some(t => !t)) return false;
    if (new Set(asked).size < 2) return false;
    return new Set(tones).size === 1;
}

// ---------------------------------------------------------------- story shapes (v0.6)

/**
 * What kind of bot this is. Each shape changes how the Architect works:
 * story   one central mystery (the original behaviour)
 * sandbox open world: no main story at first, local acts where the player goes, a main story that
 *         emerges once threads from different acts connect; hooks instead of a directed beat
 * cast    big cast / fandom: fates centre on characters on stage, canon or AU, character threads
 * harem   several love interests: a thread per character, never picks a partner for the player
 */
export const SHAPES = Object.freeze({
    story: { label: 'เรื่องเดียวจบ', hint: 'มีปมกลาง วางชะตาแล้วล็อก', threads: false },
    sandbox: { label: 'โลกเปิด', hint: 'เดินเที่ยว เรื่องย่อยตามที่ไป เรื่องใหญ่โผล่เองทีหลัง', threads: false },
    cast: { label: 'ตัวละครเยอะ', hint: 'แฟนด้อม ชะตาวนรอบตัวที่ออกฉาก', threads: true },
    harem: { label: 'ฮาเร็ม', hint: 'หลายเส้นความสัมพันธ์ ทุกคนมีเรื่องของตัวเอง', threads: true },
});
export const SHAPE_IDS = Object.keys(SHAPES);
export const shapeOf = id => SHAPES[id] ?? SHAPES.story;
export const CANON = Object.freeze({ canon: 'ตามแคนนอน', au: 'AU ได้' });

/** Open world: the main story may only be born once an act has finished (or it already exists). */
export function mainGateOpen(st) {
    if (st.shape !== 'sandbox') return true;
    return st.arc.index >= 2 || alive(st, 'main').length > 0 || !!lockedFate(st, 'main');
}

export const PROTECT_RULES = Object.freeze({ villain: 'ห้ามเป็นคนร้าย', death: 'ห้ามตาย', betray: 'ห้ามทรยศ' });
const HARM_FOR_RULE = { villain: 'villain', death: 'dies', betray: 'betrays' };

/** Protected characters: [{name, villain, death, betray}] with every rule on by default. */
export function normProtected(list) {
    return (Array.isArray(list) ? list : [])
        .map(p => ({ name: str(p?.name, 60), villain: p?.villain !== false, death: p?.death !== false, betray: p?.betray !== false }))
        .filter(p => p.name);
}

/** Does a fate break a protection? Uses the "harm" roles the Architect lists ({name, role}). */
export function breaksProtection(fate, protectedList) {
    const harms = Array.isArray(fate?.harm) ? fate.harm : [];
    for (const p of normProtected(protectedList)) {
        for (const [rule, role] of Object.entries(HARM_FOR_RULE)) {
            if (!p[rule]) continue;
            if (harms.some(h => String(h?.role ?? '').toLowerCase() === role && sameNameLoose(h?.name, p.name))) return `${p.name}: ${PROTECT_RULES[rule]}`;
        }
    }
    return '';
}
function sameNameLoose(a, b) {
    const x = String(a ?? '').trim().toLowerCase();
    const y = String(b ?? '').trim().toLowerCase();
    return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}

/**
 * Character threads (cast and harem): one small storyline per important character.
 * { name, want, secret, next, status: 'open'|'resolved', peek }
 */
export function mergeThreads(st, list) {
    const cur = Array.isArray(st.threads) ? st.threads : [];
    for (const raw of Array.isArray(list) ? list : []) {
        const name = str(raw?.name, 60);
        if (!name) continue;
        let t = cur.find(x => sameNameLoose(x.name, name));
        if (!t) {
            if (cur.filter(x => x.status !== 'resolved').length >= 6) continue;
            t = { name, want: '', secret: '', next: '', status: 'open', peek: 0 };
            cur.push(t);
        }
        if (raw.want) t.want = str(raw.want, 200);
        if (raw.secret && !t.secret) t.secret = str(raw.secret, 300); // a thread's secret, once set, stays
        if (raw.next !== undefined) t.next = str(raw.next, 200);
        if (raw.status === 'resolved') t.status = 'resolved';
    }
    st.threads = cur;
    return cur;
}

/** Names seen in the recent chat: message authors, plus lore titles mentioned in the text. */
export function onStageNames(chat, loreTitles = [], lookback = 20) {
    const names = new Set();
    const recent = (chat ?? []).slice(-lookback).filter(m => m && !m.is_system);
    for (const m of recent) if (m.name && !m.is_user) names.add(String(m.name));
    const text = recent.slice(-8).map(m => cleanMessage(m.mes)).join('\n').toLowerCase();
    for (const t of loreTitles) {
        const k = String(t ?? '').trim();
        if (k.length >= 2 && text.includes(k.toLowerCase())) names.add(k);
    }
    return [...names];
}

/** A model answer that is a refusal rather than the JSON we asked for. */
export function looksLikeRefusal(text) {
    const t = String(text ?? '').trim();
    if (!t) return false;
    if (/\{[\s\S]*\}/.test(t)) return false; // it answered with JSON after all
    return /\b(I can(?:not|'t|’t)|I(?:'m| am) (?:not able|unable)|I won(?:'t|’t)|cannot (?:help|assist|comply|continue)|can(?:'t|’t) (?:help|assist|comply|continue) with|against (?:my|the) (?:guidelines|policies|policy)|content polic(?:y|ies)|I'm sorry, but|I apologize, but)\b|ขออภัย[^\n]{0,40}(?:ไม่สามารถ|ไม่อาจ)|ไม่สามารถ(?:ช่วย|ดำเนินการ|เขียน)[^\n]{0,20}(?:ได้|นี้)/i.test(t);
}

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
        size: o.shape === 'sandbox' ? 'epic' : SIZES[o.size] ? o.size : 'medium',
        premise: String(o.premise ?? '').trim(),
        tropes: [...new Set((o.tropes ?? []).map(t => String(t).trim()).filter(Boolean))],
        secretTropes: secretCats.length ? { categories: secretCats, picked: pickSecretTropes(secretCats, 2, rand), peek: 0 } : null,
        moods: (o.moods ?? []).filter(m => MOODS.includes(m)),
        intensity: INTENSITY[o.intensity] ? o.intensity : 'real',
        shape: SHAPES[o.shape] ? o.shape : 'story',
        canon: CANON[o.canon] ? o.canon : 'canon',
        protected: normProtected(o.protected),
        threads: [],
        tensions: [],
        quiet: 0,
        hooks: [],
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
    if (layer === 'main' && !mainGateOpen(st)) return 0;
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
    const past = r => r && Number.isInteger(r.msgId) && r.msgId >= len;
    for (const sec of st.secrets ?? []) {
        if (Array.isArray(sec.clues)) sec.clues = sec.clues.filter(c => !past(c));
        if (Array.isArray(sec.learned)) sec.learned = sec.learned.filter(l => !past(l));
        if (past(sec.revealed)) sec.revealed = null;
    }
    return before - st.seeds.length;
}

const normText = t => String(t ?? '').toLowerCase().replace(/[\s"'“”‘’.,!?…:;()\-–—]+/g, '');

/**
 * Scout answers worth keeping: a thread must name the open question it leaves. Props and actions that
 * finish inside the scene cannot, so they drop out here whatever the model claims.
 */
export function acceptSeedItems(items, max) {
    return (Array.isArray(items) ? items : [])
        .filter(it => String(it?.text ?? '').trim() && String(it?.question ?? '').trim().length >= 4)
        .slice(0, max);
}

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
            question: str(it.question, 200),
            msgId: ref?.msgId ?? null,
            swipeId: ref?.swipeId ?? 0,
            phase: phase ?? 'setup',
            arc: st.arc?.index ?? 1,
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
export function applyArchitect(st, out, { at, prog, noRush = false }) {
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
        const broken = breaksProtection(raw, st.protected);
        if (broken) { res.blocked = [...(res.blocked ?? []), broken]; continue; }
        room[layer]--;
        const id = nextFateId(st);
        st.fates.push({
            id, layer,
            arc: layer === 'arc' ? st.arc.index : null,
            cycle: st.cycle,
            truth: str(raw.truth), twists: strList(raw.twists, 4), ending: str(raw.ending),
            scent: str(raw.scent, 40), shadow: str(raw.shadow, 200), needs: strList(raw.needs, 12), tone: normTone(raw.tone),
            harm: (Array.isArray(raw.harm) ? raw.harm : []).slice(0, 6).map(h => ({ name: str(h?.name, 60), role: str(h?.role, 20) })),
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
    // seeds the story has moved on from: they stop being sent (the player's own and pinned ones never fade)
    if (Array.isArray(out.stale)) {
        const used = new Set(st.fates.filter(f => f.status === 'alive' || f.status === 'locked').flatMap(f => f.needs ?? []));
        for (const id of strList(out.stale, 20)) {
            const x = st.seeds.find(y => y.id === id);
            if (x && x.status === 'open' && !x.user && !x.pinned && !used.has(x.id)) { x.faded = true; res.faded = (res.faded ?? 0) + 1; }
        }
    }
    if (Array.isArray(out.hooks)) st.hooks = strList(out.hooks, 3).map(h => h.slice(0, 200));
    if (Array.isArray(out.threads) && shapeOf(st.shape).threads) mergeThreads(st, out.threads);
    if (Array.isArray(out.tensions)) mergeTensions(st, out.tensions);
    if (Array.isArray(out.focus)) st.focus = strList(out.focus, 3).filter(id => st.seeds.some(s => s.id === id));
    if (Array.isArray(out.secrets)) mergeSecrets(st, out.secrets);
    if (out.pace === 'slower') st.shift = clamp((st.shift || 0) + 0.05, -0.1, 0.1);
    else if (out.pace === 'faster' && !noRush) st.shift = clamp((st.shift || 0) - 0.05, -0.1, 0.1);
    if (typeof out.arcSummary === 'string' && out.arcSummary.trim()) st.arcSummaryDraft = str(out.arcSummary, 600);
    st.lastArchitectAt = at;
    return res;
}

// ---------------------------------------------------------------- secrets of locked fates

/**
 * A secret: { id, text, layer, arc, hiddenFrom[], when, changes, clueIdeas[],
 *             clues: [{text, msgId, swipeId}], learned: [{who, msgId, swipeId}], revealed: {msgId, swipeId}|null }
 * Clues, learned and revealed are tied to the reply that showed them, like seeds: swipe that reply
 * away and they no longer count.
 */
export function normSecret(x, st) {
    const lays = st ? layers(st) : ['main', 'arc'];
    const layer = lays.includes(x?.layer) ? x.layer : 'main';
    return {
        id: String(x?.id ?? ''),
        text: str(x?.text, 300),
        layer,
        arc: layer === 'arc' ? (Number.isInteger(x?.arc) ? x.arc : st?.arc?.index ?? 1) : null,
        hiddenFrom: strList(x?.hiddenFrom, 8),
        when: str(x?.when, 300),
        changes: str(x?.changes, 300),
        clueIdeas: strList(x?.clueIdeas, 4),
        clues: Array.isArray(x?.clues) ? x.clues : [],
        learned: Array.isArray(x?.learned) ? x.learned : [],
        revealed: x?.revealed && typeof x.revealed === 'object' ? x.revealed : null,
    };
}

function nextSecretId(list) {
    const n = Math.max(0, ...list.map(s => Number(String(s.id).replace(/^K/, '')) || 0));
    return 'K' + (n + 1);
}

/**
 * Merge the Architect's secrets. Known ids are refined (hidden-from, timing, consequences, clue ideas);
 * a secret's text never changes; new ones get the next id; nothing is dropped, revealed ones stay.
 */
export function mergeSecrets(st, list) {
    const cur = (Array.isArray(st.secrets) ? st.secrets : []).map(x => normSecret(x, st));
    for (const s of cur) if (!s.id) s.id = nextSecretId(cur);
    for (const raw of Array.isArray(list) ? list : []) {
        const x = typeof raw === 'string' ? { text: raw } : raw;
        if (!x || typeof x !== 'object') continue;
        const found = x.id && cur.find(s => s.id === String(x.id));
        if (found) {
            if (x.hiddenFrom) found.hiddenFrom = strList(x.hiddenFrom, 8);
            if (x.when) found.when = str(x.when, 300);
            if (x.changes) found.changes = str(x.changes, 300);
            if (x.clueIdeas) found.clueIdeas = strList(x.clueIdeas, 4);
            continue;
        }
        const text = str(x.text, 300);
        if (!text || cur.some(s => normText(s.text) === normText(text))) continue;
        if (cur.filter(s => !s.revealed).length >= 8) continue;
        cur.push(normSecret({ ...x, id: nextSecretId(cur), text }, st));
    }
    st.secrets = cur;
    return cur;
}

const sameName = (a, b) => {
    const x = String(a ?? '').trim().toLowerCase();
    const y = String(b ?? '').trim().toLowerCase();
    return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

const isReader = n => /\breader\b|ผู้อ่าน/i.test(String(n ?? ''));

/** A secret as it stands on screen now. */
export function secretView(chat, sec) {
    const clues = (sec.clues ?? []).filter(c => onScreen(chat, c));
    const learned = [...new Set((sec.learned ?? []).filter(l => onScreen(chat, l)).map(l => l.who))];
    const revealed = sec.revealed && onScreen(chat, sec.revealed) ? sec.revealed : null;
    // once it is out on the page, the reader knows it; characters still have to find out
    const unknownTo = (sec.hiddenFrom ?? []).filter(n => !learned.some(w => sameName(w, n)) && !(revealed && isReader(n)));
    return { ...sec, clues, learned, revealed, unknownTo };
}

/** Secrets that belong to what is locked right now (current act for act secrets). */
export function activeSecrets(st, chat) {
    return (st.secrets ?? [])
        .filter(sec => lockedFate(st, sec.layer) && (sec.layer !== 'arc' || (sec.arc ?? st.arc.index) === st.arc.index))
        .map(sec => secretView(chat, normSecret(sec, st)));
}

/**
 * Apply what the Scout saw a reply do to the live secrets (numbered as it was shown them).
 * @returns {{clues:number, learned:number, revealed:string[], leaked:string[]}} leaked = revealed while still held back
 */
export function applyScoutSecrets(st, chat, out, live, ref, heldIds = new Set()) {
    const res = { clues: 0, learned: 0, revealed: [], leaked: [] };
    if (!out || !live?.length || !ref || !Number.isInteger(ref.msgId)) return res;
    const real = v => st.secrets.find(x => x.id === v?.id);
    const pick = n => real(live[Number(n) - 1]);
    const at = { msgId: ref.msgId, swipeId: ref.swipeId ?? 0 };
    const sameRef = r => r && r.msgId === at.msgId && (r.swipeId ?? 0) === at.swipeId;
    for (const c of Array.isArray(out.clues) ? out.clues : []) {
        const sec = pick(c?.n ?? c?.secret);
        const text = str(c?.text, 200);
        if (!sec || !text) continue;
        sec.clues = Array.isArray(sec.clues) ? sec.clues : [];
        if (sec.clues.some(sameRef)) continue; // one clue per secret per reply
        sec.clues.push({ text, ...at });
        if (sec.clues.length > 12) sec.clues.shift();
        res.clues++;
    }
    for (const l of Array.isArray(out.learned) ? out.learned : []) {
        const sec = pick(l?.n ?? l?.secret);
        const who = (sec?.hiddenFrom ?? []).find(n => sameName(n, l?.who));
        if (!sec || !who) continue;
        sec.learned = Array.isArray(sec.learned) ? sec.learned : [];
        if (secretView(chat, sec).learned.some(w => sameName(w, who))) continue;
        sec.learned.push({ who, ...at });
        res.learned++;
    }
    const revealedNums = [...(Array.isArray(out.revealed) ? out.revealed : []), ...(Array.isArray(out.leaked) ? out.leaked : [])];
    for (const n of new Set(revealedNums.map(Number))) {
        const sec = pick(n);
        if (!sec || secretView(chat, sec).revealed) continue;
        sec.revealed = { ...at };
        res.revealed.push(sec.id);
        if (heldIds.has(sec.id)) res.leaked.push(sec.id);
    }
    return res;
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
    const live = liveSeeds(st, chat).filter(s => s.status === 'open' && !s.faded);
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

/** Locked truths: held back, free to come out (climax of their layer), or already out. */
export function secretsByTiming(st, prog, chat = []) {
    const hold = [];
    const free = [];
    const revealed = [];
    for (const v of activeSecrets(st, chat)) {
        if (v.revealed) { revealed.push(v); continue; }
        const ph = v.layer === 'arc' ? prog.arcPhase : prog.mainPhase;
        (phaseIndex(ph) >= phaseIndex('climax') ? free : hold).push(v);
    }
    return { hold, free, revealed };
}

/** How long after its reveal a truth keeps reminding the writer to play out what it changes. */
export const AFTERMATH_MESSAGES = 40;

function secretLines(v, { ideas = false, when = false } = {}) {
    const lines = [`- ${v.text}`];
    if (v.unknownTo.length) lines.push(`  Still unknown to: ${v.unknownTo.join(', ')}`);
    if (v.learned.length) lines.push(`  Already knows: ${v.learned.join(', ')}`);
    if (when && v.when) lines.push(`  Comes out when: ${v.when}`);
    if (ideas && v.clueIdeas.length) lines.push(`  Clue ideas (small, could mean something else; most turns carry none): ${v.clueIdeas.slice(0, 2).join(' / ')}`);
    if (v.clues.length) lines.push(`  Clues already planted: ${v.clues.slice(-2).map(c => c.text).join(' / ')}`);
    return lines.join('\n');
}

/** The text injected into the chat for the story writer. Empty string = nothing to send. */
export function buildInjection(st, chat, template = DEFAULT_TEMPLATE, { player = '' } = {}) {
    if (!st || st.ended) return '';
    const prog = progressOf(st, chat);
    const size = sizeOf(st.size);
    const pct = Math.round(Math.min(1, size.arcs ? prog.arc : prog.main) * 100);
    let phase = `Story phase: ${phaseInfo(prog.phase).guide} (about ${pct}% through${size.arcs ? ` act ${st.arc.index}` : ''})`;
    if (size.arcs && prog.mainPhase !== prog.phase) phase += `\nThe story as a whole is in its ${prog.mainPhase} phase.`;
    if (prog.done) phase += '\nThe planned length is reached: steer toward a satisfying close.';
    const tone = !['climax', 'resolution'].includes(prog.phase) ? intensityOf(st.intensity).writer : '';
    if (tone) phase += `\n${tone}`;
    let beat = st.beat ? `Next beat: ${st.beat}` : '';
    if (st.shape === 'sandbox' && st.hooks?.length) beat = `Hooks the world could offer (the player may take or ignore them; never force one):\n${st.hooks.map(h => `- ${h}`).join('\n')}`;
    const focus = pickFocus(st, chat, prog);
    const seeds = focus.length ? `Threads worth picking up (weave them in subtly, no exposition):\n${focus.map(s => `- ${s.text}`).join('\n')}` : '';
    const { hold, free, revealed } = secretsByTiming(st, prog, chat);
    const recent = revealed.filter(v => !Number.isInteger(v.revealed.msgId) || (chat?.length ?? 0) - v.revealed.msgId <= AFTERMATH_MESSAGES);
    const secrets = [
        hold.length ? `Hidden truths. Do not reveal them yet; hint at most. Characters guard, avoid or pursue them:\n${hold.map(v => secretLines(v, { ideas: true })).join('\n')}` : '',
        free.length ? `Truths that may now come out, at the right dramatic moment:\n${free.map(v => secretLines(v, { when: true })).join('\n')}` : '',
        recent.length ? `Already revealed. Keep playing out what each one changes; a revealed truth is never dropped:\n${recent.map(v => `- ${v.text}${v.changes ? ` → ${v.changes}` : ''}${v.unknownTo.length ? ` (still unknown to: ${v.unknownTo.join(', ')})` : ''}`).join('\n')}` : '',
        hold.length || free.length ? 'If the player\'s character reaches the place or person where a hidden truth is kept, they find it. Protect truths by making them hard or costly to reach, never by refusing an answer that is in front of them.' : '',
    ].filter(Boolean).join('\n');
    // character threads of the characters on stage (at most two), as part of the seeds block
    let threadText = '';
    if (shapeOf(st.shape).threads && st.threads?.length) {
        const stage = onStageNames(chat, (st.threads ?? []).map(t => t.name)).map(n => n.toLowerCase());
        const on = st.threads.filter(t => t.status !== 'resolved' && stage.some(n => sameNameLoose(n, t.name))).slice(0, 2);
        if (on.length) threadText = `Character threads in this scene (each character has their own story; hint at a secret at most):\n${on.map(t => `- ${t.name}${t.want ? `: wants ${t.want}` : ''}${t.secret ? `; hides: ${t.secret}` : ''}${t.next ? `; next for them: ${t.next}` : ''}`).join('\n')}`;
    }
    const tensionText = tensionLines(st, chat, prog, player);
    const seedsAll = [seeds, threadText, tensionText].filter(Boolean).join('\n');
    const fill = { phase, beat, seeds: seedsAll, secrets };
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
        secrets: activeSecrets(st, chat).length,
        tensions: openTensions(st, chat).length,
        maxHeat: Math.max(0, ...openTensions(st, chat).map(t => t.heat)),
        revealed: activeSecrets(st, chat).filter(v => v.revealed).length,
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
    const carry = list => (Array.isArray(list) ? list : []).filter(r => onScreen(prevChat, r)).map(r => ({ ...r, msgId: null, swipeId: 0 }));
    st.secrets = (st.secrets ?? []).map(sec => ({
        ...sec,
        clues: carry(sec.clues),
        learned: carry(sec.learned),
        revealed: sec.revealed && onScreen(prevChat, sec.revealed) ? { msgId: null, swipeId: 0 } : null,
    }));
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

// ---------------------------------------------------------------- token budget (v0.6.1): what each call gets to read

const seedOrder = s => (Number.isInteger(s.msgId) ? s.msgId : -1) * 1000 + (Number(String(s.id).slice(1)) || 0);

/**
 * Seeds for the Architect, at most `cap` open ones:
 * 1. always: the player's own and pinned seeds;
 * 2. by worth: tied to a living or locked fate, in focus, from the setup;
 * 3. `rotate` slots for the seeds shown least recently, so every old seed comes round again and the
 *    Architect can tie it to a fate, or mark it stale;
 * 4. the newest fill the rest.
 * Faded (stale) seeds are left out unless a fate uses them. Plus the few newest paid seeds.
 * @returns {{seeds:any[], omittedOpen:number, omittedPaid:number}}
 */
export function seedsForArchitect(st, chat, { cap = 40, rotate = 10, paidCap = 6 } = {}) {
    const live = liveSeeds(st, chat);
    const fateIds = new Set(st.fates.filter(f => f.status === 'alive' || f.status === 'locked').map(f => f.id));
    const linked = s => (s.fates ?? []).some(id => fateIds.has(id));
    const open = live.filter(s => s.status === 'open' && (!s.faded || linked(s)));
    const paid = live.filter(s => s.status === 'paid');
    const focus = new Set(st.focus ?? []);
    const picked = new Set();
    const take = (list, n) => { for (const x of list) { if (picked.size >= n) break; picked.add(x.id); } };
    take(open.filter(x => x.user || x.pinned), cap);
    const rank = x => (linked(x) ? 4 : 0) + (focus.has(x.id) ? 4 : 0) + (x.phase === 'setup' ? 2 : 0);
    const worthy = open.filter(x => !picked.has(x.id) && rank(x) > 0).sort((a, b) => rank(b) - rank(a) || seedOrder(b) - seedOrder(a));
    take(worthy, Math.max(picked.size, cap - rotate));
    const rest = open.filter(x => !picked.has(x.id));
    const newestIds = new Set([...rest].sort((a, b) => seedOrder(b) - seedOrder(a)).slice(0, Math.max(0, cap - picked.size - rotate)).map(x => x.id));
    const dusty = rest.filter(x => !newestIds.has(x.id)).sort((a, b) => (a.lastShown ?? -1) - (b.lastShown ?? -1) || seedOrder(a) - seedOrder(b));
    take(dusty, Math.min(cap, picked.size + rotate));
    take([...rest].sort((a, b) => seedOrder(b) - seedOrder(a)), cap);
    const keepPaid = [...paid].sort((a, b) => seedOrder(b) - seedOrder(a)).slice(0, paidCap);
    for (const x of keepPaid) picked.add(x.id);
    return {
        seeds: live.filter(x => picked.has(x.id)), // story order
        omittedOpen: open.length - open.filter(x => picked.has(x.id)).length,
        omittedPaid: paid.length - keepPaid.length,
    };
}

/** Remember which seeds the Architect was shown on this pass (for the rotation). */
export function markShown(st, seeds) {
    st.passes = (Number(st.passes) || 0) + 1;
    const ids = new Set(seeds.map(x => x.id));
    for (const x of st.seeds) if (ids.has(x.id)) x.lastShown = st.passes;
}

/** Open seeds the Scout checks new ones against: the player's own plus the newest, at most `cap`. */
export function seedsForScout(st, chat, cap = 30) {
    const open = liveSeeds(st, chat).filter(s => s.status === 'open' && !s.faded);
    const user = open.filter(s => s.user || s.pinned);
    const rest = open.filter(s => !s.user && !s.pinned).sort((a, b) => seedOrder(b) - seedOrder(a));
    const keep = new Set([...user, ...rest].slice(0, cap).map(s => s.id));
    return open.filter(s => keep.has(s.id));
}

/** Finished acts and earlier cycles: the last few in full, older ones folded into one short line. */
export function pastLines(st, { fullActs = 3, fullCycles = 2 } = {}) {
    const lines = [];
    const cycles = st.past ?? [];
    const oldCycles = cycles.slice(0, Math.max(0, cycles.length - fullCycles));
    if (oldCycles.length) lines.push(`Earlier cycles ${oldCycles.map(p => p.cycle).join(', ')} ended with: ${oldCycles.map(p => str(p.truths.join(' / '), 80)).join(' | ')}`);
    for (const p of cycles.slice(-fullCycles)) lines.push(`Earlier cycle ${p.cycle} ended with: ${p.truths.join(' / ')}`);
    const acts = st.arc?.summaries ?? [];
    const oldActs = acts.slice(0, Math.max(0, acts.length - fullActs));
    if (oldActs.length) lines.push(`Acts ${oldActs[0].index}–${oldActs[oldActs.length - 1].index} (finished, in short): ${oldActs.map(a => str(a.summary, 80)).join(' | ')}`);
    for (const a of acts.slice(-fullActs)) lines.push(`Act ${a.index} (finished): ${a.summary}`);
    return lines;
}

// ---------------------------------------------------------------- tensions (v0.7): two wants that cannot both come true

export const TENSION_KINDS = Object.freeze({
    between: 'ระหว่างคน',
    inner: 'ในใจ',
    society: 'กับสังคม',
    clock: 'เวลา/ทางเลือก',
});
/** Quiet bot replies in a row (no new seed, no tension moved) before the Architect is asked to push. */
export const STALL_AFTER = 4;
export const MAX_OPEN_TENSIONS = 4;

/**
 * A tension: { id: 'T1', sides: [name, name?], kind, wants: [a, b], why, stakes, heat: 1–5, next,
 *              status: 'open'|'resolved', from: 'card'|'invented'|'user', peek,
 *              shifts: [{delta, msgId, swipeId}] }
 * heat is the Architect's last value; shifts are the Scout's +1/−1 since then, tied to replies like seeds.
 */
export function normTension(x) {
    return {
        id: String(x?.id ?? ''),
        sides: strList(x?.sides, 2),
        kind: TENSION_KINDS[x?.kind] ? x.kind : 'between',
        wants: strList(x?.wants, 2),
        why: str(x?.why, 300),
        stakes: str(x?.stakes, 200),
        heat: clamp(Math.round(Number(x?.heat) || 2), 1, 5),
        next: str(x?.next, 300),
        status: x?.status === 'resolved' ? 'resolved' : 'open',
        from: ['card', 'invented', 'user'].includes(x?.from) ? x.from : 'invented',
        peek: Number(x?.peek) || 0,
        shifts: Array.isArray(x?.shifts) ? x.shifts : [],
    };
}

/** A tension as it stands on screen: heat with the Scout's on-screen shifts. */
export function tensionView(chat, t) {
    const n = normTension(t);
    const shift = n.shifts.filter(x => onScreen(chat, x)).reduce((a, x) => a + (Number(x.delta) || 0), 0);
    return { ...n, heat: clamp(n.heat + shift, 1, 5) };
}
export const openTensions = (st, chat) => (st.tensions ?? []).map(t => tensionView(chat, t)).filter(t => t.status === 'open');

/** Merge the Architect's tensions: known ids are updated (its heat replaces the Scout's shifts), new ones take the next id. */
export function mergeTensions(st, list) {
    const cur = (Array.isArray(st.tensions) ? st.tensions : []).map(normTension);
    for (const raw of Array.isArray(list) ? list : []) {
        if (!raw || typeof raw !== 'object') continue;
        const t = raw.id && cur.find(x => x.id === String(raw.id));
        if (t) {
            for (const k of ['why', 'stakes', 'next']) if (raw[k] !== undefined) t[k] = str(raw[k], k === 'stakes' ? 200 : 300);
            if (raw.sides) t.sides = strList(raw.sides, 2);
            if (raw.wants) t.wants = strList(raw.wants, 2);
            if (TENSION_KINDS[raw.kind]) t.kind = raw.kind;
            if (Number.isFinite(Number(raw.heat))) { t.heat = clamp(Math.round(Number(raw.heat)), 1, 5); t.shifts = []; }
            if (raw.status === 'resolved') t.status = 'resolved';
            continue;
        }
        if (!strList(raw.sides, 2).length || !str(raw.why, 300)) continue;
        if (cur.some(x => normText(x.why) === normText(raw.why))) continue; // the same tension sent again without its id
        if (cur.filter(x => x.status === 'open').length >= MAX_OPEN_TENSIONS) continue;
        const n = Math.max(0, ...cur.map(x => Number(String(x.id).replace(/^T/, '')) || 0)) + 1;
        cur.push(normTension({ ...raw, id: 'T' + n, shifts: [] }));
    }
    st.tensions = cur;
    return cur;
}

/** Apply the Scout's "tension" report ([{n, change: 'hotter'|'cooler'}]) for one reply. Returns how many moved. */
export function applyScoutTensions(st, chat, out, live, ref) {
    if (!live?.length || !ref || !Number.isInteger(ref.msgId)) return 0;
    let moved = 0;
    const seen = new Set();
    for (const r of Array.isArray(out?.tension) ? out.tension : []) {
        const v = live[Number(r?.n) - 1];
        const t = v && (st.tensions ?? []).find(x => x.id === v.id);
        const delta = r?.change === 'hotter' ? 1 : r?.change === 'cooler' ? -1 : 0;
        if (!t || !delta || seen.has(t.id)) continue; // one move per tension per reply
        seen.add(t.id);
        t.shifts = [...(Array.isArray(t.shifts) ? t.shifts : []), { delta, msgId: ref.msgId, swipeId: ref.swipeId ?? 0 }].slice(-12);
        moved++;
    }
    return moved;
}

const TENSION_PHASE = {
    setup: 'Let the tensions surface in small ways; nothing has to break yet.',
    rising: 'Turn up the heat: each tension costs a little more than last time.',
    midpoint: 'A tension takes a turn that changes how someone sees it.',
    crisis: 'Let the tensions tangle: easing one should worsen another.',
    climax: 'Tensions come to a head; people must choose.',
    resolution: 'Show what each tension cost and what changed.',
};

/** Tensions for the writer: the ones whose sides are on stage (or involve the player), hottest first, at most two. */
export function tensionLines(st, chat, prog, player = '') {
    const open = openTensions(st, chat);
    if (!open.length) return '';
    const stage = onStageNames(chat, open.flatMap(t => t.sides)).map(n => n.toLowerCase());
    const isPlayer = n => !!player && sameNameLoose(n, player);
    const on = open
        .filter(t => t.sides.some(n => isPlayer(n) || stage.some(x => sameNameLoose(x, n))))
        .sort((a, b) => b.heat - a.heat)
        .slice(0, 2);
    if (!on.length) return '';
    const line = t => {
        const who = t.kind === 'inner' ? `${t.sides[0]} is torn` : t.sides.join(' vs ');
        const wants = t.wants.length ? `: ${t.wants.join(' / ')}` : '';
        return `- ${who}${wants} (${t.why}) · heat ${t.heat}/5${t.next ? ` · next: ${t.next}` : ''}`;
    };
    return `Tensions in play (show them in small moments, subtext and costly choices; the world and other characters push, but never decide what the player's character feels or chooses). ${TENSION_PHASE[prog.phase] ?? ''}\n${on.map(line).join('\n')}`;
}
