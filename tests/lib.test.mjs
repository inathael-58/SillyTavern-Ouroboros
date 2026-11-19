// Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    newState, normalizeState, progressOf, phaseAt, spawnRoom, applyArchitect, addSeeds, paySeeds, liveSeeds,
    trimToChat, cutThreads, lockedPastChat, unlockFate, advanceArc, newCycle, buildInjection, pickFocus,
    parseJsonLoose, cleanMessage, recentTranscript, pickSecretTropes, stats, nextFateId, lockIfDue,
    carryState, secretsByTiming,
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
    assert.match(buildInjection(st, chat), /Do not reveal yet[\s\S]*ยายคือคนร้าย/);
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
    assert.deepEqual(r, { hold: ['main truth'], free: ['arc truth'] });
});
