// Ouroboros — floating button.
// Tap = open the panel · drag = move (snaps to the nearest edge).
// Placed in px from visualViewport, never with transform (ST puts a 3D perspective on <html>).
// Quick Dock can take it into its tray: stable id #ouro_launcher, and data-state
// ("busy" while a job runs, "attention" after a failure) lights the dock's status dot.

export const LAUNCH_POS_DEFAULT = Object.freeze({ x: 1, y: 0.62, edge: 'right' });

/** @type {{settings:()=>any, save:()=>void, open:()=>void, state:()=>string, title:()=>string}} */
let host;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ID = 'ouro_launcher';

export function initLauncher(h) {
    host = h;
    window.visualViewport?.addEventListener('resize', placeSoon);
    window.visualViewport?.addEventListener('scroll', placeSoon);
    window.addEventListener('resize', placeSoon);
}

function visibleArea() {
    const vv = window.visualViewport;
    return vv ? { x: vv.offsetLeft, y: vv.offsetTop, w: vv.width, h: vv.height } : { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
}

export function placeLauncher(el = document.getElementById(ID)) {
    if (!el || el.classList.contains('ouro-dragging')) return;
    if (el.closest('#qd_panel, #qd_arc')) return; // living inside Quick Dock: the dock places it
    const { x: ox, y: oy, w: vw, h: vh } = visibleArea();
    const p = host.settings().launcherPos || LAUNCH_POS_DEFAULT;
    const m = 8, w = el.offsetWidth, h = el.offsetHeight;
    let left = m + clamp(Number(p.x) || 0, 0, 1) * Math.max(0, vw - w - 2 * m);
    let top = m + clamp(Number(p.y) || 0, 0, 1) * Math.max(0, vh - h - 2 * m);
    if (p.edge === 'left') left = m;
    if (p.edge === 'right') left = vw - w - m;
    if (p.edge === 'top') top = m;
    if (p.edge === 'bottom') top = vh - h - m;
    el.style.left = `${Math.round(ox + left)}px`;
    el.style.top = `${Math.round(oy + top)}px`;
}

let placeTimer = null;
function placeSoon() {
    requestAnimationFrame(() => placeLauncher());
    clearTimeout(placeTimer);
    placeTimer = setTimeout(() => placeLauncher(), 350); // iOS reports the size late after the keyboard moves
}

/** Status for Quick Dock and the button's own look. */
export function updateLauncher() {
    const el = document.getElementById(ID);
    if (!el) return;
    el.dataset.state = host.state();
    el.title = host.title();
    el.setAttribute('aria-label', host.title());
}

export function renderLauncher() {
    let el = document.getElementById(ID);
    if (!host.settings().launcher) { el?.remove(); return; }
    if (el) { placeLauncher(el); updateLauncher(); return; }
    el = document.createElement('div');
    el.id = ID;
    el.className = 'ouro-launch';
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.innerHTML = '<i class="fa-solid fa-infinity" aria-hidden="true"></i>';
    document.body.append(el);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); host.open(); } });
    el.addEventListener('contextmenu', e => e.preventDefault());

    let start = null, moved = false, skipClick = false;
    // open on click, not pointerup: a panel opened under the finger would catch the following click on its backdrop
    el.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        if (skipClick) { skipClick = false; return; } // the click that follows a drag
        host.open();
    });
    el.addEventListener('pointerdown', e => {
        if (e.button !== 0 || el.closest('#qd_panel, #qd_arc')) return;
        const r = el.getBoundingClientRect();
        start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, id: e.pointerId };
        moved = false;
        skipClick = false;
        try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    el.addEventListener('pointermove', e => {
        if (!start || e.pointerId !== start.id) return;
        const dx = e.clientX - start.x, dy = e.clientY - start.y;
        if (!moved && Math.hypot(dx, dy) < 6) return;
        moved = true;
        el.classList.add('ouro-dragging');
        const a = visibleArea();
        el.style.left = `${clamp(start.left + dx, a.x, a.x + a.w - el.offsetWidth)}px`;
        el.style.top = `${clamp(start.top + dy, a.y, a.y + a.h - el.offsetHeight)}px`;
    });
    const end = e => {
        if (!start || e.pointerId !== start.id) return;
        start = null;
        if (!moved) return; // a plain tap: the click opens the panel
        skipClick = true;
        el.classList.remove('ouro-dragging');
        const { x: ox, y: oy, w: vw, h: vh } = visibleArea();
        const b = el.getBoundingClientRect();
        const r = { left: b.left - ox, top: b.top - oy, right: b.right - ox, bottom: b.bottom - oy, width: b.width, height: b.height };
        const dist = { left: r.left, right: vw - r.right, top: r.top, bottom: vh - r.bottom };
        const edge = Object.keys(dist).reduce((a, k) => (dist[k] < dist[a] ? k : a));
        host.settings().launcherPos = {
            x: clamp((r.left - 8) / Math.max(1, vw - r.width - 16), 0, 1),
            y: clamp((r.top - 8) / Math.max(1, vh - r.height - 16), 0, 1),
            edge,
        };
        host.save();
        placeLauncher(el);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    placeLauncher(el);
    updateLauncher();
}

export function resetLauncherPos() {
    const s = host.settings();
    s.launcherPos = { ...LAUNCH_POS_DEFAULT };
    s.launcher = true;
    host.save();
    renderLauncher();
    placeLauncher();
}
