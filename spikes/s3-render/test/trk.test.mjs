import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTrk, tileToWorld, nodeToWorld, worldToScene } from '../src/trk.mjs';

const MINI = `<?xml version='1.0' encoding='UTF-8'?>
<track version="1.6.3" cols="2" rows="2" index="0" name="Mini">
 <t i="0" j="0" o="0" t="grass"/>
 <t i="1" j="0" o="90" t="straight"/>
 <t i="0" j="1" o="180" t="corner90"/>
 <t i="1" j="1" o="270" t="finish"/>
 <o x="100" y="200" o="45" r="tree" c="free"/>
 <n w="256" x="384" y="128" h="256" i="0"/>
 <n w="256" x="128" y="384" h="256" i="1"/>
</track>`;

test('parses header, tiles, objects and nodes', () => {
  const t = parseTrk(MINI);
  assert.equal(t.name, 'Mini');
  assert.equal(t.cols, 2);
  assert.equal(t.rows, 2);
  assert.equal(t.tiles.length, 4);
  assert.deepEqual(t.tiles[1], { i: 1, j: 0, o: 90, type: 'straight' });
  assert.deepEqual(t.objects[0], { role: 'tree', x: 100, y: 200, o: 45 });
  assert.deepEqual(t.nodes.map((n) => n.index), [0, 1]);
});

test('nodes are sorted by index even if file order differs', () => {
  const swapped = MINI.replace(/(<n [^>]*i="0"\/>)\s*(<n [^>]*i="1"\/>)/, '$2\n $1');
  assert.deepEqual(parseTrk(swapped).nodes.map((n) => n.index), [0, 1]);
});

test('tileToWorld flips j into y-up world units', () => {
  assert.deepEqual(tileToWorld({ i: 0, j: 0 }, 2), { x: 128, y: 384 });
  assert.deepEqual(tileToWorld({ i: 1, j: 1 }, 2), { x: 384, y: 128 });
});

test('nodeToWorld flips y against map height', () => {
  assert.deepEqual(nodeToWorld({ x: 384, y: 128 }, 2), { x: 384, y: 384 });
});

test('worldToScene converts to metres with z = -y', () => {
  assert.deepEqual(worldToScene({ x: 256, y: 512 }), { x: 12.8, z: -25.6 });
});

test('throws on missing track element', () => {
  assert.throws(() => parseTrk('<foo/>'), /trk: no <track> element/);
});

test('throws on track without route nodes', () => {
  assert.throws(() => parseTrk(MINI.replace(/<n [^>]*\/>/g, '')), /trk: no route nodes/);
});

test('throws on zero cols/rows', () => {
  assert.throws(() => parseTrk(MINI.replace('cols="2"', 'cols="0"')), /trk: invalid cols\/rows/);
});

test('parses real Monza: 35x19, 665 tiles, has route', () => {
  const xml = readFileSync(new URL('../../../DustRacing2D/data/levels/monza.trk', import.meta.url), 'utf8');
  const t = parseTrk(xml);
  assert.equal(t.name, 'Monza');
  assert.equal(t.cols, 35);
  assert.equal(t.rows, 19);
  assert.equal(t.tiles.length, 35 * 19);
  assert.ok(t.nodes.length > 10);
  assert.equal(t.objects.length, 606);
  assert.equal(t.objects[0].role, 'tree');
});

test('throws when the tile count does not match cols*rows', () => {
  const missing = MINI.replace('<t i="0" j="0" o="0" t="grass"/>', '');
  assert.throws(() => parseTrk(missing), /expected 4 tiles, found 3/);
});

test('throws on a tile outside the cols/rows grid', () => {
  assert.throws(() => parseTrk(MINI.replace('<t i="1" j="0"', '<t i="5" j="0"')), /trk: tile \(5,0\) out of range/);
});

test('throws on a non-numeric tile index', () => {
  assert.throws(() => parseTrk(MINI.replace('<t i="0" j="0"', '<t i="" j="0"')), /invalid numeric "i"/);
});

test('throws on a non-numeric object orientation', () => {
  assert.throws(() => parseTrk(MINI.replace('o="45"', 'o="abc"')), /invalid numeric "o"/);
});

test('throws on empty or non-numeric node width', () => {
  assert.throws(() => parseTrk(MINI.replace('w="256" x="384"', 'w="" x="384"')), /invalid numeric "w"/);
  assert.throws(() => parseTrk(MINI.replace('w="256" x="384"', 'w="x" x="384"')), /invalid numeric "w"/);
});

test('absent optional object orientation and node w/h default to 0', () => {
  const bare = MINI.replace(' o="45"', '').replace(' w="256"', '').replace(' h="256"', '');
  const t = parseTrk(bare);
  assert.equal(t.objects[0].o, 0);
  assert.equal(t.nodes[0].w, 0);
  assert.equal(t.nodes[0].h, 0);
});
