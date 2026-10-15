// DustRacing2D .trk parser. Regex-based so it runs in Node tests and the browser alike;
// the format is one element per line with plain attributes (see data/levels/*.trk).
export const TILE_UNITS = 256;
export const METERS_PER_UNIT = 0.05; // DustRacing2D scene.cpp:80

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/(\w+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

function num(a, key, where) {
  const raw = a[key];
  if (raw === undefined) throw new Error(`trk: ${where} missing numeric "${key}"`);
  const v = raw.trim() === '' ? NaN : Number(raw);
  if (!Number.isFinite(v)) throw new Error(`trk: ${where} invalid numeric "${key}"`);
  return v;
}

// Optional attribute: absent means fallback; present must be a finite number.
function optNum(a, key, where, fallback) {
  return a[key] === undefined ? fallback : num(a, key, where);
}

export function parseTrk(xmlText) {
  const header = xmlText.match(/<track\b[^>]*>/);
  if (!header) throw new Error('trk: no <track> element');
  const h = attrs(header[0]);
  const cols = Number(h.cols), rows = Number(h.rows);
  if (!(cols > 0 && rows > 0)) throw new Error('trk: invalid cols/rows');

  const tiles = [...xmlText.matchAll(/<t\b[^>]*\/>/g)].map((m) => {
    const a = attrs(m[0]);
    return { i: num(a, 'i', 'tile'), j: num(a, 'j', 'tile'), o: num(a, 'o', 'tile'), type: a.t ?? 'unknown' };
  });
  if (tiles.length !== cols * rows) throw new Error(`trk: expected ${cols * rows} tiles, found ${tiles.length}`);
  for (const t of tiles) {
    if (!(t.i >= 0 && t.i < cols && t.j >= 0 && t.j < rows)) throw new Error(`trk: tile (${t.i},${t.j}) out of range`);
  }
  const objects = [...xmlText.matchAll(/<o\b[^>]*\/>/g)].map((m) => {
    const a = attrs(m[0]);
    return { role: a.r ?? a.role ?? 'unknown', x: num(a, 'x', 'object'), y: num(a, 'y', 'object'), o: optNum(a, 'o', 'object', 0) };
  });
  const nodes = [...xmlText.matchAll(/<n\b[^>]*\/>/g)]
    .map((m) => {
      const a = attrs(m[0]);
      return { index: num(a, 'i', 'node'), x: num(a, 'x', 'node'), y: num(a, 'y', 'node'), w: optNum(a, 'w', 'node', 0), h: optNum(a, 'h', 'node', 0) };
    })
    .sort((a, b) => a.index - b.index);
  if (nodes.length === 0) throw new Error('trk: no route nodes');

  return { name: h.name ?? 'unnamed', cols, rows, tiles, nodes, objects };
}

export function tileToWorld(tile, rows) {
  return { x: tile.i * TILE_UNITS + TILE_UNITS / 2, y: (rows - 1 - tile.j) * TILE_UNITS + TILE_UNITS / 2 };
}

export function nodeToWorld(node, rows) {
  return { x: node.x, y: rows * TILE_UNITS - node.y };
}

export function worldToScene(p) {
  return { x: p.x * METERS_PER_UNIT, z: -p.y * METERS_PER_UNIT };
}
