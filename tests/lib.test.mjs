// Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    newState, normalizeState, progressOf, phaseAt, spawnRoom, applyArchitect, addSeeds, paySeeds, liveSeeds,
    trimToChat, cutThreads, lockedPastChat, unlockFate, advanceArc, newCycle, buildInjection, pickFocus,
    parseJsonLoose, cleanMessage, recentTranscript, pickSecretTropes, stats, nextFateId, lockIfDue,
    carryState, secretsByTiming, backfillPlan, backfillUntil, backfillRef,
    mergeSecrets, applyScoutSecrets, activeSecrets, secretView,
    tonesFor, sameToneBirth, looksLikeRefusal, intensityOf,
    mainGateOpen, breaksProtection, normProtected, mergeThreads, onStageNames,
    seedsForArchitect, seedsForScout, pastLines, markShown, acceptSeedItems,
    mergeTensions, openTensions, applyScoutTensions, tensionLines, MAX_OPEN_TENSIONS,
} from '../lib.js';

/** A chat of n visible messages, alternating user/bot, starting with a bot greeting. */
function chatOf(n) {
    return Array.from({ length: n }, (_, i) => ({ name: i % 2 ? 'User' : 'Bot', is_user: i % 2 === 1, mes: `message ${i}`, swipe_id: 0 }));
}
const fate = (truth, extra = {}) => ({ truth, twists: ['t'], ending: 'e', scent: 'กลิ่น', shadow: 'เงา', score: 50, ...extra });

// ---------------------------------------------------------------- phases and progress

test('phaseAt follows the table and the pacing shift', () => {
    assert.equal(phaseAt(0), 'setup');
    assert.equal(phaseAt(0.2), 'rising');
    assert.equal(phaseAt(0.5), 'midpoint');
    assert.equal(phaseAt(0.6), 'crisis');
    assert.equal(phaseAt(0.8), 'climax');
    assert.equal(phaseAt(0.95), 'resolution');
    assert.equal(phaseAt(1.5), 'resolution');
    assert.equal(phaseAt(0.16, 0.05), 'setup', 'slower pace holds the phase back');
    assert.equal(phaseAt(0.12, -0.05), 'rising', 'faster pace moves it forward');
    assert.equal(phaseAt(0.12, -5), phaseAt(0.12, -0.1), 'shift is clamped');
});

test('progress counts visible messages from the start, hidden ones are skipped', () => {
    const st = newState({ size: 'short', startedAt: 10 });
    const chat = chatOf(40);
    chat[20].is_system = true;
    const p = progressOf(st, chat);
    assert.equal(p.main, 29 / 60);
    assert.equal(p.phase, 'midpoint');
    assert.equal(p.arc, null);
});

test('long plans have arcs; epic main waits for the finale', () => {
    const st = newState({ size: 'long' });
    const p = progressOf(st, chatOf(100));
    assert.equal(p.arcLen, 127);
    assert.ok(Math.abs(p.arc - 100 / 127) < 1e-9);
    assert.equal(p.mainPhase, 'rising');

    const ep = newState({ size: 'epic' });
    let q = progressOf(ep, chatOf(100));
    assert.equal(q.mainPhase, 'setup', 'first arc not done yet → still setting up');
    ep.arc = { index: 3, startedAt: 0, summaries: [] };
    q = progressOf(ep, chatOf(40));
    assert.equal(q.mainPhase, 'rising');
    assert.equal(q.done, false);
    ep.finale = true;
    q = progressOf(ep, chatOf(150));
    assert.equal(q.done, true);
    assert.equal(q.mainPhase, 'resolution');
});

// ---------------------------------------------------------------- fates

test('Architect creates fates up to the size limit, then no more after the spawn window', () => {
    const st = newState({ size: 'medium' });
    const chat = chatOf(10);
    const prog = progressOf(st, chat);
    assert.equal(spawnRoom(st, prog, 'main'), 3);
    const r = applyArchitect(st, { fates: [fate('A'), fate('B'), fate('C'), fate('D')] }, { at: 10, prog });
    assert.deepEqual(r.added, ['A', 'B', 'C']);
    assert.equal(st.fates.length, 3);
    st.fates[0].status = 'pruned';
    const late = progressOf(st, chatOf(80)); // 53%
    assert.equal(spawnRoom(st, late, 'main'), 0, 'past 45% no new fates while others live');
});

test('a contradicted fate is pruned, its only seeds become red herrings, the last fate is never pruned', () => {
    const st = newState({ size: 'short' });
    const chat = chatOf(6);
    const prog = progressOf(st, chat);
    addSeeds(st, [{ text: 'จดหมายปิดผนึก', kind: 'object' }, { text: 'รอยไหม้บนมือ', kind: 'wound' }], { msgId: 2, swipeId: 0 }, 'setup');
    applyArchitect(st, { fates: [fate('พ่อบ้าน', { needs: ['s1'] }), fate('ยาย', { needs: ['s1', 's2'] })] }, { at: 6, prog });
    assert.deepEqual(st.seeds[0].fates, ['A', 'B']);
    assert.deepEqual(st.seeds[1].fates, ['B']);
    applyArchitect(st, { fates: [{ id: 'B', contradicted: true, reason: 'ยายตายแล้ว' }] }, { at: 8, prog });
    assert.equal(st.fates[1].status, 'pruned');
    assert.equal(st.fates[1].pruneReason, 'ยายตายแล้ว');
    assert.equal(st.seeds[1].herring, true);
    assert.equal(st.seeds[0].herring, false);
    applyArchitect(st, { fates: [{ id: 'A', contradicted: true }] }, { at: 9, prog });
    assert.equal(st.fates[0].status, 'alive', 'the last living fate stays');
});

test('low scores twice in a row prune a fate', () => {
    const st = newState({ size: 'medium' });
    const prog = progressOf(st, chatOf(4));
    applyArchitect(st, { fates: [fate('a'), fate('b')] }, { at: 4, prog });
    applyArchitect(st, { fates: [{ id: 'A', score: 10 }] }, { at: 5, prog });
    assert.equal(st.fates[0].status, 'alive');
    applyArchitect(st, { fates: [{ id: 'A', score: 12 }] }, { at: 6, prog });
    assert.equal(st.fates[0].status, 'pruned');
});

test('the best fate locks at the lock point; a locked truth cannot be rewritten', () => {
    const st = newState({ size: 'short' });
    applyArchitect(st, { fates: [fate('a', { score: 40 }), fate('b', { score: 80 })] }, { at: 4, prog: progressOf(st, chatOf(4)) });
    const chat = chatOf(31); // 31/60 > 50%
    const r = applyArchitect(st, { fates: [] }, { at: 31, prog: progressOf(st, chat) });
    assert.deepEqual(r.locked, ['B']);
    assert.equal(st.fates[0].status, 'pruned');
    applyArchitect(st, { fates: [{ id: 'B', truth: 'changed', ending: 'new ending' }] }, { at: 32, prog: progressOf(st, chat) });
    assert.equal(st.fates[1].truth, 'b');
    assert.equal(st.fates[1].ending, 'new ending');
});

test('proposed ids are remapped to real ones in seedFates', () => {
    const st = newState({ size: 'medium' });
    addSeeds(st, [{ text: 'กุญแจทองเหลือง' }], { msgId: 1 }, 'setup');
    st.fates.push({ id: 'A', layer: 'main', status: 'pruned', truth: 'old' });
    const prog = progressOf(st, chatOf(4));
    applyArchitect(st, { fates: [{ id: 'A', ...fate('new') }], seedFates: { s1: ['A'] } }, { at: 4, prog });
    // "A" is taken by a pruned fate, so the new one is B and the seed points at B
    assert.equal(st.fates[1].id, 'B');
    assert.deepEqual(st.seeds[0].fates, ['B']);
    assert.equal(nextFateId(st), 'C');
});

test('cutting threads prunes unlocked fates and lets new ones in past the spawn window', () => {
    const st = newState({ size: 'medium' });
    applyArchitect(st, { fates: [fate('a'), fate('b'), fate('c')] }, { at: 4, prog: progressOf(st, chatOf(4)) });
    const prog = progressOf(st, chatOf(80));
    assert.equal(cutThreads(st, 80), 3);
    assert.equal(spawnRoom(st, prog, 'main'), 3);
    applyArchitect(st, { fates: [fate('x'), fate('y')] }, { at: 81, prog });
    assert.equal(st.cutPending, false);
    assert.equal(st.fates.filter(f => f.status === 'alive').length, 2);
    assert.equal(st.fates.filter(f => f.status === 'pruned' && f.pruneReason.startsWith('ตัดด้าย')).length, 3);
});

test('a lock made after the current chat length can be undone', () => {
    const st = newState({ size: 'short' });
    applyArchitect(st, { fates: [fate('a'), fate('b')] }, { at: 4, prog: progressOf(st, chatOf(4)) });
    lockIfDue(st, progressOf(st, chatOf(40)), 'main', 40);
    assert.equal(lockedPastChat(st, chatOf(41)).length, 0);
    const past = lockedPastChat(st, chatOf(20));
    assert.equal(past.length, 1);
    assert.ok(unlockFate(st, past[0].id));
    assert.equal(st.fates.filter(f => f.status === 'alive').length, 1);
});

// ---------------------------------------------------------------- seeds

test('seeds skip near-duplicates and follow swipes', () => {
    const st = newState();
    const chat = chatOf(6);
    addSeeds(st, [{ text: 'จดหมายของยาย' }, { text: 'จดหมายของยาย!' }, { text: 'xy' }], { msgId: 4, swipeId: 0 }, 'setup');
    assert.equal(st.seeds.length, 1);
    assert.equal(st.seeds[0].kind, 'question', 'unknown kind falls back');
    chat[4].swipe_id = 1;
    assert.equal(liveSeeds(st, chat).length, 0, 'seed from a swiped-away reply sleeps');
    chat[4].swipe_id = 0;
    assert.equal(liveSeeds(st, chat).length, 1, 'and wakes when swiped back');
});

test('a payoff that is swiped away counts as open again; deleting messages trims seeds', () => {
    const st = newState();
    const chat = chatOf(10);
    addSeeds(st, [{ text: 'ปมแรก' }, { text: 'ปมที่สอง' }], { msgId: 2, swipeId: 0 }, 'setup');
    assert.equal(paySeeds(st, chat, ['s1'], { msgId: 2, swipeId: 0 }), 0, 'cannot pay off in the reply that planted it');
    assert.equal(paySeeds(st, chat, ['s1'], { msgId: 8, swipeId: 0 }), 1);
    assert.equal(liveSeeds(st, chat).find(s => s.id === 's1').status, 'paid');
    chat[8].swipe_id = 2;
    assert.equal(liveSeeds(st, chat).find(s => s.id === 's1').status, 'open');
    addSeeds(st, [{ text: 'ปมท้าย' }], { msgId: 9 }, 'rising');
    assert.equal(trimToChat(st, chatOf(5)), 1);
    assert.equal(st.seeds.find(s => s.id === 's1').status, 'open');
    assert.equal(st.seeds.find(s => s.id === 's1').paidBy, null);
});

// ---------------------------------------------------------------- arcs and cycles

test('an arc that ran its length closes and the next one starts', () => {
    const st = newState({ size: 'long' });
    applyArchitect(st, { fates: [fate('main', { layer: 'main' }), fate('arc1', { layer: 'arc' }), fate('arc2', { layer: 'arc' })] }, { at: 2, prog: progressOf(st, chatOf(2)) });
    assert.equal(st.fates.filter(f => f.layer === 'arc').length, 2);
    const chat = chatOf(130);
    const prog = progressOf(st, chat);
    lockIfDue(st, prog, 'arc', 130);
    assert.ok(advanceArc(st, chat, prog));
    assert.equal(st.arc.index, 2);
    assert.equal(st.arc.startedAt, 130);
    assert.equal(st.arc.summaries.length, 1);
    assert.equal(st.fates.filter(f => f.layer === 'arc' && f.status === 'done').length, 1);
    assert.equal(spawnRoom(st, progressOf(st, chat), 'arc'), 2);
    assert.equal(st.fates.find(f => f.layer === 'main').status, 'alive');
});

test('a new cycle keeps open seeds and archives truths', () => {
    const st = newState({ size: 'short' });
    addSeeds(st, [{ text: 'ปมที่ยังค้าง' }], { msgId: 1 }, 'setup');
    applyArchitect(st, { fates: [fate('a', { score: 90 }), fate('b')] }, { at: 2, prog: progressOf(st, chatOf(2)) });
    const chat = chatOf(70);
    lockIfDue(st, progressOf(st, chat), 'main', 70);
    newCycle(st, chat);
    assert.equal(st.cycle, 2);
    assert.equal(st.startedAt, 70);
    assert.deepEqual(st.past[0].truths, ['a']);
    assert.equal(st.seeds.length, 1);
    assert.equal(spawnRoom(st, progressOf(st, chat), 'main'), 2);
});

// ---------------------------------------------------------------- injection

test('injection carries phase, beat and focus seeds, never fate truths before lock', () => {
    const st = newState({ size: 'medium' });
    const chat = chatOf(40);
    addSeeds(st, [{ text: 'จดหมายปิดผนึก' }], { msgId: 3 }, 'setup');
    applyArchitect(st, {
        fates: [fate('คนร้ายคือพ่อบ้าน', { needs: ['s1'] }), fate('ยายยังไม่ตาย')],
        beat: 'ให้มีคนที่สองสนใจจดหมาย', focus: ['s1'], secrets: ['คนร้ายคือพ่อบ้าน'],
    }, { at: 40, prog: progressOf(st, chat) });
    const text = buildInjection(st, chat);
    assert.match(text, /Rising action/);
    assert.match(text, /Next beat: ให้มีคนที่สองสนใจจดหมาย/);
    assert.match(text, /- จดหมายปิดผนึก/);
    assert.doesNotMatch(text, /พ่อบ้าน/, 'no truth leaks while nothing is locked');
    assert.doesNotMatch(text, /\{\{/);
});

test('after lock the secrets are held, then released at the climax', () => {
    const st = newState({ size: 'short' });
    applyArchitect(st, { fates: [fate('a', { score: 90 }), fate('b')] }, { at: 2, prog: progressOf(st, chatOf(2)) });
    let chat = chatOf(32);
    applyArchitect(st, { secrets: ['ยายคือคนร้าย'] }, { at: 32, prog: progressOf(st, chat) });
    assert.match(buildInjection(st, chat), /Do not reveal them yet[\s\S]*ยายคือคนร้าย/);
    assert.match(buildInjection(st, chat), /they find it/, 'the find-it rule rides along with hidden truths');
    chat = chatOf(50);
    assert.match(buildInjection(st, chat), /may now come out[\s\S]*ยายคือคนร้าย/);
    st.ended = true;
    assert.equal(buildInjection(st, chat), '');
});

test('the ouroboros rule brings back a setup seed at the climax', () => {
    const st = newState({ size: 'short' });
    addSeeds(st, [{ text: 'ของขวัญชิ้นแรก' }], { msgId: 1 }, 'setup');
    addSeeds(st, [{ text: 'ปมกลางเรื่อง' }], { msgId: 20 }, 'rising');
    st.focus = ['s2'];
    const chat = chatOf(48);
    const focus = pickFocus(st, chat, progressOf(st, chat));
    assert.deepEqual(focus.map(s => s.id), ['s2', 's1']);
});

// ---------------------------------------------------------------- helpers

test('parseJsonLoose handles fences, prose, trailing commas and think blocks', () => {
    assert.deepEqual(parseJsonLoose('```json\n{"a":1,}\n```'), { a: 1 });
    assert.deepEqual(parseJsonLoose('<think>{"no":1}</think>Sure! {"a":[1,2,],"b":“x”}'), { a: [1, 2], b: 'x' });
    assert.equal(parseJsonLoose('no json here'), null);
});

test('cleanMessage and recentTranscript strip markup and respect the budget', () => {
    assert.equal(cleanMessage('<think>secret</think>Hello <b>there</b>\n```code```'), 'Hello there');
    const chat = chatOf(10);
    chat[9].is_system = true;
    const t = recentTranscript(chat, 40);
    assert.match(t, /#8 Bot: message 8/);
    assert.doesNotMatch(t, /#9/);
    assert.ok(t.split('\n\n').length <= 3);
});

test('secret tropes come from the chosen categories without repeats', () => {
    let i = 0;
    const seq = [0.1, 0.9, 0.5];
    const picked = pickSecretTropes(['ปริศนา'], 2, () => seq[i++ % seq.length]);
    assert.equal(picked.length, 2);
    assert.notEqual(picked[0].trope, picked[1].trope);
    assert.ok(picked.every(p => p.cat === 'ปริศนา'));
    const st = newState({ secretCats: ['ดาร์ก', 'ไม่มีหมวดนี้'] });
    assert.deepEqual(st.secretTropes.categories, ['ดาร์ก']);
});

test('stats and normalizeState', () => {
    const st = normalizeState({ size: 'long', seeds: [], fates: [] });
    assert.equal(st.arc.index, 1);
    const s = stats(st, chatOf(3));
    assert.deepEqual(s.alive, { main: 0, arc: 0 });
    assert.equal(normalizeState(null), null);
});

// ---------------------------------------------------------------- v0.2

test('a plan carried into a continued chat keeps progress, seeds and the lock', () => {
    const st = newState({ size: 'short' });
    const old = chatOf(40);
    addSeeds(st, [{ text: 'ปมที่ค้างอยู่' }, { text: 'ปมที่เฉลยแล้ว' }], { msgId: 2 }, 'setup');
    addSeeds(st, [{ text: 'ปมจาก swipe ที่ทิ้งไป' }], { msgId: 5, swipeId: 1 }, 'setup');
    paySeeds(st, old, ['s2'], { msgId: 10, swipeId: 0 });
    applyArchitect(st, { fates: [fate('a', { score: 90 }), fate('b')] }, { at: 4, prog: progressOf(st, chatOf(4)) });
    lockIfDue(st, progressOf(st, old), 'main', 40);
    const next = carryState(st, old, { chatId: 'chat2', from: 'chat1' });
    assert.equal(next.owner.chatId, 'chat2');
    assert.deepEqual(next.carriedFrom, ['chat1']);
    const fresh = chatOf(2);
    assert.equal(progressOf(next, fresh).main, 42 / 60, 'progress continues from the old chat');
    assert.deepEqual(liveSeeds(next, fresh).map(x => [x.text, x.status]), [['ปมที่ค้างอยู่', 'open'], ['ปมที่เฉลยแล้ว', 'paid']]);
    assert.equal(lockedPastChat(next, fresh).length, 0, 'old lock positions do not look like a rewind');
    assert.equal(st.owner.chatId, undefined, 'the old state is not touched');
});

test('secretsByTiming holds secrets until their own layer reaches the climax', () => {
    const st = newState({ size: 'long' });
    st.fates.push({ id: 'A', layer: 'main', status: 'locked' }, { id: 'B', layer: 'arc', status: 'locked' });
    st.secrets = [{ text: 'main truth', layer: 'main' }, { text: 'arc truth', layer: 'arc' }];
    const r = secretsByTiming(st, { mainPhase: 'rising', arcPhase: 'climax' });
    assert.deepEqual(r.hold.map(v => v.text), ['main truth']);
    assert.deepEqual(r.free.map(v => v.text), ['arc truth']);
    assert.deepEqual(r.revealed, []);
});

// ---------------------------------------------------------------- backfill

test('backfill reads Memory Hub summaries first and raw messages only after them', () => {
    const chat = chatOf(60);
    const mh = {
        overview: 'เรื่องย่อ',
        lastEnd: 39,
        memories: [
            { start: 0, end: 19, title: 'ต้นเรื่อง', text: 'ยายให้จดหมาย' },
            { start: 20, end: 39, title: 'กลางเรื่อง', text: 'คนสวนมีแผล' },
            { start: 0, end: 30, title: 'จากตอนก่อน', text: 'ตอนก่อน', origin: { chat: 'old', start: 0, end: 30 } },
        ],
    };
    const plan = backfillPlan(chat, mh, { until: 55, chatId: 'cur', chunkChars: 60 });
    assert.equal(plan.summaries, 3);
    assert.equal(plan.parts[0].kind, 'summary');
    assert.match(plan.parts[0].text, /Overview: เรื่องย่อ/);
    assert.match(plan.parts[0].text, /\(earlier chapter\)/);
    assert.deepEqual(plan.parts[0].ranges, [[0, 19], [20, 39]]);
    const raw = plan.parts.filter(p => p.kind === 'chat');
    assert.equal(raw[0].from, 40, 'raw reading starts where the summaries stop');
    assert.equal(raw[raw.length - 1].to, 54);
    assert.ok(raw.length > 1);
});

test('without Memory Hub the whole range is read raw, capped to the newest parts', () => {
    const chat = chatOf(200);
    const plan = backfillPlan(chat, null, { until: 200, chunkChars: 30, maxChunkChars: 30, maxParts: 5 });
    assert.equal(plan.parts.length, 5);
    assert.equal(plan.parts[4].to, 199);
    assert.ok(plan.skipped > 0);
    const big = backfillPlan(chat, null, { until: 200, maxParts: 20 });
    assert.ok(big.parts.length <= 20);
    assert.equal(big.skipped, 0, 'chunks grow so a normal chat fits in 20 parts');
});

test('backfill range ends where the live Scout started, refs stay inside the part', () => {
    const st = newState();
    const chat = chatOf(30);
    assert.equal(backfillUntil(st, chat), 30);
    st.scanned = ['26:0', '28:1'];
    assert.equal(backfillUntil(st, chat), 26);
    chat[12].swipe_id = 2;
    assert.deepEqual(backfillRef({ kind: 'chat', from: 10, to: 15 }, 12, chat), { msgId: 12, swipeId: 2 });
    assert.equal(backfillRef({ kind: 'chat', from: 10, to: 15 }, 16, chat), null);
    assert.deepEqual(backfillRef({ kind: 'summary', ranges: [[0, 19]] }, '19', chat), { msgId: 19, swipeId: 0 });
    assert.equal(backfillRef({ kind: 'summary', ranges: [] }, null, chat), null);
    assert.equal(backfillRef({ kind: 'summary', ranges: [[0, 19]] }, null, chat), null, 'null is unknown, not message 0');
    assert.equal(backfillRef({ kind: 'chat', from: 0, to: 5 }, '', chat), null);
});

// ---------------------------------------------------------------- v0.4: who knows, clues, reveals

function lockedShort() {
    const st = newState({ size: 'short' });
    applyArchitect(st, { fates: [fate('a', { score: 90 }), fate('b')] }, { at: 2, prog: progressOf(st, chatOf(2)) });
    lockIfDue(st, progressOf(st, chatOf(32)), 'main', 32);
    return st;
}

test('secrets keep their ids; a known id is refined, its text never changes, nothing is dropped', () => {
    const st = lockedShort();
    mergeSecrets(st, [{ text: 'ยายคือคนร้าย', hiddenFrom: ['Mira', 'the reader'], when: 'เมื่อเปิดจดหมาย', changes: 'Mira หนีออกจากบ้าน', clueIdeas: ['รอยหมึก', 'กลิ่นยา'] }]);
    assert.equal(st.secrets[0].id, 'K1');
    mergeSecrets(st, [{ id: 'K1', text: 'อย่างอื่น', hiddenFrom: ['Mira'] }, { text: 'พ่อบ้านรู้เห็น' }]);
    assert.equal(st.secrets[0].text, 'ยายคือคนร้าย');
    assert.deepEqual(st.secrets[0].hiddenFrom, ['Mira']);
    assert.equal(st.secrets[1].id, 'K2');
    mergeSecrets(st, []);
    assert.equal(st.secrets.length, 2, 'an empty list drops nothing');
});

test('the Scout records clues, who learned, and reveals; swiping the reply away undoes them', () => {
    const st = lockedShort();
    mergeSecrets(st, [{ text: 'ยายคือคนร้าย', hiddenFrom: ['Mira', 'Kai'] }]);
    const chat = chatOf(36);
    let live = activeSecrets(st, chat);
    const held = new Set(live.map(v => v.id));
    let r = applyScoutSecrets(st, chat, { clues: [{ n: 1, text: 'หมึกที่นิ้วยาย' }, { n: 1, text: 'ซ้ำในข้อความเดียว' }], learned: [{ n: 1, who: 'kai' }, { n: 1, who: 'ไม่มีชื่อนี้' }] }, live, { msgId: 34, swipeId: 0 }, held);
    assert.deepEqual([r.clues, r.learned], [1, 1]);
    let v = secretView(chat, st.secrets[0]);
    assert.deepEqual(v.learned, ['Kai']);
    assert.deepEqual(v.unknownTo, ['Mira']);
    assert.match(buildInjection(st, chat), /Still unknown to: Mira[\s\S]*Already knows: Kai[\s\S]*Clues already planted: หมึกที่นิ้วยาย/);

    live = activeSecrets(st, chat);
    r = applyScoutSecrets(st, chat, { revealed: [1] }, live, { msgId: 35, swipeId: 0 }, held);
    assert.deepEqual(r.leaked, ['K1'], 'revealed while held = leak');
    assert.deepEqual(secretView(chat, st.secrets[0]).unknownTo, ['Mira'], 'characters still have to find out');
    mergeSecrets(st, [{ id: 'K1', hiddenFrom: ['Mira', 'the reader'] }]);
    assert.deepEqual(secretView(chat, st.secrets[0]).unknownTo, ['Mira'], 'the reader knows once it is out');
    assert.match(buildInjection(st, chat), /Already revealed/);
    assert.doesNotMatch(buildInjection(st, chat), /Hidden truths/);

    chat[35].swipe_id = 1; // the user swiped the leaky reply away
    v = secretView(chat, st.secrets[0]);
    assert.equal(v.revealed, null);
    assert.match(buildInjection(st, chat), /Hidden truths/);
    chat[34].swipe_id = 1;
    assert.equal(secretView(chat, st.secrets[0]).clues.length, 0);
});

test('the aftermath reminder fades after a while; act secrets of a finished act stay out', () => {
    const st = lockedShort();
    mergeSecrets(st, [{ text: 'ความจริง', changes: 'ทุกคนหันหลังให้ยาย' }]);
    st.secrets[0].revealed = { msgId: 34, swipeId: 0 };
    assert.match(buildInjection(st, chatOf(50)), /→ ทุกคนหันหลังให้ยาย/);
    assert.doesNotMatch(buildInjection(st, chatOf(80)), /Already revealed/);

    const lg = newState({ size: 'long' });
    lg.fates.push({ id: 'A', layer: 'arc', status: 'locked' });
    mergeSecrets(lg, [{ text: 'ความลับองก์หนึ่ง', layer: 'arc' }]);
    assert.equal(activeSecrets(lg, chatOf(10)).length, 1);
    lg.arc.index = 2;
    assert.equal(activeSecrets(lg, chatOf(10)).length, 0);
});

test('deleting messages and carrying to a new chat keep secret records consistent', () => {
    const st = lockedShort();
    mergeSecrets(st, [{ text: 'ความจริง', hiddenFrom: ['Mira'] }]);
    const chat = chatOf(40);
    const live = activeSecrets(st, chat);
    applyScoutSecrets(st, chat, { clues: [{ n: 1, text: 'เบาะแส' }], learned: [{ n: 1, who: 'Mira' }] }, live, { msgId: 38, swipeId: 0 });
    const next = carryState(st, chat, { chatId: 'c2', from: 'c1' });
    assert.equal(secretView(chatOf(2), next.secrets[0]).learned[0], 'Mira', 'carried records stay valid in the new chat');
    trimToChat(st, chatOf(30));
    assert.equal(st.secrets[0].clues.length, 0);
    assert.equal(st.secrets[0].learned.length, 0);
});

// ---------------------------------------------------------------- v0.5: guards against a model's habits

test('tones are assigned by intensity and a respawn fills the missing tone', () => {
    const st = newState({ size: 'medium', intensity: 'real' });
    assert.deepEqual(tonesFor(st, 'main', 3), ['bittersweet', 'dark', 'bright']);
    applyArchitect(st, { fates: [fate('a', { tone: 'bittersweet' }), fate('b', { tone: 'DARK' }), fate('c', { tone: 'bright' })] }, { at: 2, prog: progressOf(st, chatOf(2)) });
    assert.equal(st.fates[1].tone, 'dark', 'tone is normalised');
    st.fates[1].status = 'pruned';
    assert.deepEqual(tonesFor(st, 'main', 1), ['dark'], 'the gap left by the pruned dark fate');
    assert.deepEqual(tonesFor(newState({ intensity: 'dark' }), 'main', 2), ['dark', 'bittersweet']);
    assert.equal(newState({ intensity: 'nonsense' }).intensity, 'real');
});

test('a birth where every fate came back the same tone is caught', () => {
    assert.equal(sameToneBirth([{ tone: 'bright' }, { tone: 'bright' }], ['bittersweet', 'dark']), true);
    assert.equal(sameToneBirth([{ tone: 'bright' }, { tone: 'dark' }], ['bittersweet', 'dark']), false);
    assert.equal(sameToneBirth([{ tone: 'bright' }, {}], ['bittersweet', 'dark']), false, 'missing tones are not judged');
    assert.equal(sameToneBirth([{ tone: 'dark' }, { tone: 'dark' }], ['dark', 'dark']), false, 'it was asked for one tone');
});

test('refusals are told apart from JSON answers', () => {
    assert.ok(looksLikeRefusal("I'm sorry, but I can't help with that request."));
    assert.ok(looksLikeRefusal('I cannot continue this story as it violates content policy.'));
    assert.ok(looksLikeRefusal('ขออภัย ฉันไม่สามารถเขียนเนื้อหานี้ได้'));
    assert.ok(!looksLikeRefusal('{"fates":[], "note": "I can\'t decide"}'), 'JSON answers are never refusals');
    assert.ok(!looksLikeRefusal(''));
    assert.ok(!looksLikeRefusal('Here is the plan.'));
});

test('no-rush ignores "faster"; the writer gets the intensity line until the climax', () => {
    const st = newState({ size: 'medium', intensity: 'dark' });
    const prog = progressOf(st, chatOf(10));
    applyArchitect(st, { pace: 'faster' }, { at: 10, prog, noRush: true });
    assert.equal(st.shift, 0);
    applyArchitect(st, { pace: 'faster' }, { at: 10, prog });
    assert.equal(st.shift, -0.05);
    assert.match(buildInjection(st, chatOf(40)), new RegExp(intensityOf('dark').writer.slice(0, 20)));
    assert.match(buildInjection(st, chatOf(40)), /do not resolve the central conflict/);
    assert.doesNotMatch(buildInjection(st, chatOf(140)), /losses stick/, 'no brake during the climax and after');
    assert.doesNotMatch(buildInjection(newState({ intensity: 'soft' }), chatOf(4)), /losses stick|Problems linger/);
});

// ---------------------------------------------------------------- v0.6: story shapes

test('open world: open-ended acts, no main story until an act has finished', () => {
    const st = newState({ shape: 'sandbox', size: 'short' });
    assert.equal(st.size, 'epic', 'open world always runs open-ended acts');
    const prog = progressOf(st, chatOf(4));
    assert.equal(mainGateOpen(st), false);
    assert.equal(spawnRoom(st, prog, 'main'), 0);
    assert.equal(spawnRoom(st, prog, 'arc'), 2, 'local acts start right away');
    st.arc.index = 2;
    assert.equal(spawnRoom(st, progressOf(st, chatOf(4)), 'main'), 3, 'the main story may emerge after act 1');
    addSeeds(st, [{ text: 'สัญลักษณ์งูบนประตู' }], { msgId: 2 }, 'setup');
    assert.equal(st.seeds[0].arc, 2, 'seeds remember their act');
});

test('open world injection offers hooks instead of a directed beat', () => {
    const st = newState({ shape: 'sandbox' });
    applyArchitect(st, { beat: 'ไปที่หอคอย', hooks: ['พ่อค้าแปลกหน้าขายแผนที่', 'มีคนหายในเหมือง'] }, { at: 4, prog: progressOf(st, chatOf(4)) });
    const t = buildInjection(st, chatOf(4));
    assert.match(t, /Hooks the world could offer[\s\S]*พ่อค้าแปลกหน้า[\s\S]*มีคนหายในเหมือง/);
    assert.doesNotMatch(t, /Next beat/);
});

test('protected characters: a fate that makes them a villain, kills them or has them betray is blocked', () => {
    const prot = normProtected([{ name: 'Mira' }, { name: 'Lena', death: false }]);
    assert.equal(breaksProtection({ harm: [{ name: 'mira', role: 'villain' }] }, prot), 'Mira: ห้ามเป็นคนร้าย');
    assert.equal(breaksProtection({ harm: [{ name: 'Lena', role: 'dies' }] }, prot), '', 'Lena may die');
    assert.equal(breaksProtection({ harm: [{ name: 'Lena', role: 'betrays' }] }, prot), 'Lena: ห้ามทรยศ');
    const st = newState({ size: 'medium', protected: prot });
    const r = applyArchitect(st, { fates: [fate('Mira คือคนร้าย', { harm: [{ name: 'Mira', role: 'villain' }] }), fate('พ่อบ้านคือคนร้าย', { harm: [{ name: 'พ่อบ้าน', role: 'villain' }] })] }, { at: 2, prog: progressOf(st, chatOf(2)) });
    assert.deepEqual(r.added, ['A']);
    assert.equal(st.fates[0].truth, 'พ่อบ้านคือคนร้าย');
    assert.deepEqual(r.blocked, ['Mira: ห้ามเป็นคนร้าย']);
});

test('character threads merge by name, keep their secret, and reach the writer only for characters on stage', () => {
    const st = newState({ shape: 'harem' });
    mergeThreads(st, [{ name: 'Mira', want: 'อยากเป็นอิสระ', secret: 'เป็นลูกของศัตรู', next: 'ถามถึงแหวน' }, { name: 'Lena', want: 'อยากชนะ', secret: 'ป่วยหนัก' }]);
    mergeThreads(st, [{ name: 'mira', secret: 'อย่างอื่น', next: 'หลบหน้า' }]);
    assert.equal(st.threads.length, 2);
    assert.equal(st.threads[0].secret, 'เป็นลูกของศัตรู');
    assert.equal(st.threads[0].next, 'หลบหน้า');
    const chat = chatOf(6); // Bot speaks as "Bot"
    chat[5].mes = 'Mira มองออกไปนอกหน้าต่าง';
    const t = buildInjection(st, chat);
    assert.match(t, /Character threads in this scene[\s\S]*- Mira: wants อยากเป็นอิสระ; hides: เป็นลูกของศัตรู; next for them: หลบหน้า/);
    assert.doesNotMatch(t, /Lena/, 'off-stage characters stay out');
    assert.equal(buildInjection(newState({ shape: 'story' }), chat).includes('Character threads'), false);
});

test('onStageNames reads speakers and lore titles in recent text', () => {
    const chat = chatOf(4);
    chat[3].name = 'Kai'; chat[3].is_user = true;
    chat[2].name = 'Narrator'; chat[2].mes = 'Gojo yawns while Megumin watches';
    const names = onStageNames(chat, ['Gojo', 'Sukuna', 'Megumin']);
    assert.ok(names.includes('Gojo') && names.includes('Megumin') && names.includes('Narrator'));
    assert.ok(!names.includes('Sukuna') && !names.includes('Kai'), 'absent lore and the player are left out');
});

// ---------------------------------------------------------------- v0.6.1: token budget

test('the Architect gets at most 40 open seeds, the most useful first, and the newest paid ones', () => {
    const st = newState({ size: 'long' });
    const chat = chatOf(400);
    for (let i = 0; i < 120; i++) addSeeds(st, [{ text: `ปมที่ ${i} ของเรื่องยาว` }], { msgId: i * 3 }, i < 10 ? 'setup' : 'rising');
    addSeeds(st, [{ text: 'ปมที่ผู้เล่นเพิ่มเอง' }], { user: true }, 'rising');
    st.fates.push({ id: 'A', layer: 'main', status: 'alive' });
    st.seeds[50].fates = ['A'];
    for (let i = 100; i < 110; i++) { st.seeds[i].status = 'paid'; st.seeds[i].paidBy = { msgId: 399, swipeId: 0 }; }
    const r = seedsForArchitect(st, chat);
    const open = r.seeds.filter(x => x.status === 'open');
    assert.equal(open.length, 40);
    assert.equal(r.seeds.filter(x => x.status === 'paid').length, 6);
    assert.equal(r.omittedOpen, 111 - 40);
    assert.equal(r.omittedPaid, 4);
    const ids = new Set(r.seeds.map(x => x.text));
    assert.ok(ids.has('ปมที่ผู้เล่นเพิ่มเอง'), "the player's own seed is always sent");
    assert.ok(ids.has('ปมที่ 50 ของเรื่องยาว'), 'a seed tied to a living fate is sent');
    assert.ok(ids.has('ปมที่ 0 ของเรื่องยาว'), 'setup seeds are kept for the ouroboros rule');
    assert.ok(ids.has('ปมที่ 99 ของเรื่องยาว'), 'the newest open seeds fill the rest');
    assert.ok(!ids.has('ปมที่ 20 ของเรื่องยาว'), 'an old, unattached seed waits');
    assert.equal(st.seeds.length, 121, 'nothing is deleted');
});

test('the Scout dedupes against the newest 30 open seeds plus the player\'s own', () => {
    const st = newState();
    for (let i = 0; i < 50; i++) addSeeds(st, [{ text: `ปมเล็ก ${i}` }], { msgId: i }, 'rising');
    addSeeds(st, [{ text: 'ของผู้เล่น' }], { user: true }, 'rising');
    const list = seedsForScout(st, chatOf(60));
    assert.equal(list.length, 30);
    assert.ok(list.some(x => x.text === 'ของผู้เล่น'));
    assert.ok(list.some(x => x.text === 'ปมเล็ก 49'));
    assert.ok(!list.some(x => x.text === 'ปมเล็ก 0'));
});

test('old acts fold into one short line; recent acts stay in full', () => {
    const st = newState({ size: 'epic' });
    st.arc.summaries = Array.from({ length: 8 }, (_, i) => ({ index: i + 1, summary: `องก์ ${i + 1} จบลงด้วยเรื่องยาวมาก `.repeat(10) }));
    const lines = pastLines(st);
    assert.equal(lines.length, 4);
    assert.match(lines[0], /^Acts 1–5 \(finished, in short\)/);
    assert.ok(lines[0].length < 600);
    assert.match(lines[3], /^Act 8 \(finished\)/);
    assert.deepEqual(pastLines(newState()), []);
});

// ---------------------------------------------------------------- v0.6.2: old seeds come round again

test('rotation: every old seed is shown again within a few passes', () => {
    const st = newState({ size: 'long' });
    const chat = chatOf(400);
    for (let i = 0; i < 100; i++) addSeeds(st, [{ text: `ปมเก่าที่ ${i} ไม่ผูกกับอะไร` }], { msgId: i * 3 }, 'rising');
    const seen = new Set();
    for (let pass = 0; pass < 8; pass++) {
        const { seeds } = seedsForArchitect(st, chat);
        assert.equal(seeds.length, 40);
        for (const x of seeds) seen.add(x.id);
        markShown(st, seeds);
    }
    assert.equal(seen.size, 100, 'all 100 seeds were shown at least once in 8 passes');
    assert.equal(st.passes, 8);
});

test('stale seeds fade (except the player\'s, pinned or used ones) and stop being sent; pinned ones always are', () => {
    const st = newState({ size: 'medium' });
    const chat = chatOf(40);
    addSeeds(st, [{ text: 'ปมที่เรื่องผ่านไปแล้ว' }, { text: 'ปมที่ชะตาใช้อยู่' }, { text: 'ปมที่ปักหมุด' }], { msgId: 2 }, 'rising');
    addSeeds(st, [{ text: 'ปมที่ผู้เล่นเพิ่ม' }], { user: true }, 'rising');
    st.seeds[2].pinned = true;
    st.fates.push({ id: 'A', layer: 'main', status: 'alive', needs: ['s2'] });
    const r = applyArchitect(st, { stale: ['s1', 's2', 's3', 's4'] }, { at: 40, prog: progressOf(st, chat) });
    assert.equal(r.faded, 1);
    assert.deepEqual(st.seeds.map(x => !!x.faded), [true, false, false, false]);
    const ids = seedsForArchitect(st, chat).seeds.map(x => x.id);
    assert.ok(!ids.includes('s1') && ids.includes('s3') && ids.includes('s4'));
    assert.ok(!seedsForScout(st, chat).some(x => x.id === 's1'));
    assert.ok(seedsForScout(st, chat).some(x => x.id === 's3'), 'pinned seeds are always in the Scout list');
});

// ---------------------------------------------------------------- v0.6.3: only real threads

test('a seed must name the open question it leaves; props and finished actions drop out', () => {
    const kept = acceptSeedItems([
        { text: 'ดาบไม้โอ๊กที่ทิอาโกใช้ซ้อม', question: '' },
        { text: 'ทิอาโกไล่กระบวนท่าครบสามรอบ' },
        { text: 'จักรพรรดินีกระซิบบางอย่างกับนาธาเอล', question: 'กระซิบว่าอะไร' },
        { text: 'จดหมายที่ยังไม่ได้เปิด', question: 'ในจดหมายเขียนว่าอะไร' },
        { text: 'แผลเป็นที่ไม่มีใครพูดถึง', question: 'แผลมาจากไหน' },
    ], 2);
    assert.deepEqual(kept.map(x => x.text), ['จักรพรรดินีกระซิบบางอย่างกับนาธาเอล', 'จดหมายที่ยังไม่ได้เปิด']);
    const st = newState();
    addSeeds(st, kept, { msgId: 1 }, 'setup');
    assert.equal(st.seeds[0].question, 'กระซิบว่าอะไร');
});

// ---------------------------------------------------------------- v0.7: tensions

const T1 = { sides: ['Mira', 'Kai'], kind: 'between', wants: ['Mira อยากให้ Kai อยู่ต่อ', 'Kai อยากไปเรียนต่อเมืองหลวง'], why: 'ได้แค่ทางเดียว', stakes: 'มิตรภาพสิบปี', heat: 2, next: 'จดหมายตอบรับมาถึง', from: 'invented' };

test('tensions get ids, refine by id, cap at four open, and need sides and a why', () => {
    const st = newState();
    mergeTensions(st, [T1, { sides: ['Lena'], kind: 'inner', why: 'อยากเป็นที่รักแต่กลัวโดนทิ้ง', heat: 3 }, { sides: [], why: 'x' }, { sides: ['A', 'B'] }]);
    assert.deepEqual(st.tensions.map(t => t.id), ['T1', 'T2']);
    mergeTensions(st, [{ ...T1 }]);
    assert.equal(st.tensions.length, 2, 'the same tension without its id is not added twice');
    mergeTensions(st, [{ id: 'T1', heat: 4, next: 'Kai ตัดสินใจ' }, { id: 'T2', status: 'resolved' }]);
    assert.equal(st.tensions[0].heat, 4);
    assert.equal(st.tensions[0].next, 'Kai ตัดสินใจ');
    assert.equal(openTensions(st, chatOf(2)).length, 1);
    for (let i = 0; i < 6; i++) mergeTensions(st, [{ sides: [`X${i}`, 'Y'], why: `เหตุ ${i}` }]);
    assert.equal(openTensions(st, chatOf(2)).length, MAX_OPEN_TENSIONS);
});

test('the Scout moves heat per reply; swiping the reply away undoes it; the Architect\'s heat resets the shifts', () => {
    const st = newState();
    mergeTensions(st, [T1]);
    const chat = chatOf(10);
    let live = openTensions(st, chat);
    assert.equal(applyScoutTensions(st, chat, { tension: [{ n: 1, change: 'hotter' }, { n: 1, change: 'hotter' }] }, live, { msgId: 8, swipeId: 0 }), 1);
    applyScoutTensions(st, chat, { tension: [{ n: 1, change: 'hotter' }] }, live, { msgId: 9, swipeId: 0 });
    assert.equal(openTensions(st, chat)[0].heat, 4);
    chat[9].swipe_id = 1;
    assert.equal(openTensions(st, chat)[0].heat, 3);
    mergeTensions(st, [{ id: 'T1', heat: 2 }]);
    assert.equal(st.tensions[0].shifts.length, 0);
    assert.equal(openTensions(st, chat)[0].heat, 2);
});

test('the writer gets the tensions of who is on stage (or the player), hottest first, at most two', () => {
    const st = newState();
    mergeTensions(st, [T1, { sides: ['Lena'], kind: 'inner', wants: ['อยากเป็นที่รัก', 'กลัวโดนทิ้ง'], why: 'ปมเก่า', heat: 5 }, { sides: ['Kai', 'พ่อ'], why: 'ร้านของครอบครัว', heat: 1 }]);
    const chat = chatOf(6); // speakers: Bot / User
    chat[5].mes = 'Mira ยิ้มให้';
    const prog = progressOf(st, chat);
    let t = tensionLines(st, chat, prog, 'Kai');
    assert.match(t, /Tensions in play/);
    assert.match(t, /- Mira vs Kai: Mira อยากให้ Kai อยู่ต่อ \/ Kai อยากไปเรียนต่อเมืองหลวง \(ได้แค่ทางเดียว\) · heat 2\/5 · next: จดหมายตอบรับมาถึง/);
    assert.match(t, /Kai vs พ่อ/, 'the player is always on stage');
    assert.doesNotMatch(t, /Lena/, 'off stage');
    chat[5].mes = 'Lena และ Mira';
    t = tensionLines(st, chat, prog, '');
    assert.match(t.split('\n')[1], /Lena is torn/, 'hottest first');
    assert.match(buildInjection(st, chat, undefined, { player: 'Kai' }), /Tensions in play/);
});
