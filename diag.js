// Ouroboros — on-screen diagnostics (phones have no console). Adapted from the shared overlay checklist.

const diagLog = [];
export function diag(msg) {
    diagLog.push(`${new Date().toISOString().slice(11, 23)} ${msg}`);
    if (diagLog.length > 40) diagLog.shift();
}

const BASE = new URL('.', import.meta.url).href;
window.addEventListener('error', e => { if (String(e.filename || '').startsWith(BASE)) diag(`window error ${e.message} @${String(e.filename).slice(BASE.length)}:${e.lineno}`); });
window.addEventListener('unhandledrejection', e => { if (String(e.reason?.stack || '').includes(BASE)) diag(`unhandled ${e.reason?.message ?? e.reason}`); });

function elName(el) {
    if (!el) return 'null';
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    return `${el.tagName?.toLowerCase()}${el.id ? '#' + el.id : ''}${cls}`;
}

function fixedBreakers(el) {
    const out = [];
    for (let n = el?.parentElement; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        const bad = ['transform', 'perspective', 'filter', 'backdropFilter', 'contain', 'willChange']
            .filter(k => cs[k] && !['none', 'normal', 'auto', ''].includes(cs[k]))
            .map(k => `${k}:${cs[k]}`);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') bad.push(`display:${cs.display} visibility:${cs.visibility} opacity:${cs.opacity}`);
        if (bad.length) out.push(`${elName(n)} {${bad.join('; ')}}`);
    }
    return out;
}

/** The report never contains fate or secret text: only counts, settings and layout. */
export async function runDiagnostics({ VERSION, remoteVersion, settingsSummary, stateSummary, openOverlay, closeOverlay, OVERLAY_ID, FRAME_SELECTOR }) {
    const lines = [];
    const add = (k, v) => lines.push(`${k}: ${v}`);
    add('version', `v${VERSION} (server ${remoteVersion ?? '?'})`);
    add('ua', navigator.userAgent);
    const vv = window.visualViewport;
    add('viewport', `${innerWidth}x${innerHeight} · vv ${vv ? `${Math.round(vv.width)}x${Math.round(vv.height)} @${Math.round(vv.offsetLeft)},${Math.round(vv.offsetTop)} scale ${vv.scale}` : '-'} · dpr ${devicePixelRatio}`);
    add('settings', settingsSummary());
    add('state', stateSummary());

    const before = diagLog.length;
    openOverlay();
    await new Promise(r => setTimeout(r, 700));
    const o = document.getElementById(OVERLAY_ID);
    add('overlay', o ? `inDOM=${document.body.contains(o)} parent=${elName(o.parentElement)} class="${o.className}"` : 'missing');
    if (o) {
        const cs = getComputedStyle(o), r = o.getBoundingClientRect();
        add('overlay style', `display:${cs.display} visibility:${cs.visibility} opacity:${cs.opacity} position:${cs.position} z:${cs.zIndex} transform:${cs.transform}`);
        add('overlay rect', `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`);
        const f = o.querySelector(FRAME_SELECTOR);
        if (f) { const rf = f.getBoundingClientRect(); add('frame', `${Math.round(rf.left)},${Math.round(rf.top)} ${Math.round(rf.width)}x${Math.round(rf.height)} opacity:${getComputedStyle(f).opacity}`); }
        add('at screen points', [0.15, 0.5, 0.85].map(fy => {
            const el = document.elementFromPoint(innerWidth / 2, innerHeight * fy);
            return `${Math.round(fy * 100)}%=${o.contains(el) ? 'overlay' : elName(el)}`;
        }).join(' · '));
        const br = fixedBreakers(o);
        add('fixed breakers', br.length ? br.join(' | ') : 'none');
    }
    add('log', '');
    lines.push(...diagLog.slice(Math.max(0, before - 12)).map(x => '  ' + x));
    closeOverlay();
    return lines.join('\n');
}
