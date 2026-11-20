// Ouroboros — เรื่องเบื้องลึกที่ไม่มีใครรู้ (SillyTavern extension)
// เก็บปมที่เรื่องปูไว้ วางชะตาลับหลายทางพร้อมกัน แล้วล็อกทางที่เข้ากับเรื่องจริงที่สุด
// ส่งให้โมเดลที่เขียนเรื่องแค่ช่วงเรื่อง จังหวะถัดไป ปมที่ควรหยิบ และความลับที่ห้ามเผย
// ดูรายละเอียดใน docs/SPEC.md

import { installThemePalette } from './theme-palette.js';
import { initEngine, scheduleScout, weaveNow, backfillNow, backfillEstimate, status } from './engine.js';
import { initPanel, openPanel, closePanel, render as renderPanel, OVERLAY_ID } from './panel.js';
import { profiles, sourceLabel, usageToday } from './ai.js';
import { initLauncher, renderLauncher, updateLauncher, resetLauncherPos, LAUNCH_POS_DEFAULT } from './launcher.js';
import { diag, runDiagnostics } from './diag.js';
import { normalizeState, buildInjection, trimToChat, DEFAULT_TEMPLATE, progressOf, stats, sizeOf, phaseInfo, carryState } from './lib.js';

const MODULE = 'ouroboros';
const LOG = '[Ouroboros]';
const VERSION = '0.6.3'; // ให้ตรงกับ manifest.json เสมอ
const BASE_URL = new URL('.', import.meta.url);
const FILES = ['index.js', 'lib.js', 'engine.js', 'panel.js', 'ai.js', 'diag.js', 'launcher.js', 'theme-palette.js', 'style.css', 'manifest.json'];

const POS = { IN_CHAT: 1 };
const ROLE = { SYSTEM: 0, USER: 1, ASSISTANT: 2 };

const DEFAULTS = {
    enabled: true,
    scoutSource: 'main',
    architectSource: 'main',
    every: 0,               // 0 = ตามขนาดแผน
    depth: 3,
    role: ROLE.SYSTEM,
    template: DEFAULT_TEMPLATE,
    architectBudget: 6000,  // token ของเนื้อเรื่องล่าสุดที่ส่งให้ผู้ทอชะตา (ประมาณ)
    architectMaxTokens: 4000,   // room for thinking models; a cap, not what is spent
    scoutMaxTokens: 2000,
    timeoutSec: 120,
    leakAction: 'warn',     // warn | swipe | off
    scoutBackup: '',        // '' = none; used when the main API refuses or fails
    architectBackup: '',
    noRush: false,
    readLore: true,
    language: 'auto',       // auto | th | en: language of seeds, fates and notes the models write         // send the lorebook entries active in recent turns to the Architect          // ignore the Architect's "faster" (for models that rush to wrap up)
    launcher: true,
    launcherPos: LAUNCH_POS_DEFAULT,
};

const ctx = () => SillyTavern.getContext();

// ───────────────────────── settings / state ─────────────────────────

function settings() {
    const all = ctx().extensionSettings;
    all[MODULE] ??= {};
    const s = all[MODULE];
    for (const [k, v] of Object.entries(DEFAULTS)) if (s[k] === undefined) s[k] = structuredClone(v);
    // 0.6.2: the old caps left no room for thinking models (DeepSeek v4 pro answered empty); raise untouched defaults
    if (!s.capsRaised) {
        if (Number(s.scoutMaxTokens) === 600) s.scoutMaxTokens = DEFAULTS.scoutMaxTokens;
        if (Number(s.architectMaxTokens) === 2500) s.architectMaxTokens = DEFAULTS.architectMaxTokens;
        s.capsRaised = true;
    }
    return s;
}
const saveSettings = () => ctx().saveSettingsDebounced();

const hasChat = () => { try { return !!ctx().getCurrentChatId(); } catch { return false; } };
const chatId = () => String(ctx().getCurrentChatId() ?? '');

function state() {
    if (!hasChat()) return null;
    const meta = ctx().chatMetadata;
    if (!meta?.[MODULE]) return null;
    return normalizeState(meta[MODULE]);
}
function setState(st) {
    const meta = ctx().chatMetadata;
    if (!meta) return;
    if (st) { meta[MODULE] = st; delete meta[DECLINED]; }
    else { delete meta[MODULE]; meta[DECLINED] = true; } // stopped on purpose: don't carry a plan in again
}
const DECLINED = MODULE + '_declined';
const saveState = () => ctx().saveMetadataDebounced();

/** Branches, checkpoints, renames: the plan follows the chat, minus seeds past its end. */
function adoptIfMoved() {
    const st = state();
    if (!st) return;
    const id = chatId();
    if (st.owner?.chatId === id) return;
    const removed = trimToChat(st, ctx().chat ?? []);
    st.owner = { ...(st.owner ?? {}), chatId: id, groupId: ctx().groupId ?? null };
    diag(`adopted plan from another chat (trimmed ${removed} seeds)`);
    saveState();
}

// ───────────────────────── continued chats (Memory Hub chain) ─────────────────────────

/** The plan of the chat we were just in, kept so a continued chat can pick it up without a fetch. */
let lastSeen = null;
function rememberCurrent() {
    const st = state();
    if (!st) return;
    lastSeen = { chatId: chatId(), state: structuredClone(st), chat: (ctx().chat ?? []).map(m => ({ is_system: !!m.is_system, is_user: !!m.is_user, swipe_id: m.swipe_id ?? 0 })) };
}

async function readChatPlan(id) {
    const c = ctx();
    let res;
    if (c.groupId) {
        res = await fetch('/api/chats/group/get', { method: 'POST', headers: c.getRequestHeaders(), body: JSON.stringify({ id }) });
    } else {
        const ch = c.characters?.[c.characterId];
        if (!ch) return null;
        res = await fetch('/api/chats/get', { method: 'POST', headers: c.getRequestHeaders(), body: JSON.stringify({ ch_name: ch.name, file_name: id, avatar_url: ch.avatar }) });
    }
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return null;
    return { chatId: id, state: data[0]?.chat_metadata?.[MODULE] ?? null, chat: data.slice(1) };
}

/** Memory Hub writes its chain a moment after the new chat opens, so look a few times. */
async function tryCarry(prev, attempt = 0) {
    const id = chatId();
    if (!hasChat() || state() || ctx().chatMetadata?.[DECLINED]) return;
    const chain = ctx().chatMetadata?.memory_hub?.chain;
    const from = Array.isArray(chain) && chain.length ? String(chain[chain.length - 1]) : '';
    if (!from) {
        const wait = [1500, 3000, 5000][attempt];
        if (wait) setTimeout(() => { if (chatId() === id) tryCarry(prev, attempt + 1); }, wait);
        return;
    }
    let src = prev?.chatId === from ? prev : null;
    if (!src) { try { src = await readChatPlan(from); } catch (e) { diag(`carry read failed: ${e?.message ?? e}`); } }
    if (!src?.state || chatId() !== id || state()) return;
    setState(carryState(normalizeState(src.state), src.chat, { chatId: id, groupId: ctx().groupId ?? null, from }));
    saveState();
    refresh();
    diag(`carried plan from ${from}`);
    toastr.info('แผนของตอนก่อนตามมาด้วยแล้ว', 'Ouroboros', { timeOut: 4000 });
}

// ───────────────────────── leak guard ─────────────────────────

const autoSwiped = new Set();
function swipeLast() {
    const btn = document.querySelector('#chat .mes.last_mes .swipe_right');
    if (!btn) return false;
    btn.click();
    return true;
}
/** The Scout thinks a reply gave a held secret away. Never shows what the secret is. */
function onLeak({ msgId, chatId: cid }) {
    const s = settings();
    if (cid !== chatId() || s.leakAction === 'off') return;
    const chat = ctx().chat ?? [];
    const isLast = msgId === chat.length - 1;
    const key = `${cid}:${msgId}`;
    if (s.leakAction === 'swipe' && isLast && !autoSwiped.has(key) && !generating) {
        autoSwiped.add(key);
        if (swipeLast()) { toastr.info('ข้อความล่าสุดเผยความลับก่อนเวลา กำลัง swipe ใหม่ให้', 'Ouroboros', { timeOut: 4000 }); return; }
    }
    toastr.warning(isLast ? 'แตะที่นี่เพื่อ swipe ใหม่' : `ข้อความ #${msgId}`, 'Ouroboros: บอทอาจเผยความลับก่อนเวลา', {
        timeOut: 10000, extendedTimeOut: 4000, closeButton: true, onclick: isLast ? () => swipeLast() : undefined,
    });
}

// ───────────────────────── lorebook entries in play ─────────────────────────

/** Recent World Info activations (title + content), newest last, for the Architect. Kept in memory only. */
const loreSeen = new Map();
function onLoreActivated(entries) {
    if (!Array.isArray(entries)) return;
    for (const e of entries) {
        const title = String(e?.comment || (Array.isArray(e?.key) ? e.key[0] : e?.key) || '').trim();
        const content = String(e?.content ?? '').trim();
        if (!title || !content) continue;
        const id = `${e.world ?? ''}:${e.uid ?? title}`;
        loreSeen.delete(id);
        loreSeen.set(id, { title, content: content.slice(0, 500), chat: chatId(), at: Date.now() });
    }
    while (loreSeen.size > 60) loreSeen.delete(loreSeen.keys().next().value);
}
function loreForArchitect() {
    if (!settings().readLore) return [];
    const id = chatId();
    return [...loreSeen.values()].filter(l => l.chat === id).slice(-40).reverse();
}

// ───────────────────────── injection ─────────────────────────

function applyInjection(forceEmpty = false) {
    const s = settings();
    let text = '';
    if (!forceEmpty && s.enabled && hasChat()) {
        try { text = buildInjection(state(), ctx().chat ?? [], s.template); } catch (e) { console.warn(LOG, 'injection', e); diag(`ERROR injection: ${e?.message ?? e}`); }
    }
    ctx().setExtensionPrompt(MODULE, text, POS.IN_CHAT, Number(s.depth), false, Number(s.role));
}

function refresh() {
    applyInjection();
    renderPanel();
    updateSettingsStatus();
    updateLauncher();
    rememberCurrent();
}

function launcherState() {
    if (status.busy) return 'busy';
    if (status.lastError && (!status.lastOk || status.lastError.at > status.lastOk.at)) return 'attention';
    return '';
}
function launcherTitle() {
    const st = state();
    if (!settings().enabled) return 'Ouroboros ปิดอยู่ · แตะเพื่อเปิดแผง';
    if (!st) return 'Ouroboros · แชทนี้ยังไม่ได้วางชะตา · แตะเพื่อเริ่ม · ลากเพื่อย้าย';
    if (status.busy) return { architect: 'Ouroboros · กำลังทอชะตา…', backfill: 'Ouroboros · กำลังเก็บปมย้อนหลัง…' }[status.busy] ?? 'Ouroboros · กำลังเก็บปม…';
    const prog = progressOf(st, ctx().chat ?? []);
    return `Ouroboros · ${phaseInfo(prog.phase).label} · แตะเพื่อเปิด · ลากเพื่อย้าย`;
}

// ───────────────────────── generation tracking ─────────────────────────

let generating = false;
function onGenStarted(type, _opts, dryRun) {
    if (dryRun || type === 'quiet') return;
    generating = true;
}
function onGenDone() {
    generating = false;
    applyInjection();
}
/** Other extensions' background prompts (summaries etc.) must never see the secrets. */
function onAfterCommands(type, _opts, dryRun) {
    if (type === 'quiet') { applyInjection(true); return; }
    if (!dryRun) applyInjection();
}

function onMessageReceived(mesId) {
    const s = settings();
    const st = state();
    if (!s.enabled || !st || st.ended) return;
    const m = (ctx().chat ?? [])[Number(mesId)];
    if (!m || m.is_user || m.is_system) return;
    scheduleScout();
}

// ───────────────────────── settings drawer ─────────────────────────

function sourceOptions(cur, withNone = false) {
    const list = [...(withNone ? [{ id: '', name: 'ไม่มี' }] : []), { id: 'main', name: 'API หลักของ ST' }, ...profiles()];
    if (cur && !list.some(p => p.id === cur)) list.push({ id: cur, name: sourceLabel(cur) });
    return list.map(p => `<option value="${esc(p.id)}" ${p.id === cur ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function mountSettings() {
    const s = settings();
    const html = `
<div id="ouro_settings" class="ouro-settings">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b><i class="fa-solid fa-infinity"></i> Ouroboros <small class="ouro-ver">v${VERSION}</small></b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
      <label class="checkbox_label"><input type="checkbox" id="ouro_enabled" ${s.enabled ? 'checked' : ''}><span>เปิดใช้ (เก็บปม ทอชะตา ส่งบันทึกลับ)</span></label>
      <div class="ouro-set-actions"><button class="menu_button" id="ouro_open"><i class="fa-solid fa-infinity"></i> เปิดแผง</button></div>

      <h5>โมเดล</h5>
      <div class="ouro-set-row"><span>ผู้เก็บปม</span><select id="ouro_scout_src" class="text_pole"></select></div>
      <small class="ouro-set-hint">อ่านข้อความล่าสุดแล้วดึงปม ทำทุกครั้งที่บอทตอบ ใช้โมเดลถูกและเร็วได้</small>
      <div class="ouro-set-row"><span>ผู้ทอชะตา</span><select id="ouro_arch_src" class="text_pole"></select></div>
      <small class="ouro-set-hint">เขียน ให้คะแนน ตัด และล็อกชะตา ทำห่าง ๆ ควรใช้โมเดลเก่งที่สุดที่มี · เลือกได้จาก Connection Profile ของ ST</small>
      <div class="ouro-set-row"><span>ผู้เก็บปม สำรอง</span><select id="ouro_scout_bak" class="text_pole"></select></div>
      <div class="ouro-set-row"><span>ผู้ทอชะตา สำรอง</span><select id="ouro_arch_bak" class="text_pole"></select></div>
      <small class="ouro-set-hint">ใช้เมื่อโมเดลหลักปฏิเสธ (กำแพงศีลธรรม) ตอบว่าง หรือเรียกไม่สำเร็จ เช่น หลักเป็น GPT สำรองเป็น DeepSeek สำหรับฉากหนัก</small>
      <label class="checkbox_label"><input type="checkbox" id="ouro_norush" ${s.noRush ? 'checked' : ''}><span>ห้ามเร่งเรื่อง</span></label>
      <small class="ouro-set-hint">ผู้ทอชะตาชะลอจังหวะได้อย่างเดียว เร่งไม่ได้ เหมาะกับโมเดลที่ชอบรีบคลี่คลาย</small>
      <label class="checkbox_label"><input type="checkbox" id="ouro_lore" ${s.readLore ? 'checked' : ''}><span>อ่าน lorebook ที่ทำงานอยู่</span></label>
      <small class="ouro-set-hint">ส่งรายการ lorebook ที่ถูกดึงเข้าฉากล่าสุดให้ผู้ทอชะตาด้วย (ไม่เกินราว 1,300 token) ช่วยบอทตัวละครเยอะและแฟนด้อม</small>
      <div class="ouro-set-row"><span>ภาษาของปมและชะตา</span><select id="ouro_lang" class="text_pole">
        <option value="auto" ${s.language === 'auto' ? 'selected' : ''}>อัตโนมัติ</option>
        <option value="th" ${s.language === 'th' ? 'selected' : ''}>ไทย</option>
        <option value="en" ${s.language === 'en' ? 'selected' : ''}>English</option></select></div>
      <small class="ouro-set-hint">อัตโนมัติ = ภาษาของข้อความล่าสุด (ไม่ใช่ข้อความแรกหรือการ์ด ซึ่งอาจเป็นอีกภาษา)</small>
      <div class="ouro-set-row"><span>ทอชะตาทุก</span><input id="ouro_every" type="number" min="0" max="60" class="text_pole" value="${Number(s.every) || 0}"></div>
      <small class="ouro-set-hint">จำนวนข้อความของบอท · 0 = ตามขนาดแผน (สั้น 6 · กลาง 8 · ยาว 10 · มหากาพย์ 12)</small>
      <div class="ouro-set-row"><span>ความลับรั่ว</span><select id="ouro_leak" class="text_pole">
        <option value="warn" ${s.leakAction === 'warn' ? 'selected' : ''}>เตือน</option>
        <option value="swipe" ${s.leakAction === 'swipe' ? 'selected' : ''}>swipe ใหม่เอง</option>
        <option value="off" ${s.leakAction === 'off' ? 'selected' : ''}>ไม่ตรวจ</option></select></div>
      <small class="ouro-set-hint">หลังล็อกชะตา ผู้เก็บปมตรวจด้วยว่าบอทเผยความลับก่อนเวลาไหม ทำในการเรียกเดียวกัน ไม่เสีย API เพิ่ม · swipe ใหม่เองทำครั้งเดียวต่อข้อความ · คำเตือนไม่บอกว่าความลับคืออะไร</small>
      <p class="ouro-set-hint" id="ouro_usage"></p>

      <h5>ปุ่มลอย</h5>
      <label class="checkbox_label"><input type="checkbox" id="ouro_launcher_on" ${s.launcher ? 'checked' : ''}><span>แสดงปุ่มลอยบนจอ</span></label>
      <small class="ouro-set-hint">แตะ = เปิดแผง · ลาก = ย้าย · เก็บเข้า Quick Dock ได้ (จุดบนปุ่มหลักของ dock บอกว่ากำลังทำงานหรือทำไม่สำเร็จ)</small>
      <div class="ouro-set-actions"><button class="menu_button" id="ouro_launcher_reset">คืนตำแหน่งปุ่ม</button></div>

      <details class="ouro-set-adv">
        <summary>ขั้นสูง</summary>
        <div class="ouro-set-row"><span>ความลึกที่แทรก</span><input id="ouro_depth" type="number" min="0" max="50" class="text_pole" value="${Number(s.depth)}"></div>
        <div class="ouro-set-row"><span>ส่งในนาม</span><select id="ouro_role" class="text_pole">
          <option value="0" ${Number(s.role) === 0 ? 'selected' : ''}>System</option>
          <option value="1" ${Number(s.role) === 1 ? 'selected' : ''}>User</option>
          <option value="2" ${Number(s.role) === 2 ? 'selected' : ''}>Assistant</option></select></div>
        <div class="ouro-set-row"><span>เนื้อเรื่องที่ส่งให้ผู้ทอชะตา</span><input id="ouro_budget" type="number" min="1000" max="60000" step="500" class="text_pole" value="${Number(s.architectBudget)}"></div>
        <small class="ouro-set-hint">token โดยประมาณ ข้อความเก่ากว่านี้ใช้สรุปจาก Memory Hub แทน (ถ้าติดตั้งไว้)</small>
        <div class="ouro-set-row"><span>คำตอบผู้เก็บปมสูงสุด</span><input id="ouro_scout_max" type="number" min="300" max="16000" step="100" class="text_pole" value="${Number(s.scoutMaxTokens)}"></div>
        <div class="ouro-set-row"><span>คำตอบผู้ทอชะตาสูงสุด</span><input id="ouro_arch_max" type="number" min="500" max="16000" step="100" class="text_pole" value="${Number(s.architectMaxTokens)}"></div>
        <div class="ouro-set-row"><span>รอคำตอบนานสุด (วินาที)</span><input id="ouro_timeout" type="number" min="20" max="600" class="text_pole" value="${Number(s.timeoutSec)}"></div>
        <label class="ouro-set-label" for="ouro_template">แม่แบบบันทึกลับ <small>{{phase}} {{beat}} {{seeds}} {{secrets}}</small></label>
        <textarea id="ouro_template" class="text_pole" rows="6">${esc(s.template)}</textarea>
        <div class="ouro-set-actions"><button class="menu_button" id="ouro_template_reset">คืนค่าแม่แบบ</button></div>
        <small class="ouro-set-hint">บันทึกลับมีเนื้อหาของแผน ดูได้ใน prompt inspector ของ ST ถ้าไม่อยากโดนสปอยล์อย่าเปิดดู · ถ้าโมเดลแสดงส่วนคิด (&lt;think&gt;) ให้ซ่อนส่วนนั้น เพราะโมเดลอาจคิดถึงบันทึกลับในนั้น</small>
      </details>

      <p class="ouro-set-status" id="ouro_status"></p>
      <div class="ouro-set-actions">
        <button class="menu_button" id="ouro_diag"><i class="fa-solid fa-stethoscope"></i> ตรวจปัญหา</button>
        <button class="menu_button" id="ouro_reload"><i class="fa-solid fa-rotate"></i> โหลดเวอร์ชันล่าสุด</button>
      </div>
      <small class="ouro-set-hint" id="ouro_version_line">กำลังรัน v${VERSION}</small>
      <div id="ouro_diag_box" hidden>
        <textarea class="text_pole" rows="10" readonly></textarea>
        <div class="ouro-set-actions"><button class="menu_button" id="ouro_diag_copy">คัดลอกรายงาน</button></div>
      </div>
    </div>
  </div>
</div>`;
    $('#extensions_settings2').append(html);
    fillSources();

    const num = (sel, key, lo, hi) => $(sel).on('change', function () {
        const v = Math.round(Number(this.value));
        settings()[key] = Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : DEFAULTS[key];
        this.value = settings()[key];
        saveSettings();
        applyInjection();
    });
    $('#ouro_enabled').on('change', function () { settings().enabled = this.checked; saveSettings(); refresh(); });
    $('#ouro_open').on('click', () => openPanel());
    $('#ouro_scout_src').on('change', function () { settings().scoutSource = this.value; saveSettings(); });
    $('#ouro_arch_src').on('change', function () { settings().architectSource = this.value; saveSettings(); });
    $('#ouro_scout_bak').on('change', function () { settings().scoutBackup = this.value; saveSettings(); });
    $('#ouro_arch_bak').on('change', function () { settings().architectBackup = this.value; saveSettings(); });
    $('#ouro_norush').on('change', function () { settings().noRush = this.checked; saveSettings(); });
    $('#ouro_lang').on('change', function () { settings().language = this.value; saveSettings(); });
    $('#ouro_lore').on('change', function () { settings().readLore = this.checked; saveSettings(); });
    num('#ouro_every', 'every', 0, 60);
    num('#ouro_depth', 'depth', 0, 50);
    num('#ouro_budget', 'architectBudget', 1000, 60000);
    num('#ouro_arch_max', 'architectMaxTokens', 500, 16000);
    num('#ouro_scout_max', 'scoutMaxTokens', 300, 16000);
    num('#ouro_timeout', 'timeoutSec', 20, 600);
    $('#ouro_leak').on('change', function () { settings().leakAction = this.value; saveSettings(); });
    $('#ouro_launcher_on').on('change', function () { settings().launcher = this.checked; saveSettings(); renderLauncher(); });
    $('#ouro_launcher_reset').on('click', () => { resetLauncherPos(); $('#ouro_launcher_on').prop('checked', true); });
    $('#ouro_role').on('change', function () { settings().role = Number(this.value); saveSettings(); applyInjection(); });
    $('#ouro_template').on('input', function () { settings().template = this.value; saveSettings(); applyInjection(); });
    $('#ouro_template_reset').on('click', () => { settings().template = DEFAULT_TEMPLATE; $('#ouro_template').val(DEFAULT_TEMPLATE); saveSettings(); applyInjection(); });
    $('#ouro_settings .inline-drawer-toggle').on('click', () => { fillSources(); updateSettingsStatus(); });
    $('#ouro_diag').on('click', showDiagnostics);
    $('#ouro_diag_copy').on('click', copyDiagnostics);
    $('#ouro_reload').on('click', reloadWithFreshFiles);
    updateSettingsStatus();
}

function fillSources() {
    const s = settings();
    $('#ouro_scout_src').html(sourceOptions(s.scoutSource));
    $('#ouro_arch_src').html(sourceOptions(s.architectSource));
    $('#ouro_scout_bak').html(sourceOptions(s.scoutBackup, true));
    $('#ouro_arch_bak').html(sourceOptions(s.architectBackup, true));
}

function updateUsage() {
    const el = document.getElementById('ouro_usage');
    if (!el) return;
    const u = usageToday().roles;
    const tok = r => Math.round(((r?.inChars ?? 0) + (r?.outChars ?? 0)) / 3 / 1000);
    const part = (r, name) => `${name} ${r?.calls ?? 0} ครั้ง${r?.fails ? ` (ไม่สำเร็จ ${r.fails})` : ''}`;
    el.textContent = `วันนี้ในเครื่องนี้: ${part(u.scout, 'เก็บปม')} · ${part(u.architect, 'ทอชะตา')} · ≈${tok(u.scout) + tok(u.architect)}k token`;
}

function updateSettingsStatus() {
    updateUsage();
    const el = document.getElementById('ouro_status');
    if (!el) return;
    const st = state();
    if (!hasChat()) { el.textContent = 'ยังไม่ได้เปิดแชท'; return; }
    if (!st) { el.textContent = 'แชทนี้ยังไม่ได้วางชะตา · กด เปิดแผง เพื่อเริ่ม'; return; }
    const prog = progressOf(st, ctx().chat ?? []);
    const k = stats(st, ctx().chat ?? []);
    let line = `แชทนี้: ${sizeOf(st.size).label} · ${phaseInfo(prog.phase).label} · ปม ${k.planted} (เฉลย ${k.paid})`;
    if (status.busy) line += { architect: ' · กำลังทอชะตา…', backfill: ' · กำลังเก็บปมย้อนหลัง…' }[status.busy] ?? ' · กำลังเก็บปม…';
    else if (status.lastError && (!status.lastOk || status.lastError.at > status.lastOk.at)) line += ` · ไม่สำเร็จ: ${status.lastError.msg}`;
    el.textContent = line;
}

function mountWand() {
    const item = $(`<div id="ouro_wand" class="list-group-item flex-container flexGap5 interactable" tabindex="0" role="listitem">
  <div class="fa-solid fa-infinity extensionsMenuExtensionButton"></div><span>Ouroboros</span></div>`);
    item.on('click', () => openPanel());
    $('#extensionsMenu').append(item);
}

// ───────────────────────── diagnostics / version ─────────────────────────

let remoteVersion = null;
async function fetchRemoteVersion() {
    try {
        const r = await fetch(new URL('manifest.json', BASE_URL), { cache: 'no-store' });
        return (await r.json())?.version ?? null;
    } catch { return null; }
}

function settingsSummary() {
    const s = settings();
    return JSON.stringify({ enabled: s.enabled, scout: sourceLabel(s.scoutSource), architect: sourceLabel(s.architectSource), backups: [s.scoutBackup ? sourceLabel(s.scoutBackup) : '-', s.architectBackup ? sourceLabel(s.architectBackup) : '-'], noRush: s.noRush, every: s.every, depth: s.depth, role: s.role, budget: s.architectBudget, templateLen: String(s.template ?? '').length });
}
function stateSummary() {
    const st = state();
    if (!st) return hasChat() ? 'no plan in this chat' : 'no chat';
    const chat = ctx().chat ?? [];
    const prog = progressOf(st, chat);
    const k = stats(st, chat);
    return JSON.stringify({ size: st.size, cycle: st.cycle, arc: st.arc.index, startedAt: st.startedAt, chatLen: chat.length, phase: prog.phase, main: +prog.main.toFixed(2), alive: k.alive, locked: k.locked, seeds: k.planted, paid: k.paid, unrealized: k.unrealized, ended: st.ended, busy: status.busy, lastError: status.lastError?.msg ?? null });
}

async function diagnose() {
    remoteVersion = await fetchRemoteVersion();
    return runDiagnostics({ VERSION, remoteVersion, settingsSummary, stateSummary, openOverlay: () => openPanel('home'), closeOverlay: closePanel, OVERLAY_ID, FRAME_SELECTOR: '.ouro-frame' });
}
async function showDiagnostics() {
    const report = await diagnose();
    $('#ouro_diag_box').prop('hidden', false).find('textarea').val(report);
}
async function copyDiagnostics() {
    const ta = $('#ouro_diag_box textarea')[0];
    try { await navigator.clipboard.writeText(ta.value); toastr.success('คัดลอกรายงานแล้ว'); } catch { ta.select(); toastr.info('เลือกข้อความไว้แล้ว กดคัดลอกเองได้เลย'); }
}

async function checkVersion() {
    remoteVersion = await fetchRemoteVersion();
    const line = document.getElementById('ouro_version_line');
    if (line) line.textContent = remoteVersion && remoteVersion !== VERSION ? `กำลังรัน v${VERSION} · ติดตั้งไว้ v${remoteVersion} กด โหลดเวอร์ชันล่าสุด` : `กำลังรัน v${VERSION}`;
    if (remoteVersion && remoteVersion !== VERSION) {
        toastr.info(`ติดตั้ง v${esc(remoteVersion)} ไว้แล้ว แต่หน้านี้ยังรัน v${VERSION}<br>แตะที่นี่เพื่อโหลดเวอร์ชันใหม่`, 'Ouroboros', { timeOut: 0, extendedTimeOut: 0, closeButton: true, escapeHtml: false, onclick: reloadWithFreshFiles });
    }
}

async function reloadWithFreshFiles() {
    try {
        toastr.info('กำลังดึงไฟล์ใหม่…', 'Ouroboros', { timeOut: 2000 });
        const c = ctx();
        await Promise.all([
            Promise.resolve(typeof c.saveSettings === 'function' ? c.saveSettings() : null).catch(() => null),
            Promise.resolve(typeof c.saveMetadata === 'function' && hasChat() ? c.saveMetadata() : null).catch(() => null),
            ...FILES.map(f => fetch(new URL(f, BASE_URL), { cache: 'reload' }).catch(() => null)),
        ]);
    } finally {
        location.reload();
    }
}

// ───────────────────────── slash commands ─────────────────────────

function registerCommands() {
    const { SlashCommandParser, SlashCommand } = ctx();
    if (!SlashCommandParser || !SlashCommand) return;
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'ouro', helpString: 'เปิดแผง Ouroboros', returns: 'nothing',
        callback: () => { openPanel(); return ''; },
    }));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'ouro-weave', helpString: 'ให้ผู้ทอชะตาทำงานตอนนี้ (ไม่ต้องรอครบรอบ)', returns: 'nothing',
        callback: () => { if (state()) weaveNow('manual'); else toastr.info('แชทนี้ยังไม่ได้วางชะตา'); return ''; },
    }));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'ouro-debug', helpString: 'ตรวจปัญหาแล้วคืนรายงาน (ไม่มีเนื้อหาของแผน)', returns: 'report',
        callback: async () => diagnose(),
    }));
}

// ───────────────────────── init ─────────────────────────

jQuery(async () => {
    try { installThemePalette({ prefix: 'ouro' }); } catch (err) { console.warn(LOG, 'theme palette', err); }
    try {
        settings();
        initEngine({
            settings, state, save: () => { saveState(); refresh(); }, changed: () => { renderPanel(); updateSettingsStatus(); updateLauncher(); },
            generating: () => generating, chatId, diag, onLeak, lore: loreForArchitect,
        });
        initPanel({
            settings, state, setState, save: saveState, refresh, chatId, diag, status,
            weave: reason => weaveNow(reason), scout: () => scheduleScout(0), backfill: () => backfillNow(), estimate: st => backfillEstimate(st),
        });
        mountSettings();
        mountWand();
        initLauncher({ settings, save: saveSettings, open: () => openPanel(), state: launcherState, title: launcherTitle });
        renderLauncher();
        registerCommands();

        const { eventSource, eventTypes: E } = ctx();
        eventSource.on(E.CHAT_CHANGED, () => { const prev = lastSeen; adoptIfMoved(); refresh(); tryCarry(prev); });
        eventSource.on(E.GENERATION_STARTED, onGenStarted);
        eventSource.on(E.GENERATION_AFTER_COMMANDS, onAfterCommands);
        eventSource.on(E.GENERATION_ENDED, onGenDone);
        eventSource.on(E.GENERATION_STOPPED, onGenDone);
        eventSource.on(E.MESSAGE_RECEIVED, onMessageReceived);
        eventSource.on(E.MESSAGE_SWIPED, () => refresh());
        eventSource.on(E.MESSAGE_DELETED, () => { const st = state(); if (st && trimToChat(st, ctx().chat ?? [])) saveState(); refresh(); });
        eventSource.on(E.MESSAGE_EDITED, () => refresh());
        if (E.WORLD_INFO_ACTIVATED) eventSource.on(E.WORLD_INFO_ACTIVATED, onLoreActivated);

        applyInjection();
        setTimeout(() => { fillSources(); checkVersion(); }, 3000);
        globalThis.Ouroboros = { open: openPanel, close: closePanel, weave: () => weaveNow('manual'), version: VERSION };
        console.log(LOG, `v${VERSION} ready`);
    } catch (err) {
        console.error(LOG, 'failed to load', err);
        toastr.error(String(err?.message ?? err), 'Ouroboros โหลดไม่สำเร็จ');
    }
});
