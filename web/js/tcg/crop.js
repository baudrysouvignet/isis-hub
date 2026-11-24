// ISIS · TCG : calcul du recadrage d'une photo au format de la carte (4:3), sans interface
// (testé tel quel sous Node). Voir tcg/create.js pour le recadreur.

const W = 960;
const H = 720;

export const MAX_ZOOM = 4;

/** Zoom où toute la photo tient dans le cadre 4:3 (≤ 1 ; 1 = « remplir le cadre »). */
export function fitZoom(iw, ih) {
  const baseW = iw / ih > W / H ? ih * (W / H) : iw;
  const baseH = baseW * (H / W);
  return Math.min(1, baseW / iw, baseH / ih);
}

/**
 * Zone de la photo montrée dans le cadre : centre (cx, cy) et zoom (1 = la plus grande zone 4:3
 * dans la photo ; moins de 1 = la photo entière, avec des bords). La photo ne quitte jamais le
 * cadre : si elle est plus petite que lui, elle reste centrée sur cet axe.
 */
export function cropRect(iw, ih, s) {
  const baseW = iw / ih > W / H ? ih * (W / H) : iw;
  const baseH = baseW * (H / W);
  s.zoom = Math.min(MAX_ZOOM, Math.max(fitZoom(iw, ih), s.zoom));
  const cw = baseW / s.zoom;
  const ch = baseH / s.zoom;
  const clamp = (v, size, full) => (size >= full ? full / 2 : Math.min(full - size / 2, Math.max(size / 2, v)));
  s.cx = clamp(s.cx, cw, iw);
  s.cy = clamp(s.cy, ch, ih);
  return { x: s.cx - cw / 2, y: s.cy - ch / 2, w: cw, h: ch };
}

