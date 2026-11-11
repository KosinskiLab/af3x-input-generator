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
  closePopover();
  const el = document.createElement('div');
  el.className = `popover ${cls}`;
  el.appendChild(content);
  document.body.appendChild(el);
  const isEl = anchor instanceof Element;
  _open = { el, anchor: isEl ? anchor : null, onClose };
  if (isEl) { anchor.classList.add('is-open'); anchor.setAttribute('aria-expanded', 'true'); }

  const r = isEl ? anchor.getBoundingClientRect() : anchor;
  const w = el.offsetWidth, h = el.offsetHeight;
  let left = align === 'right' ? r.right - w : align === 'center' ? r.left + r.width / 2 - w / 2 : r.left;
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
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
  openPopover(anchor, box, { align: opts.align || 'left', cls: `popover-menu ${opts.cls || ''}` });
  if (input) input.focus();
  else { box.tabIndex = -1; box.focus(); }
  return box;
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
