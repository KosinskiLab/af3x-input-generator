// Compact arc diagram: chains as bars, crosslinks and disulfides as arcs.

const NS = 'http://www.w3.org/2000/svg';
const LEFT = 34;
const RIGHT = 46;
const BAR_H = 10;
const STRIDE = 40;
const INTRA_MAX = 30;

/**
 * chains:   [{ id, label, length, color, type }]
 * xlGroups: [{ name, color, dashArray, pairs: [{ chain1, pos1, chain2, pos2, color, dashArray }] }]
 * ssBonds:  [{ chain1, pos1, chain2, pos2 }]
 */
export function drawArcDiagram(svg, chains, xlGroups, ssBonds = []) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  if (!chains.length) { svg.setAttribute('height', 0); return; }

  // drawn in design px; the viewBox scales it with the page (root font size / 14)
  const k = parseFloat(getComputedStyle(document.documentElement).fontSize) / 14 || 1;
  const width = (svg.getBoundingClientRect().width || 360) / k;
  const barMax = Math.max(40, width - LEFT - RIGHT);
  const rowOf = new Map(chains.map((c, i) => [c.id, i]));
  const firstId = chains[0].id;
  const allPairs = [...xlGroups.flatMap(g => g.pairs), ...ssBonds];
  const top = allPairs.some(p => p.chain1 === firstId && p.chain2 === firstId) ? INTRA_MAX + 12 : 12;
  const height = top + (chains.length - 1) * STRIDE + BAR_H + 12;
  svg.setAttribute('height', height * k);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const maxLen = Math.max(1, ...chains.map(c => c.length || 0));
  const barW = c => (c.type === 'ligand' ? BAR_H : Math.max(6, ((c.length || maxLen) / maxLen) * barMax));
  const yOf = i => top + i * STRIDE;
  const xOf = (c, pos) => LEFT + Math.min(1, Math.max(0, (pos - 1) / Math.max((c.length || maxLen) - 1, 1))) * barW(c);

  const arcs = el('g');

  chains.forEach((c, i) => {
    const y = yOf(i);
    drawChain(svg, c, LEFT, y, barW(c));
    const label = el('text', { x: LEFT - 8, y: y + BAR_H / 2 + 4, 'text-anchor': 'end', class: 'dg-label' });
    label.textContent = c.label || c.id;
    svg.appendChild(label);
    if (c.length) {
      const len = el('text', { x: LEFT + barW(c) + 6, y: y + BAR_H / 2 + 3.5, class: 'dg-len' });
      len.textContent = c.length;
      svg.appendChild(len);
    }
  });

  const arc = (pair, color, label, dash) => {
    const r1 = rowOf.get(pair.chain1), r2 = rowOf.get(pair.chain2);
    if (r1 === undefined || r2 === undefined) return;
    const c1 = chains[r1], c2 = chains[r2];
    if (c1.type === 'ligand' || c2.type === 'ligand') return;
    const x1 = xOf(c1, pair.pos1), x2 = xOf(c2, pair.pos2);
    const y1 = yOf(r1) + BAR_H / 2, y2 = yOf(r2) + BAR_H / 2;
    let d;
    if (r1 === r2) {
      const h = Math.min(INTRA_MAX, Math.max(12, Math.abs(x2 - x1) * 0.4));
      d = `M ${x1} ${y1} C ${x1} ${y1 - h * 1.3}, ${x2} ${y1 - h * 1.3}, ${x2} ${y1}`;
    } else {
      const mid = (y1 + y2) / 2;
      d = `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
    }
    const g = el('g', {
      class: 'xl-arc-group',
      'data-key': `${pair.chain1}:${pair.pos1}:${pair.chain2}:${pair.pos2}`,
      'data-label': `${label}: ${pair.chain1}:${pair.pos1} – ${pair.chain2}:${pair.pos2}`,
    });
    const path = el('path', { d, fill: 'none', stroke: color, 'stroke-width': 1.6, class: 'xl-arc' });
    if (dash && dash !== 'none') path.setAttribute('stroke-dasharray', dash);
    g.appendChild(path);
    g.appendChild(el('circle', { cx: x1, cy: y1, r: 2.6, fill: color, class: 'xl-dot' }));
    g.appendChild(el('circle', { cx: x2, cy: y2, r: 2.6, fill: color, class: 'xl-dot' }));
    g.appendChild(el('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': 10 }));
    arcs.appendChild(g);
  };

  xlGroups.forEach(grp => grp.pairs.forEach(p => arc(p, p.color || grp.color, grp.name, p.dashArray || grp.dashArray)));
  const ssColor = getComputedStyle(document.documentElement).getPropertyValue('--ss').trim() || '#888';
  ssBonds.forEach(p => arc(p, ssColor, 'S–S', '4 3'));
  // arcs sit above the bars so the end points stay visible
  svg.appendChild(arcs);
}

function drawChain(svg, c, x, y, w) {
  if (c.type === 'ligand') {
    const r = BAR_H * 0.62, cx = x + r, cy = y + BAR_H / 2;
    const pts = Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i - Math.PI / 6;
      return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
    }).join(' ');
    svg.appendChild(el('polygon', { points: pts, fill: c.color }));
    return;
  }
  if (c.type === 'protein') {
    const bar = el('rect', { x, y, width: w, height: BAR_H, rx: BAR_H / 2, fill: c.color, 'fill-opacity': c.length ? 0.75 : 0.3 });
    svg.appendChild(bar);
    return;
  }
  // nucleic acid: a rail with ticks (RNA up, DNA down)
  const up = c.type === 'rna';
  const railY = up ? y + BAR_H - 3 : y;
  svg.appendChild(el('rect', { x, y: railY, width: w, height: 3, rx: 1.5, fill: c.color, 'fill-opacity': c.length ? 1 : 0.25 }));
  const n = Math.max(2, Math.round(w / 9));
  for (let i = 1; i <= n; i++) {
    svg.appendChild(el('rect', {
      x: x + (i * w) / (n + 1) - 0.75, y: up ? y : railY + 3, width: 1.5, height: BAR_H - 3, fill: c.color, 'fill-opacity': 0.65,
    }));
  }
}

function el(tag, attrs = {}) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}
