// Small UI kit: toasts, popovers, menus (optionally searchable), modals.

import { esc } from './util.js';

// ─── Toasts ──────────────────────────────────────────────────────────────────

/** toast('Saved') · toast('Bad file', { type: 'error' }) · toast(msg, { action: { label, fn } }) */
export function toast(msg, { type = 'info', action = null, ms = null } = {}) {
  let host = document.getElementById('toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span>${esc(msg)}</span>`;
  const close = () => el.remove();
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.addEventListener('click', () => { close(); action.fn(); });
    el.appendChild(b);
  }
  const x = document.createElement('button');
  x.className = 'toast-x';
  x.setAttribute('aria-label', 'Dismiss');
  x.textContent = '×';
  x.addEventListener('click', close);
  el.appendChild(x);
  host.appendChild(el);
  setTimeout(close, ms ?? (type === 'error' ? 9000 : action ? 8000 : 4000));
  return close;
}

// ─── Popovers ────────────────────────────────────────────────────────────────

let _open = null; // { el, anchor, onClose }

export function closePopover() {
  if (!_open) return;
  const { el, anchor, onClose } = _open;
  _open = null;
  el.remove();
  anchor?.classList.remove('is-open');
  anchor?.setAttribute?.('aria-expanded', 'false');
  onClose?.();
}

export function popoverAnchor() {
  return _open?.anchor || null;
}

/**
 * Show `content` (an element) in a floating box next to `anchor` (an element or
 * a DOMRect-like object). Closes on outside click, Escape, resize.
 */
export function openPopover(anchor, content, { align = 'left', cls = '', onClose = null } = {}) {
  // a second press on the same button closes its popover
  if (_open && anchor instanceof Element && _open.anchor === anchor) { closePopover(); return null; }
  closePopover();
  const el = document.createElement('div');
  el.className = `popover ${cls}`;
  el.appendChild(content);
  document.body.appendChild(el);
  const isEl = anchor instanceof Element;
  _open = { el, anchor: isEl ? anchor : null, onClose };
  if (isEl) { anchor.classList.add('is-open'); anchor.setAttribute('aria-expanded', 'true'); }

  const r = isEl ? anchor.getBoundingClientRect() : anchor;
  const w = el.offsetWidth;
  let h = el.offsetHeight;
  let left = align === 'right' ? r.right - w : align === 'center' ? r.left + r.width / 2 - w / 2 : r.left;
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  // below the anchor if it fits, else on the side with more room, shrunk to fit
  const below = window.innerHeight - r.bottom - 14, above = r.top - 14;
  const up = h > below && above > below;
  if (h > (up ? above : below)) {
    content.style.maxHeight = `${Math.max(120, up ? above : below)}px`;
    h = el.offsetHeight;
  }
  let top = up ? r.top - h - 6 : r.bottom + 6;
  el.style.left = `${left}px`;
  el.style.top = `${Math.max(8, top)}px`;
  return el;
}

document.addEventListener('mousedown', e => {
  if (!_open) return;
  if (_open.el.contains(e.target) || _open.anchor?.contains(e.target)) return;
  closePopover();
}, true);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && _open) { e.stopPropagation(); closePopover(); }
}, true);
window.addEventListener('resize', closePopover);

// ─── Menus ───────────────────────────────────────────────────────────────────

/**
 * items: [{ label, hint, keys, onClick, danger, checked, disabled, keepOpen }
 *         | { heading } | { sep: true }]
 * opts:  { search: bool, placeholder, title, align, cls }
 */
export function openMenu(anchor, items, opts = {}) {
  const box = document.createElement('div');
  box.className = 'menu';
  box.setAttribute('role', 'menu');
  let input = null;
  if (opts.title) {
    const t = document.createElement('div');
    t.className = 'menu-title';
    t.textContent = opts.title;
    box.appendChild(t);
  }
  if (opts.search) {
    input = document.createElement('input');
    input.type = 'search';
    input.className = 'menu-search';
    input.placeholder = opts.placeholder || 'Search…';
    input.autocomplete = 'off';
    input.spellcheck = false;
    box.appendChild(input);
  }
  const list = document.createElement('div');
  list.className = 'menu-list';
  box.appendChild(list);

  let active = -1;
  let shown = [];

  const render = q => {
    list.innerHTML = '';
    shown = [];
    const words = (q || '').toLowerCase().split(/\s+/).filter(Boolean);
    const match = it => {
      if (!words.length) return true;
      const hay = `${it.label} ${it.hint || ''} ${it.keys || ''}`.toLowerCase();
      return words.every(w => hay.includes(w));
    };
    let pendingHeading = null;
    for (const it of items) {
      if (it.heading) { pendingHeading = it.heading; continue; }
      if (it.sep) {
        if (!words.length && list.lastChild) list.appendChild(Object.assign(document.createElement('div'), { className: 'menu-sep' }));
        continue;
      }
      if (!match(it)) continue;
      if (pendingHeading) {
        list.appendChild(Object.assign(document.createElement('div'), { className: 'menu-heading', textContent: pendingHeading }));
        pendingHeading = null;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'menu-item' + (it.danger ? ' danger' : '') + (it.checked ? ' checked' : '');
      b.setAttribute('role', 'menuitem');
      b.disabled = !!it.disabled;
      b.innerHTML = `<span class="menu-label">${esc(it.label)}</span>` +
        (it.hint ? `<span class="menu-hint">${esc(it.hint)}</span>` : '');
      b.addEventListener('click', () => {
        if (!it.keepOpen) closePopover();
        it.onClick?.(b);
      });
      b.addEventListener('mousemove', () => setActive(shown.indexOf(b)));
      list.appendChild(b);
      if (!it.disabled) shown.push(b);
    }
    if (!shown.length) {
      list.appendChild(Object.assign(document.createElement('div'), { className: 'menu-empty', textContent: 'Nothing found' }));
    }
    setActive(words.length && shown.length ? 0 : -1);
  };

  const setActive = i => {
    shown.forEach(b => b.classList.remove('active'));
    active = i;
    if (i >= 0 && shown[i]) {
      shown[i].classList.add('active');
      shown[i].scrollIntoView({ block: 'nearest' });
    }
  };

  box.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(shown.length - 1, active + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(0, active - 1)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); shown[active].click(); }
  });
  if (input) input.addEventListener('input', () => render(input.value));

  render('');
  setActive(shown.findIndex(b => b.classList.contains('checked')));
  if (!openPopover(anchor, box, { align: opts.align || 'left', cls: `popover-menu ${opts.cls || ''}`, onClose: opts.onClose })) return null;
  if (input) input.focus();
  else { box.tabIndex = -1; box.focus(); }
  return box;
}

// ─── Dropdowns ───────────────────────────────────────────────────────────────
// Every <select> stays in the page as the value holder (hidden) and is shown as
// a button that opens the menu above. Options may carry data-hint.

const _dd = new WeakMap();

function syncDropdown(sel) {
  let btn = _dd.get(sel);
  if (!btn || !btn.isConnected) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dd';
    btn.setAttribute('aria-haspopup', 'menu');
    btn.innerHTML = '<span class="dd-label"></span><svg class="dd-caret" width="8" height="5" viewBox="0 0 8 5" aria-hidden="true"><path d="M.75.75 4 4 7.25.75" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    btn._sel = sel;
    sel.after(btn);
    sel.hidden = true;
    sel.tabIndex = -1;
    _dd.set(sel, btn);
  }
  const o = sel.selectedOptions[0];
  const text = o ? o.textContent : '–';
  const label = btn.firstChild;
  if (label.textContent !== text) label.textContent = text;
  btn.classList.toggle('missing', !!o?.classList.contains('missing'));
  btn.disabled = sel.disabled;
  for (const a of ['title', 'aria-label']) {
    const v = sel.getAttribute(a);
    if (v !== btn.getAttribute(a)) v == null ? btn.removeAttribute(a) : btn.setAttribute(a, v);
  }
}

/** Create or update the button of every <select> under `root`. */
export function syncDropdowns(root = document) {
  root.querySelectorAll('select').forEach(syncDropdown);
}

function choose(sel, value) {
  if (sel.value !== value) {
    sel.value = value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  syncDropdown(sel);
}

function openDropdown(btn) {
  const sel = btn._sel;
  const items = [];
  let group = null;
  for (const o of sel.options) {
    const g = o.parentElement.tagName === 'OPTGROUP' ? o.parentElement.label : null;
    if (g && g !== group) items.push({ heading: g });
    group = g;
    items.push({
      label: o.textContent, hint: o.dataset.hint || '', checked: o.selected, disabled: o.disabled,
      onClick: () => { choose(sel, o.value); btn.focus(); },
    });
  }
  openMenu(btn, items, { search: sel.options.length > 12, cls: 'dd-menu', onClose: () => { if (!document.activeElement || document.activeElement === document.body) btn.focus(); } });
}

/** Turn selects into dropdown buttons now and whenever the page changes. */
export function initDropdowns() {
  syncDropdowns();
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; syncDropdowns(); });
  }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('change', e => { if (e.target.tagName === 'SELECT') syncDropdown(e.target); });
  document.addEventListener('click', e => {
    const btn = e.target.closest?.('button.dd');
    if (!btn) return;
    openDropdown(btn);
  });
  document.addEventListener('keydown', e => {
    const btn = e.target.closest?.('button.dd');
    if (!btn || e.ctrlKey || e.metaKey) return;
    const sel = btn._sel;
    const opts = [...sel.options].filter(o => !o.disabled);
    const at = opts.findIndex(o => o.selected);
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.altKey) {
      e.preventDefault();
      const next = opts[Math.max(0, Math.min(opts.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) choose(sel, next.value);
    } else if (e.key === 'ArrowDown' && e.altKey) {
      e.preventDefault();
      openDropdown(btn);
    } else if (e.key.length === 1 && /\S/.test(e.key) && !e.altKey) {
      // type a letter to pick the next option that starts with it
      const k = e.key.toLowerCase();
      const order = [...opts.slice(at + 1), ...opts.slice(0, at + 1)];
      const hit = order.find(o => o.textContent.trim().toLowerCase().startsWith(k));
      if (hit) { e.preventDefault(); choose(sel, hit.value); }
    }
  });
}

// ─── Modals ──────────────────────────────────────────────────────────────────

export function showModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  closePopover();
  m.hidden = false;
  const focus = m.querySelector('[autofocus], input:not([type=hidden]):not([type=checkbox]), button.primary');
  focus?.focus();
}

export function hideModal(id) {
  const m = document.getElementById(id);
  if (m) m.hidden = true;
}

export function anyModalOpen() {
  return !!document.querySelector('.modal:not([hidden])');
}

/** Wire backdrop click, [data-close] buttons and Escape for every .modal. */
export function initModals() {
  document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('mousedown', e => { if (e.target === m) m.hidden = true; });
    m.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { m.hidden = true; }));
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const open = [...document.querySelectorAll('.modal:not([hidden])')].pop();
    if (open) { open.hidden = true; e.stopPropagation(); }
  });
}
