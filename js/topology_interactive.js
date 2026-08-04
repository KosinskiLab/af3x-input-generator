/**
 * Interactive topology modal — zoomable, pannable, chain-draggable arc diagram.
 *
 * Controls
 * --------
 *   Mouse wheel        zoom in/out (centred on cursor)
 *   Drag background    pan
 *   Drag protein bar   move chain vertically to reorder
 *   Reset View         restore default layout
 *   Escape / ✕         close
 */

import { XL_GROUP_COLORS, XL_DASH_PATTERNS } from './data.js';

const NS   = 'http://www.w3.org/2000/svg';
const ML   = 94;   // left margin  (room for chain labels)
const MR   = 62;   // right margin — wide enough for "1234 aa" hint text
const MT   = 80;   // top margin   (room for intra arcs above row 0)
const MB   = 40;   // bottom margin
const BAR_H      = 22;
const STRIDE_DEF = 100;  // default row spacing (centre to centre)
const MAX_INTRA  = 58;   // max height of intra-chain arc above bar

// ─── Module state ─────────────────────────────────────────────────────────────

let _chains   = [];
let _xlGroups = [];
let _ssBonds  = [];
let _maxLen   = 1;
let _svgW     = 1200;
let _chainY   = {};   // chain.id → current y (SVG coords)
let _vb       = { x: 0, y: 0, w: 1200, h: 600 };

const _drag   = { type: null };

// ─── Public API ───────────────────────────────────────────────────────────────

export function resetTopologyView() {
  _resetChainPositions();
  _resetVb();
  _draw();
}

export function openInteractiveTopology(chains, xlGroups, ssBonds) {
  _chains   = chains;
  _xlGroups = xlGroups || [];
  _ssBonds  = ssBonds  || [];
  const seqLens = chains.filter(c => c.type !== 'ligand' && c.length).map(c => c.length);
  _maxLen = seqLens.length ? Math.max(...seqLens) : 1;

  _resetChainPositions();
  document.getElementById('topology-modal').style.display = 'flex';

  // Wait for the modal to be laid out before reading dimensions
  requestAnimationFrame(() => {
    const svg = _svg();
    _svgW = svg.getBoundingClientRect().width || 1200;
    _resetVb();
    _draw();
  });
}

export function initInteractiveTopology() {
  const modal = document.getElementById('topology-modal');
  const svg   = _svg();
  if (!modal || !svg) return;

  document.getElementById('topoModalClose')?.addEventListener('click', _close);
  document.getElementById('topoResetView')?.addEventListener('click', () => {
    _resetChainPositions();
    _resetVb();
    _draw();
  });

  modal.addEventListener('keydown', e => { if (e.key === 'Escape') _close(); });
  modal.addEventListener('click',   e => { if (e.target === modal)  _close(); });

  svg.addEventListener('wheel',     _onWheel,     { passive: false });
  svg.addEventListener('mousedown', _onMouseDown);
  window.addEventListener('mousemove', _onMouseMove);
  window.addEventListener('mouseup',   _onMouseUp);

  // Arc tooltip on hover (using shared arc-tooltip div)
  svg.addEventListener('mousemove', _onSvgMouseMove);
  svg.addEventListener('mouseleave', _hideTooltip);
}

// ─── Drawing ──────────────────────────────────────────────────────────────────

function _draw() {
  const svg = _svg();
  if (!svg) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  if (_chains.length === 0) {
    svg.setAttribute('viewBox', '0 0 600 200');
    const t = _el('text');
    _attrs(t, { x: '50%', y: '50%', 'text-anchor': 'middle',
                'dominant-baseline': 'middle', 'font-size': 16,
                'font-family': 'sans-serif', fill: '#9aa0a6' });
    t.textContent = 'Add sequences to see topology';
    svg.appendChild(t);
    return;
  }

  svg.setAttribute('viewBox', `${_vb.x} ${_vb.y} ${_vb.w} ${_vb.h}`);

  _appendDefs(svg);

  const barW = _svgW - ML - MR;
  const displayW = svg.getBoundingClientRect().width || 900;
  const pxPerRes = (barW / _maxLen) * (displayW / _vb.w);
  const tickInt  = _tickInterval(pxPerRes);

  // Per-chain bar widths — proportional to sequence length; ligands get fixed node width
  const chainW = {};
  _chains.forEach(chain => {
    if (chain.type === 'ligand') {
      chainW[chain.id] = BAR_H * 2.4; // fixed small node for ligands
    } else {
      chainW[chain.id] = Math.max(4, ((chain.length || _maxLen) / _maxLen) * barW);
    }
  });

  // Crosslink arcs — drawn before bars so bars appear on top
  _xlGroups.forEach((grp, gi) => {
    grp.pairs.forEach(pair => {
      const color = pair.color || grp.color || XL_GROUP_COLORS[gi % XL_GROUP_COLORS.length];
      _drawArc(svg, pair, color, grp.name, pair.dashArray || 'none', chainW);
    });
  });
  _ssBonds.forEach(pair => _drawArc(svg, pair, '#f0b400', 'S–S', '5 3', chainW));

  // Chain bars
  _chains.forEach(chain => {
    const y     = _chainY[chain.id];
    const color = chain.color;
    const len   = chain.length || null;  // null = unknown length
    const cw    = chainW[chain.id];

    // Residue tick marks — only when sequence length is known
    if (tickInt && len) {
      const g = _el('g');
      g.setAttribute('class', 'topo-ticks');
      for (let r = tickInt; r <= len; r += tickInt) {
        const tx      = ML + ((r - 1) / Math.max(len - 1, 1)) * cw;
        const isMajor = r % (tickInt * (tickInt >= 50 ? 2 : 5)) === 0 || tickInt >= 250;
        const tH      = isMajor ? 9 : 5;

        const tick = _el('line');
        _attrs(tick, { x1: tx, y1: y - 1, x2: tx, y2: y - 1 - tH,
                       stroke: color, 'stroke-width': isMajor ? 1.2 : 0.7,
                       opacity: 0.7 });
        g.appendChild(tick);

        if (isMajor) {
          const lbl = _el('text');
          _attrs(lbl, {
            x: tx, y: y - tH - 3,
            'text-anchor': 'middle',
            'font-size': Math.round(_vb.w / 100),
            fill: color, opacity: 0.9,
          });
          lbl.textContent = r;
          g.appendChild(lbl);
        }
      }
      svg.appendChild(g);
    }

    // Bar / shape — type-specific
    _drawChainShape(svg, chain.type, ML, y, cw, BAR_H, color, chain.id);

    // Chain label with type prefix
    const TYPE_PREFIX = { protein: '▶ ', rna: '― ', dna: '─ ', ligand: '⬡ ' };
    const lbl = _el('text');
    _attrs(lbl, { x: ML - 10, y: y + BAR_H / 2 + 5,
                  'text-anchor': 'end', 'font-size': 14,
                  'font-family': 'monospace', 'font-weight': 700, fill: color });
    lbl.textContent = (TYPE_PREFIX[chain.type] || '') + (chain.label || chain.id);
    svg.appendChild(lbl);

    // Length hint
    if (chain.length) {
      const hint = _el('text');
      _attrs(hint, { x: ML + cw + 8, y: y + BAR_H / 2 + 5,
                     'text-anchor': 'start', 'font-size': 10, fill: '#9aa0a6' });
      const unit = (chain.type === 'rna' || chain.type === 'dna') ? 'nt' : 'aa';
      hint.textContent = chain.type === 'ligand' ? 'ligand' : chain.length + ' ' + unit;
      svg.appendChild(hint);
    }
  });
}

function _drawChainShape(svg, type, x, y, w, h, color, chainId) {
  if (type === 'dna') {
    // Single strand — one rail + downward ticks (distinct from RNA's upward ticks)
    const railH  = Math.max(2, h * 0.18);
    const railY  = y + h * 0.28;
    const rungH  = h * 0.44;
    const nRungs = Math.max(2, Math.round(w / 13));
    const sp     = w / (nRungs + 1);

    const rail = _el('rect');
    _attrs(rail, { x, y: railY, width: w, height: railH, rx: 0,
                   fill: color, opacity: 0.88,
                   class: 'topo-chain-bar', 'data-chainid': chainId || '' });
    svg.appendChild(rail);

    for (let i = 1; i <= nRungs; i++) {
      const rung = _el('rect');
      _attrs(rung, { x: x + i * sp - 1, y: railY + railH,
                     width: 2, height: rungH,
                     fill: color, opacity: 0.7 });
      svg.appendChild(rung);
    }
  } else if (type === 'rna') {
    // Half-ladder (comb) — one rail + upward rungs → single-stranded RNA
    const railH  = Math.max(2, h * 0.18);
    const railY  = y + h * 0.68;
    const rungH  = h * 0.44;
    const nRungs = Math.max(2, Math.round(w / 13));
    const sp     = w / (nRungs + 1);

    const rail = _el('rect');
    _attrs(rail, { x, y: railY, width: w, height: railH, rx: railH / 2,
                   fill: color, opacity: 0.88,
                   class: 'topo-chain-bar', 'data-chainid': chainId || '' });
    svg.appendChild(rail);

    for (let i = 1; i <= nRungs; i++) {
      const rung = _el('rect');
      _attrs(rung, { x: x + i * sp - 1, y: railY - rungH,
                     width: 2, height: rungH,
                     fill: color, opacity: 0.7 });
      svg.appendChild(rung);
    }
  } else if (type === 'ligand') {
    const r  = h * 0.72;
    const cx = x + Math.min(w, r * 2);
    const cy = y + h / 2;
    const pts = Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i - Math.PI / 6;
      return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
    }).join(' ');
    const hex = _el('polygon');
    _attrs(hex, { points: pts, fill: color, opacity: 0.88,
                  class: 'topo-chain-bar', 'data-chainid': chainId || '' });
    svg.appendChild(hex);
  } else {
    // Protein: solid rounded rect
    const bar = _el('rect');
    _attrs(bar, { x, y, width: w, height: h, rx: h / 2,
                  fill: color, opacity: 0.88,
                  class: 'topo-chain-bar', 'data-chainid': chainId || '' });
    svg.appendChild(bar);
  }
}

// chainW: map of chain.id → bar pixel width for that chain
function _drawArc(svg, pair, color, xlLabel, dashArray, chainW) {
  if (_chainY[pair.chain1] === undefined || _chainY[pair.chain2] === undefined) return;

  const c1 = _chains.find(c => c.id === pair.chain1);
  const c2 = _chains.find(c => c.id === pair.chain2);
  if (!c1 || !c2) return;

  const x1 = _posX(pair.pos1, c1.length || _maxLen, chainW[pair.chain1]);
  const x2 = _posX(pair.pos2, c2.length || _maxLen, chainW[pair.chain2]);
  const y1 = _chainY[pair.chain1];
  const y2 = _chainY[pair.chain2];

  let pathD;
  if (pair.chain1 === pair.chain2) {
    const dotY = y1 + BAR_H / 2;
    const arcH = Math.min(MAX_INTRA, Math.max(30, Math.abs(x2 - x1) * 0.35));
    pathD = `M ${x1} ${dotY} C ${x1} ${dotY - arcH}, ${x2} ${dotY - arcH}, ${x2} ${dotY}`;
  } else {
    const ay1  = y1 + BAR_H / 2;
    const ay2  = y2 + BAR_H / 2;
    const midY = (ay1 + ay2) / 2;
    const sft  = (x2 - x1) * 0.15;
    pathD = `M ${x1} ${ay1} C ${x1+sft} ${midY}, ${x2-sft} ${midY}, ${x2} ${ay2}`;
  }

  const grp = _el('g');
  grp.setAttribute('class',     'topo-xl-group');
  grp.setAttribute('data-label', `${xlLabel}: ${pair.chain1}:${pair.pos1} ↔ ${pair.chain2}:${pair.pos2}`);

  // Endpoint dots
  [[x1, y1 + BAR_H / 2], [x2, y2 + BAR_H / 2]].forEach(([cx, cy]) => {
    const dot = _el('circle');
    _attrs(dot, { cx, cy, r: 4, fill: color, class: 'topo-dot' });
    grp.appendChild(dot);
  });

  // Arc
  const arc = _el('path');
  _attrs(arc, { d: pathD, fill: 'none', stroke: color, 'stroke-width': 2,
                opacity: 0.75, class: 'topo-arc' });
  if (dashArray && dashArray !== 'none') arc.setAttribute('stroke-dasharray', dashArray);
  grp.appendChild(arc);

  // Invisible wide hit area for easier hover
  const hit = _el('path');
  _attrs(hit, { d: pathD, fill: 'none', stroke: 'transparent', 'stroke-width': 16 });
  grp.appendChild(hit);

  svg.appendChild(grp);
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

function _onSvgMouseMove(e) {
  const grp     = e.target.closest('.topo-xl-group');
  const tooltip = document.getElementById('arc-tooltip');
  if (!tooltip) return;
  if (grp) {
    tooltip.textContent  = grp.getAttribute('data-label') || '';
    tooltip.style.display = 'block';
    tooltip.style.left    = (e.clientX + 16) + 'px';
    tooltip.style.top     = (e.clientY - 32) + 'px';
  } else {
    _hideTooltip();
  }
}

function _hideTooltip() {
  const t = document.getElementById('arc-tooltip');
  if (t) t.style.display = 'none';
}

// ─── Zoom ─────────────────────────────────────────────────────────────────────

function _onWheel(e) {
  e.preventDefault();
  const sv  = _svg();
  const pt  = _toSvg(sv, e.clientX, e.clientY);
  const fac = e.deltaY > 0 ? 1.14 : 1 / 1.14;

  // Keep SVG point under cursor fixed
  const fx = (pt.x - _vb.x) / _vb.w;
  const fy = (pt.y - _vb.y) / _vb.h;
  _vb.w *= fac;
  _vb.h *= fac;
  _vb.x  = pt.x - fx * _vb.w;
  _vb.y  = pt.y - fy * _vb.h;

  _draw();
}

// ─── Pan / Drag chain ────────────────────────────────────────────────────────

function _onMouseDown(e) {
  if (e.button !== 0) return;
  const chainTarget = e.target.closest('[data-chainid]');

  if (chainTarget) {
    const id = chainTarget.getAttribute('data-chainid');
    const pt = _toSvg(_svg(), e.clientX, e.clientY);
    _drag.type       = 'chain';
    _drag.chainId    = id;
    _drag.startSvgY  = pt.y;
    _drag.startChainY = _chainY[id];
    document.body.style.cursor = 'grabbing';
  } else {
    _drag.type      = 'bg';
    _drag.startVbX  = _vb.x;
    _drag.startVbY  = _vb.y;
    _drag.startClX  = e.clientX;
    _drag.startClY  = e.clientY;
    document.body.style.cursor = 'grabbing';
  }
  e.preventDefault();
}

function _onMouseMove(e) {
  if (!_drag.type) return;
  const sv = _svg();

  if (_drag.type === 'chain') {
    const pt = _toSvg(sv, e.clientX, e.clientY);
    _chainY[_drag.chainId] = _drag.startChainY + (pt.y - _drag.startSvgY);
    _draw();
  } else if (_drag.type === 'bg') {
    const rect = sv.getBoundingClientRect();
    const scX  = _vb.w / rect.width;
    const scY  = _vb.h / rect.height;
    _vb.x = _drag.startVbX - (e.clientX - _drag.startClX) * scX;
    _vb.y = _drag.startVbY - (e.clientY - _drag.startClY) * scY;
    _draw();
  }
}

function _onMouseUp() {
  _drag.type = null;
  document.body.style.cursor = '';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _close() {
  document.getElementById('topology-modal').style.display = 'none';
  _hideTooltip();
}

function _resetChainPositions() {
  _chainY = {};
  _chains.forEach((c, i) => { _chainY[c.id] = MT + i * STRIDE_DEF; });
}

function _resetVb() {
  const totalH = MT + _chains.length * STRIDE_DEF + MB;
  _vb = { x: 0, y: 0, w: _svgW, h: Math.max(300, totalH) };
}

function _posX(resNum, chainLen, barW) {
  const frac = Math.min(1, Math.max(0, (resNum - 1) / Math.max(chainLen - 1, 1)));
  return ML + frac * barW;
}

function _tickInterval(pxPerRes) {
  if (pxPerRes > 18) return 5;
  if (pxPerRes > 8)  return 10;
  if (pxPerRes > 3)  return 25;
  if (pxPerRes > 1.2) return 50;
  if (pxPerRes > 0.4) return 100;
  if (pxPerRes > 0.15) return 250;
  return null;
}

function _appendDefs(svg) {
  const defs   = _el('defs');
  const filter = _el('filter');
  _attrs(filter, { id: 'topo-glow', x: '-50%', y: '-50%', width: '200%', height: '200%' });
  const blur = _el('feGaussianBlur');
  _attrs(blur, { in: 'SourceGraphic', stdDeviation: 3, result: 'b' });
  const merge = _el('feMerge');
  ['b', 'SourceGraphic'].forEach(src => {
    const mn = _el('feMergeNode'); mn.setAttribute('in', src); merge.appendChild(mn);
  });
  filter.appendChild(blur); filter.appendChild(merge); defs.appendChild(filter);
  svg.appendChild(defs);
}

function _toSvg(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function _svg() { return document.getElementById('topology-expand-svg'); }

function _el(tag) { return document.createElementNS(NS, tag); }

function _attrs(el, obj) {
  for (const [k, v] of Object.entries(obj)) el.setAttribute(k, v);
}
