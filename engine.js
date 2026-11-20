/*
 * Ouroboros — background jobs: the Scout (finds seeds) and the Architect (writes, scores, prunes
 * and locks fates). One job at a time, never while the chat is generating, results dropped if the
 * chat changed meanwhile.
 */

import { ask } from './ai.js';
import {
    SIZES, sizeOf, PHASES, phaseInfo, progressOf, lockPoint, layerProgress, layers, alive, lockedFate, spawnRoom,
    liveSeeds, addSeeds, paySeeds, trimToChat, applyArchitect, advanceArc, countBotSince, recentTranscript,
    cleanMessage, parseJsonLoose, SEED_KINDS, secretsByTiming, backfillPlan, backfillUntil, backfillRef,
    applyScoutSecrets, activeSecrets, intensityOf, tonesFor, sameToneBirth, TONES,
    shapeOf, CANON, normProtected, PROTECT_RULES, onStageNames, breaksProtection,
    seedsForArchitect, seedsForScout, pastLines,
} from './lib.js';

const LOG = '[Ouroboros]';
const ctx = () => SillyTavern.getContext();

/** @type {{settings:()=>any, state:()=>any, save:()=>void, changed:()=>void, generating:()=>boolean, chatId:()=>string, diag:(m:string)=>void, onLeak:(info:{msgId:number, swipeId:number, chatId:string})=>void, lore:()=>Array<{title:string, content:string}>}} */
let host;
export const status = { busy: null, lastOk: null, lastError: null, queued: [], progress: '' };

export function initEngine(h) { host = h; }

// ---------------------------------------------------------------- queue

let chain = Promise.resolve();
let scoutTimer = null;
const pending = new Set();

function enqueue(kind, fn) {
    if (pending.has(kind)) return chain;
    pending.add(kind);
    status.queued = [...pending];
    chain = chain.then(async () => {
        pending.delete(kind);
        status.queued = [...pending];
        await waitIdle();
        status.busy = kind;
        host.changed();
        try {
            await fn();
        } catch (e) {
            status.lastError = { kind, at: Date.now(), msg: String(e?.message ?? e) };
            host.diag(`ERROR ${kind}: ${e?.message ?? e}`);
            console.warn(LOG, kind, e);
        } finally {
            status.busy = null;
            host.changed();
        }
    });
    return chain;
}

async function waitIdle() {
    for (let i = 0; i < 600 && host.generating(); i++) await new Promise(r => setTimeout(r, 1000));
}

/** Debounced: several messages in a row become one Scout run. */
export function scheduleScout(delay = 2000) {
    clearTimeout(scoutTimer);
    scoutTimer = setTimeout(() => {
        enqueue('scout', runScout).then(() => maybeArchitect());
    }, delay);
}

/** Seeds from the part of the chat before Ouroboros started (Memory Hub summaries first). */
export function backfillNow() {
    return enqueue('backfill', runBackfill).then(() => maybeArchitect());
}

/** What a backfill of this chat would read, for the button's estimate. */
export function backfillEstimate(st) {
    const chat = ctx().chat ?? [];
    const from = Number(st?.backfilledUntil) || 0;
    const until = st ? backfillUntil(st, chat) : chat.length;
    if (until - from < 3) return null;
    const plan = backfillPlan(chat, ctx().chatMetadata?.memory_hub ?? null, { from, until, chatId: host.chatId() });
    return plan.parts.length ? { ...plan, from, until, calls: plan.parts.length } : null;
}

export function weaveNow(reason = 'manual') {
    return enqueue('architect', () => runArchitect(reason));
}

// ---------------------------------------------------------------- shared prompt parts

const clip = (t, n) => (t.length > n ? t.slice(0, n) + '…' : t);

function storyLanguageHint() {
    return 'Write every text field in the same language the story is written in.';
}

function characterBlock() {
    const c = ctx();
    const cut = (t, n) => { t = cleanMessage(c.substituteParams?.(String(t ?? '')) ?? String(t ?? '')); return t.length > n ? t.slice(0, n) + '…' : t; };
    const one = ch => ch ? `${ch.name}: ${cut([ch.description, ch.personality, ch.scenario].filter(Boolean).join('\n'), 1400)}` : '';
    let chars = [];
    if (c.groupId) {
        const g = (c.groups ?? []).find(x => x.id === c.groupId);
        chars = (g?.members ?? []).map(av => (c.characters ?? []).find(ch => ch.avatar === av)).filter(Boolean).slice(0, 6);
    } else if (c.characterId != null) {
        chars = [c.characters?.[c.characterId]].filter(Boolean);
    }
    const persona = c.powerUserSettings?.persona_description ?? '';
    return [
        ...chars.map(one),
        persona ? `${c.name1 ?? 'User'} (the player): ${cut(persona, 600)}` : `${c.name1 ?? 'User'} is the player.`,
    ].filter(Boolean).join('\n\n');
}

function memoryHubBlock(maxChars = 3000) {
    const mh = ctx().chatMetadata?.memory_hub;
    if (!mh) return '';
    const parts = [];
    if (mh.overview) parts.push(`Overview: ${cleanMessage(mh.overview)}`);
    for (const m of mh.memories ?? []) parts.push(`#${m.start}–${m.end} ${m.title ?? ''}: ${cleanMessage(m.text)}`);
    let out = parts.join('\n');
    if (out.length > maxChars) out = '…' + out.slice(out.length - maxChars);
    return out;
}

const SCOUT_SYSTEM = `You are a continuity scout for an ongoing interactive story. You read the latest replies and note concrete loose threads: things the story introduced that are not resolved yet and could matter later (an object, a person, a secret, a promise, an open question, a place, an inner wound). You never invent anything; you only list what is on the page. You answer with JSON only.`;

async function runScout() {
    const st = host.state();
    const s = host.settings();
    if (!st || st.ended || !s.enabled) return;
    const chatId = host.chatId();
    const chat = ctx().chat ?? [];
    trimToChat(st, chat);
    st.scanned = Array.isArray(st.scanned) ? st.scanned : [];
    const scanned = new Set(st.scanned);
    const targets = [];
    for (let i = chat.length - 1; i >= 0 && targets.length < 3; i--) {
        const m = chat[i];
        if (!m || m.is_system || m.is_user) continue;
        if (i < st.startedAt - 1) break; // the greeting just before the start still counts
        const key = `${i}:${m.swipe_id ?? 0}`;
        if (scanned.has(key)) break;
        targets.unshift(i);
    }
    if (!targets.length) return;

    const prog = progressOf(st, chat);
    const open = seedsForScout(st, chat);
    const from = Math.max(0, targets[0] - 1);
    const transcript = recentTranscript(chat, 6000, targets[targets.length - 1] + 1).split('\n\n').filter(l => Number(l.match(/^#(\d+)/)?.[1]) >= from).join('\n\n');
    const kinds = Object.keys(SEED_KINDS).join('|');
    const last = targets[targets.length - 1];
    // the secret notebook rides along in the same call: clues, who found out, reveals (and leaks)
    const timing = secretsByTiming(st, prog, chat);
    const live = [...timing.hold, ...timing.free];
    const heldIds = new Set(timing.hold.map(v => v.id));
    const S = live.length;
    const user = [
        open.length ? `OPEN THREADS ALREADY NOTED (id: text):\n${open.map(x => `${x.id}: ${x.text}`).join('\n')}` : 'OPEN THREADS ALREADY NOTED: none',
        S ? `HIDDEN TRUTHS OF THIS STORY (numbered; the reader must not learn them before their time):\n${live.map((v, i) => `${i + 1}. ${v.text}${v.unknownTo.length ? ` [hidden from: ${v.unknownTo.join(', ')}]` : ''}`).join('\n')}` : '',
        `LATEST STORY TEXT:\n${transcript}`,
        `TASK:
1. List up to 3 NEW loose threads introduced in messages ${targets.map(i => '#' + i).join(', ')}. Skip atmosphere, trivia, and anything already noted above. Each "text" is one short concrete sentence (at most ~20 words), no interpretation. "msg" is the message number it appeared in.
2. List the ids of noted threads that these messages clearly resolved or paid off.
${S ? `3. For message #${last} only, about the hidden truths:
   "clues": a small detail it showed on the page that points at truth n and could also mean something else, as {"n":1,"text":"…"} (most replies carry none);
   "learned": a character from truth n's hidden-from list who found it out in that message, as {"n":1,"who":"Name"};
   "revealed": numbers of truths the message states outright or makes unmistakable to the reader. Hints and foreshadowing do NOT count.
` : ''}${storyLanguageHint()}
Answer with JSON only:
{"new":[{"text":"…","kind":"${kinds}","msg":${last}}],"paid":["s1"]${S ? ',"clues":[],"learned":[],"revealed":[]' : ''}}
If nothing qualifies: {"new":[],"paid":[]${S ? ',"clues":[],"learned":[],"revealed":[]' : ''}}`,
    ].filter(Boolean).join('\n\n');

    const { value } = await ask({
        source: s.scoutSource, backup: s.scoutBackup, system: SCOUT_SYSTEM, user,
        maxTokens: s.scoutMaxTokens, timeoutSec: s.timeoutSec,
        accept: out => {
            const j = parseJsonLoose(out);
            if (!j || typeof j !== 'object') throw new Error('ผู้เก็บปมตอบไม่เป็น JSON');
            return { ...j, new: Array.isArray(j.new) ? j.new : [], paid: Array.isArray(j.paid) ? j.paid : [] };
        },
        role: 'scout',
    });
    if (host.chatId() !== chatId) return;
    const st2 = host.state();
    if (st2 !== st) return;
    for (const it of value.new.slice(0, 3)) {
        const msgId = targets.includes(Number(it?.msg)) ? Number(it.msg) : last;
        addSeeds(st, [it], { msgId, swipeId: chat[msgId]?.swipe_id ?? 0 }, prog.phase);
    }
    paySeeds(st, chat, value.paid, { msgId: last, swipeId: chat[last]?.swipe_id ?? 0 });
    for (const i of targets) st.scanned.push(`${i}:${chat[i]?.swipe_id ?? 0}`);
    if (st.scanned.length > 300) st.scanned = st.scanned.slice(-300);
    st.lastScoutAt = last;
    const sec = applyScoutSecrets(st, chat, value, live, { msgId: last, swipeId: chat[last]?.swipe_id ?? 0 }, heldIds);
    if (sec.clues || sec.learned || sec.revealed.length) host.diag(`secrets: +${sec.clues} clues, +${sec.learned} learned, ${sec.revealed.length} revealed`);
    status.lastOk = { kind: 'scout', at: Date.now() };
    host.save();
    if (sec.leaked.length && s.leakAction !== 'off') {
        st.leaks = [...(st.leaks ?? []), { msgId: last, swipeId: chat[last]?.swipe_id ?? 0, at: Date.now() }].slice(-20);
        host.diag(`leak suspected at #${last}`);
        host.onLeak({ msgId: last, swipeId: chat[last]?.swipe_id ?? 0, chatId });
    }
}

// ---------------------------------------------------------------- backfill

const BACKFILL_CAP = 15;

async function runBackfill() {
    const st = host.state();
    const s = host.settings();
    if (!st || !s.enabled) return;
    const chatId = host.chatId();
    const chat = ctx().chat ?? [];
    const est = backfillEstimate(st);
    if (!est) return;
    const kinds = Object.keys(SEED_KINDS).join('|');
    let added = 0;
    try {
        for (let i = 0; i < est.parts.length && added < BACKFILL_CAP; i++) {
            const part = est.parts[i];
            status.progress = `${i + 1}/${est.parts.length}`;
            host.changed();
            const open = seedsForScout(st, chat);
            const body = part.kind === 'summary'
                ? `STORY SUMMARIES (from earlier in this chat; "#a–b" are message numbers):\n${part.text}`
                : `STORY TEXT (messages #${part.from}–#${part.to}):\n${recentTranscript(chat, 1e9, part.to + 1).split('\n\n').filter(l => Number(l.match(/^#(\d+)/)?.[1]) >= part.from).join('\n\n')}`;
            const user = [
                open.length ? `OPEN THREADS ALREADY NOTED (id: text):\n${open.map(x => `${x.id}: ${x.text}`).join('\n')}` : 'OPEN THREADS ALREADY NOTED: none',
                `PART ${i + 1} OF ${est.parts.length}, read in story order.\n${body}`,
                `TASK:
1. List up to 5 loose threads introduced in this part that are still unresolved by its end and could matter later (an unopened letter, an unexplained scar, a promise not yet kept, a stranger's name). Skip atmosphere, trivia, anything this part already resolves, and anything already noted above. Each "text" is one short concrete sentence (at most ~20 words). "msg" is the message number where it appears (for a summary, the last number of its range), or null if unknown.
2. List the ids of noted threads that this part clearly resolves.
${storyLanguageHint()}
Answer with JSON only:
{"new":[{"text":"…","kind":"${kinds}","msg":null}],"paid":[]}`,
            ].join('\n\n');
            const { value } = await ask({
                role: 'scout', source: s.scoutSource, backup: s.scoutBackup, system: SCOUT_SYSTEM, user,
                maxTokens: s.scoutMaxTokens, timeoutSec: s.timeoutSec,
                accept: out => {
                    const j = parseJsonLoose(out);
                    if (!j || typeof j !== 'object') throw new Error('ผู้เก็บปมตอบไม่เป็น JSON');
                    return { new: Array.isArray(j.new) ? j.new : [], paid: Array.isArray(j.paid) ? j.paid : [] };
                },
            });
            if (host.chatId() !== chatId || host.state() !== st) return;
            for (const it of value.new.slice(0, 5)) {
                if (added >= BACKFILL_CAP) break;
                const ref = backfillRef(part, it?.msg, chat) ?? { msgId: null, swipeId: 0 };
                const got = addSeeds(st, [it], { ...ref, backfill: true }, 'setup');
                for (const g of got) g.backfill = true;
                added += got.length;
            }
            const endRef = part.kind === 'chat' ? { msgId: part.to, swipeId: chat[part.to]?.swipe_id ?? 0 } : null;
            paySeeds(st, chat, value.paid, endRef);
            st.backfilledUntil = part.kind === 'chat' ? part.to + 1 : Math.max(Number(st.backfilledUntil) || 0, ...part.ranges.map(r => r[1] + 1), est.from);
            host.save();
        }
        st.backfilledUntil = est.until;
        // the live Scout need not re-read what the backfill already covered
        for (let i = est.until - 1; i >= est.from; i--) {
            const m = chat[i];
            if (m && !m.is_user && !m.is_system) { st.scanned = [...(st.scanned ?? []), `${i}:${m.swipe_id ?? 0}`].slice(-300); break; }
        }
        st.lastBackfill = { at: Date.now(), added, parts: est.parts.length };
        status.lastOk = { kind: 'backfill', at: Date.now() };
        host.save();
        host.diag(`backfill ok: +${added} seeds from ${est.parts.length} parts`);
    } finally {
        status.progress = '';
    }
}

// ---------------------------------------------------------------- Architect

/** Does the Architect need to run now? */
export function architectDue(st, chat, s) {
    if (!st || st.ended) return null;
    const prog = progressOf(st, chat);
    const size = sizeOf(st.size);
    for (const l of layers(st)) {
        // open world: the main story is not born on schedule, it emerges on a later pass
        if (!lockedFate(st, l) && alive(st, l).length === 0 && !(l === 'main' && st.shape === 'sandbox')) return 'birth';
        const point = lockPoint(st, l);
        if (point != null && !lockedFate(st, l) && layerProgress(st, prog, l) >= point) return 'lock';
    }
    if (st.cutPending) return 'cut';
    const act = activeSecrets(st, chat);
    // a locked layer without its notebook (at most once per new bot reply, so a model that won't write it can't loop)
    if (countBotSince(chat, st.lastArchitectAt) >= 1) for (const l of layers(st)) if (lockedFate(st, l) && !act.some(v => v.layer === l)) return 'secrets';
    if (size.arcs && prog.arc >= 1 && !(size.arcs !== Infinity && st.arc.index >= size.arcs) && !(size.arcs === Infinity && st.finale)) return 'arc';
    if (st.lastPhase && st.lastPhase !== `${prog.mainPhase}/${prog.phase}`) return 'phase';
    const every = Number(s.every) > 0 ? Number(s.every) : size.every;
    if (countBotSince(chat, st.lastArchitectAt) >= every) return 'cadence';
    return null;
}

function maybeArchitect() {
    const s = host.settings();
    if (!s.enabled) return;
    const reason = architectDue(host.state(), ctx().chat ?? [], s);
    if (reason) weaveNow(reason);
}

const ARCHITECT_SYSTEM = `You are the hidden architect of an ongoing interactive story. The player must be surprised, so you plan in secret. You keep several possible "fates" alive at once: each fate is a complete answer to what is really going on (the hidden truth), its twists, and an ending. Fates must differ in substance (a different culprit, motive, secret or tone of ending), not in details.

Rules:
- The story that already happened is canon. A fate that contradicts it must be marked "contradicted".
- A good fate reuses threads (seeds) the story already planted, so its twist feels inevitable in hindsight.
- Score each living fate 0–100: fit with what actually happened, how many planted seeds it can pay off, and fit with the player's wished moods.
- Never decide the winner yourself; the system locks the best fate at the right time.
- The player directs their own character. Never plan the player's choices; plan the world, the other characters and the hidden truth.
- Prefer seeds that more than one living fate can use (ambiguous clues), so every fate stays possible until the lock.
- "beat" is one short, concrete suggestion for the next scene, written so it never gives away a truth.
- The story writer may tend to soften things or resolve conflicts too early. If something was resolved too easily, do not mark the darker fates "contradicted" for that alone: find the price that easy win carries, or what it hid. "contradicted" means the fate can no longer be true at all.
- This is fiction. Keep the player's chosen intensity even if your own habit is to make things nicer or wrap them up quickly.
- Never decide whom the player's character ends up with, loves or chooses. Endings are about the world, the secrets and the other characters, not the player's romantic choice.
You answer with JSON only.`;

function fateForPrompt(f) {
    return { id: f.id, layer: f.layer, status: f.status, truth: f.truth, twists: f.twists, ending: f.ending, needs: f.needs, score: f.score };
}

async function runArchitect(reason) {
    const st = host.state();
    const s = host.settings();
    if (!st || st.ended || !s.enabled) return;
    const chatId = host.chatId();
    const chat = ctx().chat ?? [];
    trimToChat(st, chat);
    let prog = progressOf(st, chat);
    if (advanceArc(st, chat, prog)) prog = progressOf(st, chat);
    const size = sizeOf(st.size);
    const lays = layers(st);
    const at = chat.length;

    const room = Object.fromEntries(lays.map(l => [l, spawnRoom(st, prog, l)]));
    const { seeds, omittedOpen, omittedPaid } = seedsForArchitect(st, chat);
    const live = st.fates.filter(f => f.status === 'alive' || f.status === 'locked');
    const pruned = st.fates.filter(f => f.status === 'pruned' && f.cycle === st.cycle).slice(-8);
    const layerName = { main: 'main story', arc: `act ${st.arc.index}` };
    const secretsNow = activeSecrets(st, chat);

    const plan = [
        `Plan size: ${size.label} (${SIZES[st.size] ? st.size : 'medium'}), about ${size.target} visible messages${size.arcs ? (size.arcs === Infinity ? ' per act, open-ended acts' : ` in ${size.arcs} acts`) : ''}.`,
        `Progress: main story ${Math.round(prog.main * 100)}% (${prog.mainPhase})${prog.arc != null ? `; act ${st.arc.index} ${Math.round(prog.arc * 100)}% (${prog.arcPhase})` : ''}.`,
        ...lays.map(l => {
            const lk = lockedFate(st, l);
            const pt = lockPoint(st, l);
            return `Layer "${l}" (${layerName[l]}): ${lk ? `LOCKED to fate ${lk.id}` : `${alive(st, l).length} living fates, locks at ${pt == null ? 'the player\'s finale' : Math.round(pt * 100) + '%'}`}; room for ${room[l]} new fate(s).`;
        }),
        st.finale ? 'The player asked for the finale: this act is the last one.' : '',
        prog.done ? 'The planned length is reached: steer to a close.' : '',
    ].filter(Boolean).join('\n');

    const intensity = intensityOf(st.intensity);
    const shape = shapeOf(st.shape);
    const prot = normProtected(st.protected);
    const lore = (host.lore?.() ?? []).slice(0, 40);
    const stage = onStageNames(chat, [...lore.map(l => l.title), ...(st.threads ?? []).map(t => t.name)]);
    const shapeRules = {
        story: '',
        sandbox: 'OPEN WORLD. The player roams; there is no set goal. Acts are local situations rooted where the player is now. Do not pull the player back to one plot. A main story only exists once threads from different acts truly connect.',
        cast: `BIG CAST${st.canon === 'canon' ? ' (CANON)' : ' (AU ALLOWED)'}. Centre fates on characters who have appeared in this story; bring in an absent character only as a twist rooted in planted seeds. ${st.canon === 'canon' ? 'Hidden truths must live in the gaps of canon: never contradict established canon facts about these characters or this world.' : 'You may twist canon. The more a fan is surprised while the story stays consistent with itself, the better.'}`,
        harem: 'SEVERAL LOVE INTERESTS. Spread the secrets: each important character gets a storyline of their own, so nobody is just decoration. Never decide whom the player ends up with.',
    }[st.shape] ?? '';
    const wishes = [
        shapeRules ? `Shape: ${shapeRules}` : '',
        `Intensity: ${intensity.architect}`,
        prot.length ? `PROTECTED CHARACTERS (no fate, twist or secret may break these): ${prot.map(p => `${p.name} (${Object.keys(PROTECT_RULES).filter(r => p[r]).map(r => ({ villain: 'never the villain', death: 'never dies', betray: 'never betrays' })[r]).join(', ')})`).join('; ')}` : '',
        st.moods?.length ? `Wished moods: ${st.moods.join(', ')}` : 'Wished moods: none given.',
        st.premise ? `Player's rough premise (an ingredient, not an order; fates may use or twist it): ${st.premise}` : '',
        st.tropes?.length ? `Tropes the player likes (ingredients): ${st.tropes.join(', ')}` : '',
        st.secretTropes?.picked?.length ? `Hidden tropes (the player chose to not know them; use them as ingredients): ${st.secretTropes.picked.map(p => p.trope).join(', ')}` : '',
    ].filter(Boolean).join('\n');

    const past = [
        ...pastLines(st),
    ].join('\n');

    const mh = memoryHubBlock();
    const budgetChars = Math.max(2000, Number(s.architectBudget) * 2.5);
    const transcript = recentTranscript(chat, budgetChars);

    const tasks = [];
    const askedTones = Object.fromEntries(lays.map(l => [l, tonesFor(st, l, room[l])]));
    for (const l of lays) {
        const what = l === 'arc'
            ? (st.shape === 'sandbox' ? ` (a local situation rooted where the player is now, for act ${st.arc.index}, resolvable within it)` : ` (a self-contained mystery or conflict for act ${st.arc.index}, resolvable within it)`)
            : (st.shape === 'sandbox' && alive(st, 'main').length === 0 ? ' (the bigger story that connects threads from different acts; create these ONLY if seeds from at least two acts truly point at one hidden thing, otherwise create none this pass)' : ' (the deepest secret of the whole story)');
        if (room[l] > 0) tasks.push(`Create ${room[l]} new fate(s) for layer "${l}"${what}, one per tone, in this order: ${askedTones[l].map((t, i) => `fate ${i + 1} "${t}"`).join(', ')} ("bright" = ends well, earned; "bittersweet" = a win that costs; "dark" = a real loss or a betrayal that lands). Give each "id" a new letter, "layer":"${l}", "tone", "truth", up to 3 "twists", "ending", "scent" (ONE word naming its theme), "shadow" (one vague, evocative sentence that hints without revealing), "needs" (ids of seeds it would pay off) a "score", and "harm" (every named character this fate makes the villain, kills or turns traitor, as [{"name","role"}] with role "villain", "dies" or "betrays"; [] if none).`);
    }
    if (live.length) tasks.push('For every living or locked fate listed, return {"id","score","contradicted","reason"} and, if useful, refined "twists"/"ending"/"needs". Do not change a locked fate\'s truth.');
    tasks.push('"seedFates": for each open seed, the fate ids that could use it.');
    tasks.push('"focus": up to 3 open seed ids the writer should touch soon. Near the climax include at least one seed from the setup phase, so the ending echoes the beginning.');
    if (st.shape === 'sandbox') tasks.push('"hooks": two or three openings the world could offer next (a rumour, a stranger, a strange sight), each one sentence; the player may take or ignore them. Also give "beat" as one sentence, no spoilers.');
    else tasks.push(`"beat": the next scene's direction for the ${prog.phase} phase, one sentence, no spoilers.`);
    if (shape.threads) tasks.push(`"threads": a storyline for each important character (up to 5, characters on stage first${st.shape === 'harem' ? ', every love interest gets one' : ''}), as [{"name","want" (what they want),"secret" (what they hide; keep it once set),"next" (one small thing that could happen to them next),"status" ("open" or "resolved")}]. Respect the protected characters.`);
    tasks.push('"pace": "slower" if the story is not ready for its next phase yet, "faster" if it is ahead, else "keep".');
    if (lays.some(l => lockedFate(st, l))) {
        const missing = lays.filter(l => lockedFate(st, l) && !secretsNow.some(v => v.layer === l));
        tasks.push(`"secrets": the hidden truths of the locked fate(s), as the author's notebook. ${missing.length ? `Write 1–3 for layer ${missing.map(l => `"${l}"`).join(' and ')} now, from the locked fate's truth and twists. ` : ''}Each: {"id" (keep the id of a secret listed above; omit for a new one),"layer","text" (what is actually true, a few plain sentences),"hiddenFrom" (names of the characters who don't know it, plus "the reader" if the story hasn't shown it),"when" (what has to happen for it to come out),"changes" (who acts differently once it is out, and how),"clueIdeas" (two or three small things the story could show that point at it and could also mean something else)}. A truth is about the world and the other characters, not the player's own past or motives. Return only new secrets and ones whose details you refine; never drop or rewrite a listed one.`);
    }
    if (size.arcs && prog.arc >= 0.85) tasks.push('"arcSummary": two sentences on how this act resolved (or is resolving).');

    const user = [
        `PLAN\n${plan}`,
        wishes ? `PLAYER WISHES\n${wishes}` : '',
        `CHARACTERS\n${characterBlock()}`,
        lore.length ? `LORE IN PLAY (lorebook entries active in recent turns)\n${clip(lore.map(l => `- ${l.title}: ${cleanMessage(l.content)}`).join('\n'), 4000)}` : '',
        stage.length ? `ON STAGE RECENTLY: ${stage.join(', ')}` : '',
        shape.threads && st.threads?.length ? `CHARACTER THREADS\n${st.threads.map(t => `${t.name} [${t.status}] wants: ${t.want} | hides: ${t.secret} | next: ${t.next}`).join('\n')}` : '',
        past ? `PAST\n${past}` : '',
        mh ? `EARLIER IN THIS CHAT (summaries)\n${mh}` : '',
        `CURRENT FATES\n${live.length ? JSON.stringify(live.map(fateForPrompt)) : 'none yet'}`,
        secretsNow.length ? `AUTHOR'S NOTEBOOK (secrets of the locked fates, as the story stands)\n${secretsNow.map(v => `${v.id} [${v.layer}${v.revealed ? ', REVEALED' : ''}] ${v.text} | hidden from: ${v.unknownTo.join(', ') || 'nobody now'}${v.learned.length ? ` | found out: ${v.learned.join(', ')}` : ''} | clues planted: ${v.clues.length}${v.clues.length ? ` (last: ${v.clues[v.clues.length - 1].text})` : ''}`).join('\n')}` : '',
        pruned.length ? `DISCARDED FATES (do not bring them back as they were)\n${pruned.map(f => `${f.id}: ${f.truth}`).join('\n')}` : '',
        `SEEDS (planted threads${omittedOpen || omittedPaid ? `; ${omittedOpen + omittedPaid} older ones not shown, ${omittedOpen} of them still open` : ''})\n${seeds.length ? seeds.map(x => `${x.id} [${x.kind}, planted in ${x.phase}${size.arcs && x.arc ? ` of act ${x.arc}` : ''}, ${x.status}${x.user ? ', added by the player: weigh it more' : ''}${x.fates?.length ? `, fates ${x.fates.join('/')}` : ''}]: ${x.text}`).join('\n') : 'none yet'}`,
        `RECENT STORY\n${transcript}`,
        `TASK (reason for this pass: ${reason})\n${tasks.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n${storyLanguageHint()}\nAnswer with JSON only:\n{"fates":[…],"seedFates":{"s1":["A"]},"focus":["s1"],"beat":"…","pace":"keep","secrets":[],"arcSummary":""}`,
    ].filter(Boolean).join('\n\n');

    let toneTries = 0;
    const { value, usedBackup } = await ask({
        source: s.architectSource, backup: s.architectBackup, system: ARCHITECT_SYSTEM, user,
        maxTokens: s.architectMaxTokens, timeoutSec: s.timeoutSec,
        accept: out => {
            const j = parseJsonLoose(out);
            if (!j || typeof j !== 'object') throw new Error('ผู้ทอชะตาตอบไม่เป็น JSON');
            const needBirth = lays.some(l => room[l] > 0 && alive(st, l).length === 0 && !(l === 'main' && st.shape === 'sandbox'));
            if (needBirth && !(Array.isArray(j.fates) && j.fates.some(f => f?.truth))) throw new Error('ผู้ทอชะตาไม่ได้เขียนชะตา');
            if (needBirth && prot.length && j.fates.filter(f => f?.truth).every(f => breaksProtection(f, prot))) throw new Error('ชะตาทุกทางแตะตัวละครที่ห้ามแตะ');
            // fates asked for different tones that all came back the same: one more try, then take what came
            if (++toneTries < 2) for (const l of lays) {
                const born = (Array.isArray(j.fates) ? j.fates : []).filter(f => f?.truth && (f.layer ?? lays[0]) === l && !st.fates.some(x => x.id === String(f.id ?? '') && x.status !== 'pruned'));
                if (sameToneBirth(born, askedTones[l])) throw new Error(`ชะตาออกมาโทนเดียวกันหมด (${TONES[String(born[0].tone).toLowerCase()] ?? born[0].tone})`);
            }
            if (reason === 'secrets' && !(Array.isArray(j.secrets) && j.secrets.some(x => x?.text || typeof x === 'string'))) throw new Error('ผู้ทอชะตาไม่ได้เขียนความลับของชะตาที่ล็อก');
            return j;
        },
        role: 'architect',
    });
    if (host.chatId() !== chatId || host.state() !== st) return;
    const res = applyArchitect(st, value, { at, prog, noRush: !!s.noRush });
    if (usedBackup) host.diag(`architect used the backup API (${reason})`);
    if (res.blocked?.length) host.diag(`blocked ${res.blocked.length} fate(s) that broke a protection`);
    const after = progressOf(st, chat);
    st.lastPhase = `${after.mainPhase}/${after.phase}`;
    st.lastWeave = { at: Date.now(), reason, added: res.added.length, pruned: res.pruned.length, locked: res.locked.length };
    status.lastOk = { kind: 'architect', at: Date.now() };
    host.save();
    host.diag(`architect ok (${reason}): +${res.added.length} -${res.pruned.length} lock ${res.locked.length}`);
    // a fate just locked: write its notebook right away rather than at the next cadence
    if (res.locked.length) weaveNow('secrets');
}

export const phaseLabel = id => phaseInfo(id).label;
export { PHASES };
