// Recadrage d'une photo au format de la carte (4:3) : toute la photo visible par défaut.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cropRect, fitZoom, MAX_ZOOM } from '../web/js/tcg/crop.js';

const near = (a, b) => Math.abs(a - b) < 1e-6;

test('photo verticale de téléphone (3000 × 4000) : toute la photo tient, avec des bords', () => {
  const fit = fitZoom(3000, 4000);
  assert.ok(fit < 1);
  const s = { zoom: fit, cx: 1500, cy: 2000 };
  const r = cropRect(3000, 4000, s);
  assert.ok(near(r.h, 4000) && r.w > 3000, `zone ${r.w} × ${r.h}`);
  assert.ok(near(r.w / r.h, 4 / 3));
  // Glisser n'a pas de sens sur l'axe où la photo est plus petite que le cadre : elle reste centrée.
  const moved = cropRect(3000, 4000, { zoom: fit, cx: 0, cy: 0 });
  assert.ok(near(moved.x + moved.w / 2, 1500) && near(moved.y + moved.h / 2, 2000));
});

test('remplir le cadre (zoom 1) puis zoomer : la zone reste dans la photo', () => {
  const s = { zoom: 1, cx: 0, cy: 0 };
  const r = cropRect(4000, 3000, s);
  assert.ok(near(r.w, 4000) && near(r.h, 3000) && near(r.x, 0) && near(r.y, 0));
  const z = { zoom: 2, cx: 9999, cy: -5 };
  const r2 = cropRect(4000, 3000, z);
  assert.ok(r2.x + r2.w <= 4000 + 1e-6 && r2.y >= -1e-6, 'zone hors de la photo');
});

test('zoom borné entre « toute la photo » et le maximum', () => {
  const s = { zoom: 0.01, cx: 0, cy: 0 };
  cropRect(3000, 4000, s);
  assert.ok(near(s.zoom, fitZoom(3000, 4000)));
  s.zoom = 99;
  cropRect(3000, 4000, s);
  assert.equal(s.zoom, MAX_ZOOM);
  assert.equal(fitZoom(4000, 3000), 1); // déjà en 4:3 : rien à ajuster
});
