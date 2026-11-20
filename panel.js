/*
 * Ouroboros — the spoiler-free panel. Full screen on phones, a centred window on wide screens.
 * Tabs: หน้าหลัก (counts and controls) · ปม (seeds) · ชะตา (peek) · คลัง (fates that never happened).
 * Nothing from a fate is rendered unless the user asked for that peek level.
 */

import {
    SIZES, SIZE_IDS, sizeOf, PHASES, phaseIndex, phaseInfo, progressOf, stats, liveSeeds, layers, alive, lockedFate,
    lockedPastChat, unlockFate, cutThreads, newCycle, addSeeds, SEED_KINDS, normKind, TROPES, TROPE_CATEGORIES, MOODS,
    newState, activeSecrets, INTENSITY, INTENSITY_IDS, TONES,
    SHAPES, SHAPE_IDS, CANON, PROTECT_RULES, normProtected,
} from './lib.js';

const ctx = () => SillyTavern.getContext();
export const OVERLAY_ID = 'ouro_overlay';

/** @type {{settings:()=>any, state:(create?:boolean)=>any, setState:(st:any)=>void, save:()=>void, refresh:()=>void, weave:(r:string)=>void, scout:()=>void, backfill:()=>void, estimate:(st:any)=>any, status:any, diag:(m:string)=>void, chatId:()=>string}} */
let host;
const ui = { tab: 'home', open: false, openedAt: 0, archiveOpen: false, draft: null, editing: null };

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name, extra = '') => `<i class="fa-solid ${name} ${extra}" aria-hidden="true"></i>`;
const hasChat = () => { try { return !!ctx().getCurrentChatId(); } catch { return false; } };
const chat = () => ctx().chat ?? [];

export function initPanel(h) { host = h; }
export const isOpen = () => ui.open;

// ---------------------------------------------------------------- open / close

function root() {
    let el = document.getElementById(OVERLAY_ID);
    if (el) return el;
    try {
        el = document.createElement('div');
        el.id = OVERLAY_ID;
        el.className = 'ouro-hidden';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-label', 'Ouroboros');
        el.innerHTML = `
<div class="ouro-backdrop" data-act="backdrop"></div>
<div class="ouro-frame">
  <header class="ouro-head">
    <span class="ouro-logo">${icon('fa-infinity')}</span>
    <div class="ouro-title"><b>Ouroboros</b><small data-ref="who"></small></div>
    <button class="ouro-icon-btn" data-act="close" title="ปิด" aria-label="ปิด">${icon('fa-xmark')}</button>
  </header>
  <nav class="ouro-tabs" data-ref="tabs"></nav>
  <main class="ouro-body" data-ref="body"></main>
</div>`;
        document.body.appendChild(el);
        el.addEventListener('click', onClick);
        el.addEventListener('change', onChange);
        el.addEventListener('touchstart', () => {}, { passive: true }); // lets :active show on iPhone
        return el;
    } catch (e) {
        el?.remove();
        throw e;
    }
}

export function openPanel(tab) {
    const el = root();
    if (tab) ui.tab = tab;
    ui.open = true;
    ui.openedAt = Date.now();
    host.diag(`open(${tab ?? ''})`);
    el.classList.remove('ouro-hidden'); // show first, then render (an error must not keep it hidden)
    requestAnimationFrame(() => el.classList.add('ouro-in'));
    render();
}

export function closePanel() {
    const el = document.getElementById(OVERLAY_ID);
    if (!el || !ui.open) return;
    host.diag(`close ${Date.now() - ui.openedAt}ms after open · ${(new Error().stack || '').split('\n').slice(2, 4).map(x => x.trim()).join(' < ')}`);
    ui.open = false;
    ui.archiveOpen = false;
    el.classList.remove('ouro-in');
    setTimeout(() => { if (!ui.open) el.classList.add('ouro-hidden'); }, 160);
}

document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !ui.open) return;
    if (ui.editing) { ui.editing = null; render(); return; }
    closePanel();
});

// ---------------------------------------------------------------- render

export function render() {
    if (!ui.open) return;
    const el = document.getElementById(OVERLAY_ID);
    if (!el) return;
    const body = el.querySelector('[data-ref="body"]');
    const tabs = el.querySelector('[data-ref="tabs"]');
    try {
        const st = hasChat() ? host.state(false) : null;
        el.querySelector('[data-ref="who"]').textContent = hasChat() ? whoName() : '';
        tabs.innerHTML = st ? renderTabs() : '';
        tabs.hidden = !st;
        if (!hasChat()) body.innerHTML = empty('fa-comments', 'ยังไม่ได้เปิดแชท', 'เปิดแชทก่อน แล้วค่อยเริ่มวางชะตาให้เรื่องนั้น');
        else if (!st) body.innerHTML = renderSetup();
        else if (ui.tab === 'seeds') body.innerHTML = renderSeeds(st);
        else if (ui.tab === 'fates') body.innerHTML = renderFates(st);
        else if (ui.tab === 'archive') body.innerHTML = renderArchive(st);
        else body.innerHTML = renderHome(st);
    } catch (e) {
        console.error('[Ouroboros] render', e);
        host.diag(`ERROR render ${ui.tab}: ${e?.stack || e}`);
        toastr.error(String(e?.message ?? e), 'Ouroboros: แสดงหน้านี้ไม่ได้');
        if (ui.tab !== 'home') { ui.tab = 'home'; render(); }
        else body.innerHTML = `<p class="ouro-error">${esc(e?.message ?? e)}</p>`;
    }
}

function whoName() {
    const c = ctx();
    if (c.groupId) return (c.groups ?? []).find(g => g.id === c.groupId)?.name ?? 'แชทกลุ่ม';
    return c.characters?.[c.characterId]?.name ?? '';
}

function renderTabs() {
    const t = [['home', 'fa-circle-notch', 'หน้าหลัก'], ['seeds', 'fa-seedling', 'ปม'], ['fates', 'fa-eye', 'ชะตา'], ['archive', 'fa-box-archive', 'คลัง']];
    return t.map(([id, ic, label]) => `<button class="ouro-tab ${ui.tab === id ? 'is-on' : ''}" data-act="tab" data-tab="${id}">${icon(ic)}<span>${label}</span></button>`).join('');
}

const empty = (ic, title, text, btn = '') => `<div class="ouro-empty">${icon(ic, 'ouro-empty-ic')}<b>${esc(title)}</b><p>${esc(text)}</p>${btn}</div>`;
const chip = (on, act, val, label, extra = '') => `<button class="ouro-chip ${on ? 'is-on' : ''}" data-act="${act}" data-val="${esc(val)}" ${extra}>${esc(label)}</button>`;
const confirmBtn = (act, label, cls = '', extra = '') => `<button class="ouro-btn ${cls}" data-act="${act}" data-confirm="1" ${extra}>${label}</button>`;

// ---------------------------------------------------------------- setup

function renderSetup() {
    const len = chat().length;
    const d = ui.draft ??= { shape: 'story', canon: 'canon', protected: [], showProt: false, size: 'medium', intensity: 'real', premise: '', tropes: [], custom: '', secretCats: [], moods: [], includeExisting: len <= 20, showPremise: false, showSecret: false, backfill: true };
    const est = len > 4 ? host.estimate(null) : null;
    const sizes = SIZE_IDS.map(id => `<button class="ouro-seg ${d.size === id ? 'is-on' : ''}" data-act="d-size" data-val="${id}"><b>${SIZES[id].label}</b><small>${SIZES[id].range}</small></button>`).join('');
    const tropeCats = TROPE_CATEGORIES.map(c => `<div class="ouro-trope-cat"><small>${esc(c)}</small><div class="ouro-chips">${TROPES[c].map(t => chip(d.tropes.includes(t), 'd-trope', t, t)).join('')}</div></div>`).join('');
    const custom = d.tropes.filter(t => !Object.values(TROPES).flat().includes(t));
    return `
<section class="ouro-card">
  <h3>${icon('fa-infinity')} วางชะตาให้เรื่องนี้</h3>
  <p class="ouro-hint">ระบบจะเก็บปมที่เรื่องปูไว้ และวางชะตาลับหลายทางพร้อมกัน แล้วค่อยเลือกทางที่เข้ากับเรื่องจริงที่สุด คุณจะเห็นแค่ตัวเลข ไม่เห็นเนื้อหา เว้นแต่จะแอบดูเอง</p>
</section>
<section class="ouro-card">
  <h4>แนวเรื่อง</h4>
  <div class="ouro-segs ouro-segs-2">${SHAPE_IDS.map(id => `<button class="ouro-seg ${d.shape === id ? 'is-on' : ''}" data-act="d-shape" data-val="${id}"><b>${SHAPES[id].label}</b><small>${SHAPES[id].hint}</small></button>`).join('')}</div>
  ${d.shape === 'cast' ? `<div class="ouro-segs ouro-segs-2">${Object.entries(CANON).map(([id, label]) => `<button class="ouro-seg ${d.canon === id ? 'is-on' : ''}" data-act="d-canon" data-val="${id}"><b>${label}</b><small>${id === 'canon' ? 'ความลับอยู่ในช่องว่างของแคนนอน' : 'บิดแคนนอนได้ เดายากขึ้น'}</small></button>`).join('')}</div>` : ''}
  <p class="ouro-hint">${esc(shapeHint(d.shape))}</p>
</section>
${d.shape === 'sandbox' ? '' : `<section class="ouro-card">
  <h4>ขนาดแผน</h4>
  <div class="ouro-segs">${sizes}</div>
  <p class="ouro-hint">${esc(sizeHint(d.size))}</p>
</section>`}
<section class="ouro-card">
  <button class="ouro-fold ${d.showProt || d.shape === 'harem' ? 'is-open' : ''}" data-act="d-fold" data-val="showProt">${icon('fa-chevron-right')} ตัวละครที่ห้ามแตะ <small>ไม่บังคับ</small></button>
  ${d.showProt || d.shape === 'harem' ? protectedEditor(d.protected, 'd-') : ''}
</section>
<section class="ouro-card">
  <h4>ความเข้มของเรื่อง</h4>
  <div class="ouro-segs ouro-segs-3">${INTENSITY_IDS.map(id => `<button class="ouro-seg ${d.intensity === id ? 'is-on' : ''}" data-act="d-intensity" data-val="${id}"><b>${INTENSITY[id].label}</b><small>${INTENSITY[id].hint}</small></button>`).join('')}</div>
  <p class="ouro-hint">ชะตาแต่ละทางจะได้โทนต่างกัน (สดใส · ขมหวาน · มืด) ตามความเข้มนี้ กันโมเดลที่ชอบทำให้ทุกทางนุ่มเหมือนกัน</p>
</section>
<section class="ouro-card">
  <h4>อารมณ์ที่อยากได้ <small>ไม่บังคับ</small></h4>
  <div class="ouro-chips">${MOODS.map(m => chip(d.moods.includes(m), 'd-mood', m, m)).join('')}</div>
</section>
<section class="ouro-card">
  <button class="ouro-fold ${d.showPremise ? 'is-open' : ''}" data-act="d-fold" data-val="showPremise">${icon('fa-chevron-right')} ใส่โจทย์หรือโทรปเอง <small>ไม่บังคับ</small></button>
  ${d.showPremise ? `
  <label class="ouro-label">โจทย์คร่าว ๆ</label>
  <textarea class="ouro-input" data-field="premise" rows="3" placeholder="เช่น มีคนในบ้านไม่ใช่คนที่เขาอ้าง">${esc(d.premise)}</textarea>
  <p class="ouro-hint">เป็นวัตถุดิบของชะตา ไม่ใช่คำสั่ง บางทางอาจใช้ บางทางอาจบิด</p>
  <label class="ouro-label">โทรป</label>
  ${tropeCats}
  <div class="ouro-row"><input class="ouro-input" data-field="custom" placeholder="พิมพ์โทรปเอง" value="${esc(d.custom)}"><button class="ouro-btn" data-act="d-custom">เพิ่ม</button></div>
  ${custom.length ? `<div class="ouro-chips">${custom.map(t => chip(true, 'd-trope', t, t + ' ×')).join('')}</div>` : ''}` : ''}
</section>
<section class="ouro-card">
  <button class="ouro-fold ${d.showSecret ? 'is-open' : ''}" data-act="d-fold" data-val="showSecret">${icon('fa-chevron-right')} โทรปลับ <small>ไม่บังคับ</small></button>
  ${d.showSecret ? `
  <p class="ouro-hint">ติ๊กหมวดที่ชอบ ระบบสุ่มโทรปมาให้ 2 อันโดยไม่บอกว่าอันไหน แอบดูทีหลังได้ในแท็บชะตา</p>
  <div class="ouro-chips">${TROPE_CATEGORIES.map(c => chip(d.secretCats.includes(c), 'd-secret', c, c)).join('')}</div>` : ''}
</section>
<section class="ouro-card">
  ${len > 1 ? `<label class="ouro-check"><input type="checkbox" data-field="includeExisting" ${d.includeExisting ? 'checked' : ''}><span>นับรวมข้อความที่มีอยู่แล้ว (${len} ข้อความ)<small>ไม่ติ๊ก = เริ่มนับความยาวเรื่องจากตอนนี้</small></span></label>` : ''}
  ${est ? `<label class="ouro-check"><input type="checkbox" data-field="backfill" ${d.backfill ? 'checked' : ''}><span>เก็บปมย้อนหลังจากข้อความที่มีอยู่แล้ว<small>${esc(estimateText(est))}</small></span></label>` : ''}
  <button class="ouro-btn ouro-primary ouro-wide" data-act="start">${icon('fa-play')} เริ่ม</button>
  ${aiHint()}
</section>`;
}

function estimateText(est) {
    const parts = [];
    if (est.summaries) parts.push(`สรุปจาก Memory Hub ${est.summaries} ก้อน`);
    const raw = est.parts.filter(p => p.kind === 'chat').length;
    if (raw) parts.push(`อ่านข้อความ #${est.rawFrom}–#${est.rawTo} อีก ${raw} ช่วง`);
    return `${parts.join(' + ')} · ใช้ผู้เก็บปม ≈${est.calls} ครั้ง${est.skipped ? ` · ข้อความเก่ากว่านั้นยาวเกิน อ่านเฉพาะช่วงหลัง` : ''}`;
}

function shapeHint(id) {
    return {
        story: 'วางชะตาหลายทางรอบปมกลางเรื่องเดียว แล้วล็อกทางที่เข้ากับเรื่องจริงที่สุด',
        sandbox: 'ไม่ยัดพล็อตใหญ่ตั้งแต่ต้น เรื่องย่อยเกิดตามที่ที่คุณไป (องก์ละ ~150 ข้อความ ต่อกันไปเรื่อย ๆ) เรื่องใหญ่โผล่เองเมื่อปมจากหลายองก์โยงหากัน และเสนอ "ตะขอ" ให้เลือกหยิบหรือเมินแทนการกำหนดทิศทาง',
        cast: 'ชะตาวนรอบตัวละครที่ออกฉากจริง อ่าน lorebook ที่ทำงานอยู่ ตัวละครสำคัญแต่ละคนมีสายเรื่องของตัวเอง',
        harem: 'ตัวละครสำคัญทุกคนมีความลับและสายเรื่องของตัวเอง ระบบไม่เลือกคู่แทนคุณ แนะนำให้ใส่ตัวละครที่ห้ามแตะด้วย',
    }[id] ?? '';
}

/** Editor for protected characters; prefix 'd-' edits the setup draft, '' edits the chat's plan. */
function protectedEditor(list, prefix) {
    const rows = normProtected(list).map((p, i) => `<li class="ouro-prot">
<b>${esc(p.name)}</b>
<span class="ouro-chips">${Object.entries(PROTECT_RULES).map(([r, label]) => chip(p[r], `${prefix}prot-toggle`, `${i}:${r}`, label)).join('')}</span>
<button class="ouro-icon-btn" data-act="${prefix}prot-del" data-val="${i}" title="ลบ" aria-label="ลบ">${icon('fa-xmark')}</button></li>`).join('');
    return `<p class="ouro-hint">ตัวละครที่ชะตา หักมุม และความลับต้องไม่ทำให้เป็นคนร้าย ตาย หรือทรยศ (แตะชิปเพื่อปิดเฉพาะข้อ) ชะตาที่ละเมิดจะถูกทิ้ง</p>
${rows ? `<ul class="ouro-prots">${rows}</ul>` : ''}
<div class="ouro-row"><input class="ouro-input" data-field="${prefix}prot-name" placeholder="ชื่อตัวละคร (คั่นหลายชื่อด้วย ,)"><button class="ouro-btn" data-act="${prefix}prot-add">เพิ่ม</button></div>`;
}

function sizeHint(id) {
    const s = sizeOf(id);
    const lockAt = s.arcs === Infinity ? 'เมื่อคุณกด "เข้าสู่บทสุดท้าย"' : `ราว ${Math.round(s.lockMain * 100)}% ของเรื่อง`;
    const arcs = s.arcs ? (s.arcs === Infinity ? ' · องก์ต่อกันไปเรื่อย ๆ องก์ละ ~150 ข้อความ' : ` · แบ่ง ${s.arcs} องก์`) : '';
    return `ชะตาพร้อมกัน ${s.fates.main} ทาง${s.fates.arc ? ` (+${s.fates.arc} ต่อองก์)` : ''} · ล็อกความจริง${lockAt}${arcs}`;
}

function aiHint() {
    const s = host.settings();
    const same = (!s.scoutSource || s.scoutSource === 'main') && (!s.architectSource || s.architectSource === 'main');
    return same ? `<p class="ouro-hint">${icon('fa-circle-info')} ตอนนี้ใช้ API หลักของ ST ทั้งสองงาน ตั้ง Connection Profile แยกได้ใน Extensions → Ouroboros</p>` : '';
}

// ---------------------------------------------------------------- home

const RING_R = 52;
function ring(st, prog) {
    const idx = phaseIndex(prog.phase);
    const n = PHASES.length;
    const gap = 6;
    const segs = PHASES.map((p, i) => {
        const a0 = (i / n) * 360 + gap / 2 - 90;
        const a1 = ((i + 1) / n) * 360 - gap / 2 - 90;
        const rad = a => (a * Math.PI) / 180;
        const x0 = 60 + RING_R * Math.cos(rad(a0)), y0 = 60 + RING_R * Math.sin(rad(a0));
        const x1 = 60 + RING_R * Math.cos(rad(a1)), y1 = 60 + RING_R * Math.sin(rad(a1));
        const cls = i < idx ? 'is-past' : i === idx ? 'is-now' : '';
        return `<path class="ouro-seg-arc ${cls}" d="M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${RING_R} ${RING_R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}"><title>${p.label}</title></path>`;
    }).join('');
    const size = sizeOf(st.size);
    const pct = Math.round(Math.min(1, size.arcs ? prog.arc : prog.main) * 100);
    return `<svg class="ouro-ring" viewBox="0 0 120 120" role="img" aria-label="ช่วงเรื่อง ${phaseInfo(prog.phase).label}">${segs}
<text x="60" y="58" class="ouro-ring-phase">${esc(phaseInfo(prog.phase).label)}</text>
<text x="60" y="76" class="ouro-ring-pct">${pct}%</text></svg>`;
}

function statusLine() {
    const s = host.status;
    if (s.busy === 'architect') return `<p class="ouro-status is-busy">${icon('fa-spinner', 'fa-spin')} กำลังทอชะตา…</p>`;
    if (s.busy === 'scout') return `<p class="ouro-status is-busy">${icon('fa-spinner', 'fa-spin')} กำลังเก็บปม…</p>`;
    if (s.busy === 'backfill') return `<p class="ouro-status is-busy">${icon('fa-spinner', 'fa-spin')} กำลังเก็บปมย้อนหลัง ${esc(s.progress)}…</p>`;
    if (s.lastError && (!s.lastOk || s.lastError.at > s.lastOk.at)) {
        const who = { architect: 'ทอชะตา', backfill: 'เก็บปมย้อนหลัง' }[s.lastError.kind] ?? 'เก็บปม';
        const act = { architect: 'weave', backfill: 'backfill' }[s.lastError.kind] ?? 'scout';
        return `<div class="ouro-status is-error">${icon('fa-triangle-exclamation')} <span>${who}ไม่สำเร็จ: ${esc(s.lastError.msg)}</span><button class="ouro-btn ouro-small" data-act="${act}">ลองใหม่</button></div>`;
    }
    return '';
}

function renderHome(st) {
    const c = chat();
    const prog = progressOf(st, c);
    const size = sizeOf(st.size);
    const k = stats(st, c);
    const lays = layers(st);
    const layerLabel = { main: size.arcs ? 'เรื่องหลัก' : '', arc: `องก์ ${st.arc.index}` };
    const fateLine = lays.map(l => {
        const pre = layerLabel[l] ? `<small>${layerLabel[l]}</small> ` : '';
        if (l === 'main' && st.shape === 'sandbox' && !k.locked.main && !k.alive.main) return `<li>${pre}${icon('fa-cloud')} เรื่องใหญ่ยังไม่โผล่</li>`;
        return `<li>${pre}${k.locked[l] ? `${icon('fa-lock')} ชะตาถูกล็อกแล้ว` : `ชะตาที่ยังเป็นไปได้ <b>${k.alive[l]}</b>`}</li>`;
    }).join('');
    const banners = [];
    const relock = lockedPastChat(st, c);
    if (relock.length) banners.push(`<div class="ouro-banner">${icon('fa-clock-rotate-left')} <span>แชทถูกย้อนกลับไปก่อนจุดที่ล็อกชะตา</span><button class="ouro-btn ouro-small" data-act="unlock">ปลดล็อกชะตา</button></div>`);
    if (st.ended) banners.push(`<div class="ouro-banner">${icon('fa-flag-checkered')} <span>ปิดเรื่องแล้ว · บันทึกลับหยุดส่ง</span><button class="ouro-btn ouro-small" data-act="reopen">เปิดเรื่องต่อ</button>${confirmBtn('cycle', 'เริ่มภาคใหม่', 'ouro-small')}</div>`);
    else if (prog.done) banners.push(`<div class="ouro-banner">${icon('fa-flag')} <span>ถึงความยาวที่วางไว้แล้ว จะปิดเรื่อง หรือเริ่มภาคใหม่ต่อ</span>${confirmBtn('end', 'ปิดเรื่อง', 'ouro-small')}${confirmBtn('cycle', 'เริ่มภาคใหม่', 'ouro-small')}</div>`);
    if (!host.settings().enabled) banners.push(`<div class="ouro-banner">${icon('fa-power-off')} <span>Ouroboros ปิดอยู่ใน Extensions · ไม่เก็บปม ไม่ส่งบันทึกลับ</span></div>`);

    const allLocked = lays.every(l => lockedFate(st, l));
    const finaleBtn = size.arcs === Infinity
        ? (st.finale ? '' : confirmBtn('finale', `${icon('fa-mountain-sun')} เข้าสู่บทสุดท้าย`))
        : (prog.phase === 'climax' || prog.phase === 'resolution' || st.progressFloor ? '' : confirmBtn('finale', `${icon('fa-forward')} ขอปิดเรื่อง`));
    return `
${banners.join('')}
<section class="ouro-card ouro-hero">
  ${ring(st, prog)}
  <ul class="ouro-stats">
    <li>แนวเรื่อง <b>${esc(SHAPES[st.shape ?? 'story'].label)}</b>${st.shape === 'cast' ? ` · ${esc(CANON[st.canon ?? 'canon'])}` : ''}</li>
    <li>ขนาดแผน <b>${esc(size.label)}</b>${size.arcs ? ` · องก์ที่ <b>${st.arc.index}</b>` : ''}${st.cycle > 1 ? ` · ภาค ${st.cycle}` : ''}</li>
    <li>ปูไว้ <b>${k.planted}</b> ปม · เฉลยแล้ว <b>${k.paid}</b></li>
    ${fateLine}
    ${st.secretTropes ? `<li>มีโทรปลับ <b>${st.secretTropes.picked.length}</b> อัน</li>` : ''}
    ${k.secrets ? `<li>ความลับ <b>${k.secrets}</b> ข้อ · เผยแล้ว <b>${k.revealed}</b></li>` : ''}
    ${st.carriedFrom?.length ? `<li><small>${icon('fa-link')} ต่อเรื่องมาจาก ${st.carriedFrom.length} แชทก่อนหน้า</small></li>` : ''}
    ${st.leaks?.length ? `<li><small>${icon('fa-shield-halved')} สงสัยความลับรั่ว ${st.leaks.length} ครั้ง</small></li>` : ''}
    ${k.peeked ? `<li class="ouro-peeked">${icon('fa-eye')} แอบดูแล้ว</li>` : ''}
  </ul>
</section>
${statusLine()}
<section class="ouro-card">
  <h4>อารมณ์</h4>
  <div class="ouro-chips">${MOODS.map(m => chip(st.moods.includes(m), 'mood', m, m)).join('')}</div>
  <p class="ouro-hint">มีผลกับคะแนนของชะตาในรอบถัดไป</p>
</section>
<section class="ouro-card">
  <h4>คุมทิศทาง</h4>
  <div class="ouro-actions">
    <button class="ouro-btn" data-act="weave" ${host.status.busy ? 'disabled' : ''}>${icon('fa-wand-magic-sparkles')} ทอชะตาตอนนี้</button>
    ${confirmBtn('cut', `${icon('fa-scissors')} ตัดด้าย`, '', allLocked ? 'disabled title="ชะตาล็อกแล้วทั้งหมด"' : '')}
    ${finaleBtn}
  </div>
  <p class="ouro-hint">ตัดด้าย = ทิ้งชะตาที่ยังไม่ล็อกแล้วเขียนใหม่ ใช้เมื่อรู้สึกว่าเรื่องกำลังไปทางที่ไม่ชอบ ไม่ต้องรู้ว่าทางนั้นคืออะไร</p>
  <div class="ouro-row ouro-size-row"><span>ความเข้ม</span><select class="ouro-input" data-field="intensity">${INTENSITY_IDS.map(id => `<option value="${id}" ${(st.intensity ?? 'real') === id ? 'selected' : ''}>${INTENSITY[id].label}</option>`).join('')}</select></div>
  <div class="ouro-row ouro-size-row"><span>ขนาดแผน</span><select class="ouro-input" data-field="size" ${st.shape === 'sandbox' ? 'disabled title="โลกเปิดใช้องก์ต่อกันไปเรื่อย ๆ"' : ''}>${SIZE_IDS.map(id => `<option value="${id}" ${st.size === id ? 'selected' : ''}>${SIZES[id].label}</option>`).join('')}</select></div>
</section>
<section class="ouro-card">
  <h4>ตัวละครที่ห้ามแตะ</h4>
  ${protectedEditor(st.protected, '')}
</section>
<section class="ouro-card ouro-danger-zone">
  ${confirmBtn('stop', `${icon('fa-trash')} หยุดใช้ในแชทนี้`, 'ouro-danger')}
  <p class="ouro-hint">ลบปมและชะตาทั้งหมดของแชทนี้ เริ่มใหม่ได้ทีหลัง</p>
</section>`;
}

// ---------------------------------------------------------------- seeds

function renderSeeds(st) {
    const c = chat();
    const seeds = liveSeeds(st, c);
    const open = seeds.filter(s => s.status === 'open' && !s.faded);
    const faded = seeds.filter(s => s.status === 'open' && s.faded);
    const paid = seeds.filter(s => s.status === 'paid');
    const row = s => {
        const k = SEED_KINDS[normKind(s.kind)];
        if (ui.editing === s.id) {
            return `<li class="ouro-seed is-editing"><textarea class="ouro-input" data-field="seed-text" rows="2">${esc(s.text)}</textarea>
<div class="ouro-row"><select class="ouro-input" data-field="seed-kind">${kindOptions(s.kind)}</select><button class="ouro-btn ouro-primary" data-act="seed-save" data-id="${s.id}">บันทึก</button><button class="ouro-btn" data-act="seed-cancel">ยกเลิก</button></div></li>`;
        }
        const where = Number.isInteger(s.msgId) ? `#${s.msgId}` : s.carried ? 'ตอนก่อน' : s.backfill ? 'จากสรุป' : 'เพิ่มเอง';
        return `<li class="ouro-seed ${s.status === 'paid' ? 'is-paid' : ''}">
<span class="ouro-seed-ic" title="${esc(k.label)}">${icon(k.icon)}</span>
<div class="ouro-seed-main"><span>${esc(s.text)}</span>${s.question ? `<small class="ouro-seed-q">${icon('fa-circle-question')} ${esc(s.question)}</small>` : ''}<small>${esc(k.label)} · ${where} · ${esc(phaseInfo(s.phase).label)}${s.user ? ' · ' + icon('fa-star') + ' เพิ่มเอง' : ''}${s.pinned ? ' · ' + icon('fa-thumbtack') + ' ปักหมุด' : ''}</small></div>
${s.faded ? `<button class="ouro-btn ouro-small" data-act="seed-unfade" data-id="${s.id}">คืน</button>` : s.status === 'open' && !s.user ? `<button class="ouro-icon-btn ${s.pinned ? 'is-on' : ''}" data-act="seed-pin" data-id="${s.id}" title="${s.pinned ? 'เลิกปักหมุด' : 'ปักหมุด: ส่งให้ผู้ทอชะตาทุกครั้ง'}" aria-label="${s.pinned ? 'เลิกปักหมุด' : 'ปักหมุด'}" aria-pressed="${!!s.pinned}">${icon('fa-thumbtack')}</button>` : ''}
<button class="ouro-icon-btn" data-act="seed-edit" data-id="${s.id}" title="แก้ไข" aria-label="แก้ไข">${icon('fa-pen')}</button>
${confirmBtn('seed-drop', icon('fa-trash'), 'ouro-icon-btn', `data-id="${s.id}" title="ลบ" aria-label="ลบ"`)}
</li>`;
    };
    const est = host.status.busy === 'backfill' ? null : host.estimate(st);
    const back = host.status.busy === 'backfill'
        ? `<section class="ouro-card">${statusLine()}</section>`
        : est ? `<section class="ouro-card"><h4>${icon('fa-clock-rotate-left')} เก็บปมย้อนหลัง</h4>
  <p class="ouro-hint">ข้อความ #${est.from}–#${est.until - 1} ยังไม่ได้เก็บปม · ${esc(estimateText(est))}</p>
  ${confirmBtn('backfill', `${icon('fa-clock-rotate-left')} เก็บปมย้อนหลัง`)}</section>`
        : st.lastBackfill ? `<p class="ouro-hint">${icon('fa-check')} เก็บย้อนหลังแล้ว ได้ ${st.lastBackfill.added} ปม</p>` : '';
    return `
${back}
<section class="ouro-card">
  <h4>เพิ่มปมเอง</h4>
  <textarea class="ouro-input" data-field="new-seed" rows="2" placeholder="เช่น แหวนที่ {{user}} เก็บได้ในป่า"></textarea>
  <div class="ouro-row"><select class="ouro-input" data-field="new-kind">${kindOptions('object')}</select><button class="ouro-btn ouro-primary" data-act="seed-add">เพิ่ม</button></div>
  <p class="ouro-hint">ปมที่เพิ่มเองหรือปักหมุดไว้ (${icon('fa-thumbtack')}) ถูกส่งให้ผู้ทอชะตาทุกครั้ง ส่วนปมอื่นเวียนกันส่ง ปมเก่าจะวนกลับมาให้ผู้ทอชะตาพิจารณาทุกไม่กี่รอบ</p>
</section>
<section class="ouro-card">
  <h4>เปิดอยู่ <small>${open.length}</small></h4>
  ${open.length ? `<ul class="ouro-seeds">${open.map(row).join('')}</ul>` : empty('fa-seedling', 'ยังไม่มีปม', 'ปมจะถูกเก็บเองหลังบอทตอบ หรือเพิ่มเองด้านบน', `<button class="ouro-btn" data-act="scout">เก็บปมตอนนี้</button>`)}
</section>
${paid.length ? `<section class="ouro-card"><h4>เฉลยแล้ว <small>${paid.length}</small></h4><ul class="ouro-seeds">${paid.map(row).join('')}</ul></section>` : ''}
${faded.length ? `<section class="ouro-card"><h4>จางไปแล้ว <small>${faded.length}</small></h4><p class="ouro-hint">ผู้ทอชะตาเห็นว่าเรื่องผ่านปมเหล่านี้ไปแล้ว จึงหยุดส่ง กด คืน ถ้ายังอยากให้กลับมา</p><ul class="ouro-seeds">${faded.map(row).join('')}</ul></section>` : ''}`;
}

const kindOptions = cur => Object.entries(SEED_KINDS).map(([id, k]) => `<option value="${id}" ${normKind(cur) === id ? 'selected' : ''}>${k.label}</option>`).join('');

// ---------------------------------------------------------------- fates (peek)

const PEEK = [null, ['กลิ่น', 'คำเดียวบอกธีม'], ['เงา', 'หนึ่งประโยคคลุมเครือ'], ['เปิดหมด', 'ความจริง หักมุม ตอนจบ']];

function peekButtons(level, act, id) {
    return `<div class="ouro-peek-row">${[1, 2, 3].map(n => n <= level
        ? `<span class="ouro-peek-done">${icon('fa-check')} ${PEEK[n][0]}</span>`
        : n === level + 1 ? confirmBtn(act, `${icon('fa-eye')} ${PEEK[n][0]}`, 'ouro-small', `data-id="${esc(id)}" data-level="${n}" title="${PEEK[n][1]}"`) : '').join('')}</div>`;
}

function notebookHtml(f) {
    const st = host.state(false);
    if (!st || f.status !== 'locked') return '';
    const list = activeSecrets(st, chat()).filter(v => v.layer === f.layer);
    if (!list.length) return `<p class="ouro-meta">${icon('fa-book')} สมุดความลับยังไม่ได้เขียน (ผู้ทอชะตาจะเขียนในรอบถัดไป)</p>`;
    return `<div class="ouro-notebook"><b>${icon('fa-book')} สมุดความลับ</b>${list.map(v => `<div class="ouro-secret ${v.revealed ? 'is-out' : ''}">
<p>${esc(v.text)}</p>
<small>${v.revealed ? `${icon('fa-lock-open')} เผยแล้ว${Number.isInteger(v.revealed.msgId) ? ` ที่ #${v.revealed.msgId}` : ''}` : `${icon('fa-lock')} ยังซ่อนอยู่`}${v.unknownTo.length ? ` · ยังไม่รู้: ${esc(v.unknownTo.join(', '))}` : ''}${v.learned.length ? ` · รู้แล้ว: ${esc(v.learned.join(', '))}` : ''} · เบาะแส ${v.clues.length} ครั้ง</small>
${v.when ? `<small>จะเผยเมื่อ: ${esc(v.when)}</small>` : ''}${v.changes ? `<small>เผยแล้วจะเปลี่ยน: ${esc(v.changes)}</small>` : ''}
${v.clues.length ? `<small>เบาะแสที่วางแล้ว: ${v.clues.map(c => esc(c.text)).join(' · ')}</small>` : ''}
</div>`).join('')}</div>`;
}

function fateCard(f) {
    const parts = [];
    if (f.peek >= 1) parts.push(`<p class="ouro-scent">${esc(f.scent || '—')}</p>`);
    if (f.peek >= 2) parts.push(`<p class="ouro-shadow">${esc(f.shadow || '—')}</p>`);
    if (f.peek >= 3) parts.push(fullFate(f), notebookHtml(f));
    const badge = f.status === 'locked' ? `<span class="ouro-badge is-lock">${icon('fa-lock')} ล็อกแล้ว</span>` : '';
    return `<article class="ouro-fate"><header><b>ชะตา ${esc(f.id)}</b>${badge}</header>${parts.join('')}${peekButtons(f.peek ?? 0, 'peek', f.id)}</article>`;
}

function fullFate(f) {
    return `<dl class="ouro-full">${f.tone ? `<dt>โทน</dt><dd>${esc(TONES[f.tone] ?? f.tone)}</dd>` : ''}<dt>ความจริง</dt><dd>${esc(f.truth)}</dd>${f.twists?.length ? `<dt>หักมุม</dt><dd><ul>${f.twists.map(t => `<li>${esc(t)}</li>`).join('')}</ul></dd>` : ''}${f.ending ? `<dt>ตอนจบ</dt><dd>${esc(f.ending)}</dd>` : ''}</dl>`;
}

function threadsHtml(st) {
    if (!SHAPES[st.shape ?? 'story']?.threads) return '';
    const list = st.threads ?? [];
    const cards = list.map((t, i) => `<article class="ouro-fate"><header><b>${esc(t.name)}</b>${t.status === 'resolved' ? `<span class="ouro-badge">จบสายแล้ว</span>` : ''}</header>
${t.peek >= 1 ? `<p class="ouro-shadow">อยากได้: ${esc(t.want || '—')}${t.next ? ` · ต่อไป: ${esc(t.next)}` : ''}</p>` : ''}
${t.peek >= 2 ? `<p class="ouro-scent">ความลับ: ${esc(t.secret || '—')}</p>` : ''}
<div class="ouro-peek-row">${[1, 2].map(n => n <= (t.peek ?? 0) ? `<span class="ouro-peek-done">${icon('fa-check')} ${n === 1 ? 'สิ่งที่อยากได้' : 'ความลับ'}</span>` : n === (t.peek ?? 0) + 1 ? confirmBtn('peek-thread', `${icon('fa-eye')} ${n === 1 ? 'สิ่งที่อยากได้' : 'ความลับ'}`, 'ouro-small', `data-id="${i}" data-level="${n}"`) : '').join('')}</div></article>`).join('');
    return `<section class="ouro-card"><h4>สายตัวละคร <small>${list.length}</small></h4>${cards || empty('fa-users', 'ยังไม่มีสายตัวละคร', 'ผู้ทอชะตาจะเขียนให้ตัวละครสำคัญแต่ละคนในรอบถัดไป')}</section>`;
}

function renderFates(st) {
    const size = sizeOf(st.size);
    const lays = layers(st);
    const title = { main: size.arcs ? 'เรื่องหลัก' : 'ชะตา', arc: `องก์ ${st.arc.index}` };
    const blocks = lays.map(l => {
        const list = [lockedFate(st, l), ...alive(st, l)].filter(Boolean);
        return `<section class="ouro-card"><h4>${title[l]}</h4>${list.length ? list.map(fateCard).join('') : empty('fa-hourglass-half', 'ยังไม่มีชะตา', 'ผู้ทอชะตาจะเขียนให้หลังบอทตอบ หรือกด ทอชะตาตอนนี้ ในหน้าหลัก')}</section>`;
    }).join('');
    const tr = st.secretTropes;
    const trope = tr ? `<section class="ouro-card"><h4>โทรปลับ</h4>
${tr.peek >= 1 ? `<p class="ouro-scent">หมวด: ${esc([...new Set(tr.picked.map(p => p.cat))].join(', '))}</p>` : ''}
${tr.peek >= 2 ? `<p class="ouro-shadow">${tr.picked.map(p => esc(p.trope)).join(' · ')}</p>` : ''}
<div class="ouro-peek-row">${[1, 2].map(n => n <= tr.peek ? `<span class="ouro-peek-done">${icon('fa-check')} ${n === 1 ? 'หมวด' : 'โทรป'}</span>` : n === tr.peek + 1 ? confirmBtn('peek-trope', `${icon('fa-eye')} ${n === 1 ? 'หมวด' : 'โทรป'}`, 'ouro-small', `data-level="${n}"`) : '').join('')}</div></section>` : '';
    return `
<section class="ouro-card ouro-warn-card">${icon('fa-mask')} <span>แอบดูทีละขั้น ต้องแตะสองครั้งทุกครั้ง ดูแล้วย้อนไม่ได้ และหน้าหลักจะขึ้นว่า "แอบดูแล้ว"</span></section>
${blocks}${threadsHtml(st)}${trope}`;
}

// ---------------------------------------------------------------- archive

function renderArchive(st) {
    const gone = st.fates.filter(f => f.status === 'pruned');
    if (!gone.length) return empty('fa-box-archive', 'ยังไม่มีชะตาที่ไม่ได้เกิด', 'ชะตาที่ถูกตัดหรือแพ้การล็อกจะมาอยู่ที่นี่ ให้ดูว่าถ้าเรื่องไปอีกทาง จะเป็นแบบไหน');
    const freeIds = new Set(gone.filter(f => st.ended || f.cycle < st.cycle || (f.layer === 'arc' && f.arc < st.arc.index)).map(f => f.id));
    const gated = gone.filter(f => !freeIds.has(f.id));
    if (gated.length && !ui.archiveOpen && !freeIds.size) {
        return `<section class="ouro-card ouro-warn-card">${icon('fa-mask')} <span>มีชะตาที่ไม่ได้เกิด ${gone.length} ทาง แต่เรื่องยังไม่จบ การรู้ว่าอะไร "ไม่จริง" ก็ใบ้ได้ว่าความจริงเหลือทางไหน</span>${confirmBtn('archive-open', 'ดูเลย', 'ouro-small')}</section>`;
    }
    const show = ui.archiveOpen ? gone : gone.filter(f => freeIds.has(f.id));
    const herrings = f => st.seeds.filter(s => s.herring && s.fates?.includes(f.id) && s.status !== 'dropped');
    const cards = [...show].reverse().map(f => `<article class="ouro-fate">
<header><b>ชะตา ${esc(f.id)}</b>${f.layer === 'arc' ? `<span class="ouro-badge">องก์ ${esc(f.arc)}</span>` : ''}${f.cycle > 1 ? `<span class="ouro-badge">ภาค ${f.cycle}</span>` : ''}</header>
<p class="ouro-meta">ถูกตัดที่ข้อความ #${esc(f.prunedAt)}${f.prunedIn ? ' ของตอนก่อน' : ''} · ${esc(f.pruneReason || '—')}</p>
${fullFate(f)}
${herrings(f).length ? `<p class="ouro-meta">กลายเป็นปมหลอก: ${herrings(f).map(s => esc(s.text)).join(' · ')}</p>` : ''}
${!f.prunedIn && Number.isInteger(f.prunedAt) && f.prunedAt > 0 && f.prunedAt <= chat().length ? `<button class="ouro-btn ouro-small" data-act="jump" data-id="${Math.max(0, f.prunedAt - 1)}">${icon('fa-location-arrow')} ไปที่ข้อความที่แยกทาง</button>` : ''}
</article>`).join('');
    const more = gated.length && !ui.archiveOpen ? `<section class="ouro-card ouro-warn-card">${icon('fa-mask')} <span>อีก ${gated.length} ทางเป็นของเรื่องที่ยังไม่จบ</span>${confirmBtn('archive-open', 'ดูด้วย', 'ouro-small')}</section>` : '';
    return `<section class="ouro-card"><h4>ชะตาที่ไม่ได้เกิด</h4><p class="ouro-hint">ถ้าเรื่องไปอีกทาง จะเป็นแบบนี้</p></section>${cards}${more}`;
}

// ---------------------------------------------------------------- events

function armed(btn) {
    if (!btn.dataset.confirm) return true;
    if (btn.dataset.armed === '1') return true;
    btn.dataset.armed = '1';
    btn.dataset.label = btn.innerHTML;
    btn.classList.add('is-armed');
    btn.innerHTML = 'แตะอีกครั้งเพื่อยืนยัน';
    setTimeout(() => {
        if (!btn.isConnected) return;
        btn.dataset.armed = '';
        btn.classList.remove('is-armed');
        btn.innerHTML = btn.dataset.label;
    }, 3000);
    return false;
}

function field(name) { return document.querySelector(`#${OVERLAY_ID} [data-field="${name}"]`); }

function saveDraftFields() {
    const d = ui.draft;
    if (!d) return;
    const p = field('premise'); if (p) d.premise = p.value;
    const c = field('custom'); if (c) d.custom = c.value;
}

function onChange(e) {
    const f = e.target?.dataset?.field;
    if (!f) return;
    if (f === 'includeExisting' && ui.draft) ui.draft.includeExisting = e.target.checked;
    if (f === 'backfill' && ui.draft) ui.draft.backfill = e.target.checked;
    if (f === 'intensity') {
        const st = host.state(false);
        if (st && INTENSITY[e.target.value]) { st.intensity = e.target.value; done(); }
    }
    if (f === 'size') {
        const st = host.state(false);
        if (st && SIZES[e.target.value]) { st.size = e.target.value; done(); }
    }
}

const done = () => { host.save(); host.refresh(); render(); };

function onClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'backdrop') { if (Date.now() - ui.openedAt > 450) closePanel(); return; }
    if (btn.disabled || !armed(btn)) return;
    try { handle(act, btn); } catch (err) {
        console.error('[Ouroboros]', act, err);
        host.diag(`ERROR ${act}: ${err?.stack || err}`);
        toastr.error(String(err?.message ?? err), 'Ouroboros');
    }
}

function toggle(list, v) { const i = list.indexOf(v); if (i >= 0) list.splice(i, 1); else list.push(v); }

function handle(act, btn) {
    const val = btn.dataset.val;
    const id = btn.dataset.id;
    const st = host.state(false);
    const c = chat();
    switch (act) {
        case 'close': return closePanel();
        case 'tab': ui.tab = btn.dataset.tab; ui.editing = null; return render();
        // setup
        case 'd-size': saveDraftFields(); ui.draft.size = val; return render();
        case 'd-intensity': saveDraftFields(); ui.draft.intensity = val; return render();
        case 'd-shape': saveDraftFields(); ui.draft.shape = val; return render();
        case 'd-canon': saveDraftFields(); ui.draft.canon = val; return render();
        case 'd-prot-add': case 'prot-add': {
            if (act === 'd-prot-add') saveDraftFields();
            const box = field(act === 'd-prot-add' ? 'd-prot-name' : 'prot-name');
            const list = act === 'd-prot-add' ? ui.draft.protected : (st.protected ??= []);
            for (const name of String(box?.value ?? '').split(',').map(x => x.trim()).filter(Boolean)) {
                if (!list.some(p => p.name.toLowerCase() === name.toLowerCase())) list.push({ name, villain: true, death: true, betray: true });
            }
            return act === 'd-prot-add' ? render() : done();
        }
        case 'd-prot-toggle': case 'prot-toggle': {
            if (act === 'd-prot-toggle') saveDraftFields();
            const [i, rule] = String(val).split(':');
            const list = act === 'd-prot-toggle' ? ui.draft.protected : st.protected;
            const p = list?.[Number(i)];
            if (p) p[rule] = p[rule] === false;
            return act === 'd-prot-toggle' ? render() : done();
        }
        case 'd-prot-del': case 'prot-del': {
            if (act === 'd-prot-del') saveDraftFields();
            const list = act === 'd-prot-del' ? ui.draft.protected : st.protected;
            list?.splice(Number(val), 1);
            return act === 'd-prot-del' ? render() : done();
        }
        case 'peek-thread': { const t = st.threads?.[Number(id)]; if (t) t.peek = Math.max(t.peek ?? 0, Number(btn.dataset.level)); return done(); }
        case 'd-mood': saveDraftFields(); toggle(ui.draft.moods, val); return render();
        case 'd-trope': saveDraftFields(); toggle(ui.draft.tropes, val); return render();
        case 'd-secret': saveDraftFields(); toggle(ui.draft.secretCats, val); return render();
        case 'd-fold': saveDraftFields(); ui.draft[val] = !ui.draft[val]; return render();
        case 'd-custom': {
            saveDraftFields();
            for (const t of ui.draft.custom.split(',').map(x => x.trim()).filter(Boolean)) if (!ui.draft.tropes.includes(t)) ui.draft.tropes.push(t);
            ui.draft.custom = '';
            return render();
        }
        case 'start': {
            saveDraftFields();
            const d = ui.draft;
            const fresh = newState({
                shape: d.shape, canon: d.canon, protected: d.protected, size: d.size, intensity: d.intensity, premise: d.showPremise ? d.premise : '', tropes: d.showPremise ? d.tropes : [],
                secretCats: d.showSecret ? d.secretCats : [], moods: d.moods,
                startedAt: d.includeExisting ? 0 : Math.max(0, c.length - 1),
                owner: { chatId: host.chatId(), groupId: ctx().groupId ?? null },
            });
            host.setState(fresh);
            ui.draft = null;
            ui.tab = 'home';
            done();
            if (d.backfill && c.length > 4) host.backfill(); // old seeds first, then the latest reply
            host.scout(); // the Architect follows once the first seeds are in
            return;
        }
        // home
        case 'mood': toggle(st.moods, val); return done();
        case 'weave': host.weave('manual'); toastr.info('เริ่มทอชะตาแล้ว', 'Ouroboros', { timeOut: 2000 }); return render();
        case 'scout': host.scout(); return render();
        case 'backfill': host.backfill(); return render();
        case 'cut': {
            const n = cutThreads(st, c.length);
            if (!n) { toastr.info('ไม่มีชะตาที่ยังไม่ล็อก'); return; }
            done();
            host.weave('cut');
            toastr.info('ตัดด้ายแล้ว กำลังทอชะตาใหม่', 'Ouroboros', { timeOut: 2500 });
            return;
        }
        case 'finale': {
            if (sizeOf(st.size).arcs === Infinity) st.finale = true;
            else st.progressFloor = Math.max(Number(st.progressFloor) || 0, PHASES.find(p => p.id === 'climax').from);
            done();
            host.weave('finale');
            return;
        }
        case 'unlock': for (const f of lockedPastChat(st, c)) unlockFate(st, f.id); return done();
        case 'end': st.ended = true; return done();
        case 'reopen': st.ended = false; return done();
        case 'cycle': newCycle(st, c); done(); host.weave('birth'); return;
        case 'stop': host.setState(null); ui.tab = 'home'; return done();
        // seeds
        case 'seed-add': {
            const text = field('new-seed')?.value ?? '';
            const kind = field('new-kind')?.value ?? 'object';
            const sub = ctx().substituteParams?.(text) ?? text;
            const added = addSeeds(st, [{ text: sub, kind }], { user: true }, progressOf(st, c).phase);
            if (!added.length) { toastr.warning('ปมนี้สั้นไปหรือมีอยู่แล้ว'); return; }
            return done();
        }
        case 'seed-edit': ui.editing = id; return render();
        case 'seed-cancel': ui.editing = null; return render();
        case 'seed-save': {
            const s = st.seeds.find(x => x.id === id);
            const text = field('seed-text')?.value.trim();
            if (s && text) { s.text = text.slice(0, 240); s.kind = normKind(field('seed-kind')?.value); }
            ui.editing = null;
            return done();
        }
        case 'seed-pin': { const s = st.seeds.find(x => x.id === id); if (s) s.pinned = !s.pinned; return done(); }
        case 'seed-unfade': { const s = st.seeds.find(x => x.id === id); if (s) { s.faded = false; s.lastShown = -1; } return done(); }
        case 'seed-drop': { const s = st.seeds.find(x => x.id === id); if (s) s.status = 'dropped'; return done(); }
        // peeks
        case 'peek': {
            const f = st.fates.find(x => x.id === id);
            if (f) f.peek = Math.max(f.peek ?? 0, Number(btn.dataset.level));
            return done();
        }
        case 'peek-trope': st.secretTropes.peek = Math.max(st.secretTropes.peek ?? 0, Number(btn.dataset.level)); return done();
        case 'archive-open': ui.archiveOpen = true; return render();
        case 'jump': return jumpTo(Number(id));
    }
}

function jumpTo(mesId) {
    closePanel();
    const el = document.querySelector(`#chat .mes[mesid="${mesId}"]`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    ctx().executeSlashCommandsWithOptions?.(`/chat-jump ${mesId}`).catch(() => toastr.info(`ข้อความ #${mesId} ยังไม่ได้โหลดในหน้าจอ เลื่อนขึ้นไปเพื่อโหลดก่อน`));
}
