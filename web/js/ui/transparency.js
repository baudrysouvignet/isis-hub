// Écran « Transparence » : ce que fait la page en ce moment, et quatre contrôles exécutés pour de vrai
// dans le navigateur (aucun n'est simulé). Plus la vérification de chaque fichier servi contre
// l'empreinte publiée dans /manifest.json.

import { $, $$, h, icon, sleep, motionOK } from '../core/dom.js';
import { RELAY_URL, stats, probeRelay, probeTls, ready } from '../net/engine.js';
import { PORTAL_HOSTS } from '../portals/config.js';
import { modal, copyButton } from './layout.js';

const kilo = (bytes) => `${Math.round(bytes / 1024).toLocaleString('fr-FR')} Ko`;
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (data) => hex(await crypto.subtle.digest('SHA-256', data));

// ------------------------------------------------------------ contrôles

const CHECKS = {
  /** 1. Toutes les ressources chargées viennent de l'origine de la page. */
  async external() {
    const entries = [...performance.getEntriesByType('navigation'), ...performance.getEntriesByType('resource')];
    const foreign = entries.filter((e) => new URL(e.name, location.href).origin !== location.origin);
    if (foreign.length) return [false, `${foreign.length} ressource(s) d’une autre origine : ${new URL(foreign[0].name).host}.`];
    return [true, `${entries.length} fichiers chargés, tous depuis ${location.host}.`];
  },

  /** 2. La CSP bloque l'exécution de code fabriqué à la volée (base de toute injection). */
  async csp() {
    let ran = false;
    try {
      ran = new Function('return true')(); // eslint-disable-line no-new-func
    } catch {
      ran = false;
    }
    if (ran) return [false, 'Du code fabriqué à la volée a pu s’exécuter : la politique de sécurité est absente.'];
    let inline = true;
    try {
      const s = document.createElement('script');
      s.textContent = 'window.__hubInline = true';
      document.head.append(s);
      s.remove();
      inline = Boolean(window.__hubInline);
    } catch {
      inline = false; // refusé par Trusted Types avant même l'insertion
    }
    if (inline) return [false, 'Un script en ligne a pu s’exécuter.'];
    return [true, 'eval et scripts en ligne refusés par la politique de sécurité de la page.'];
  },

  /** 3. Le relais refuse une destination hors liste. */
  async relay() {
    const code = await probeRelay('example.com');
    if (code === 0x48) return [true, 'example.com demandé au relais : refusé (motif Wisp 0x48, destination interdite).'];
    return [false, `Réponse inattendue du relais pour example.com : ${code}.`];
  },

  /** 4. La page refuse un serveur qui n'a pas le certificat d'auth.univ-jfc.fr. */
  async cert() {
    const fake = await probeTls('auth.univ-jfc.fr', 'moodle.univ-jfc.fr');
    if (fake.ok) return [false, 'Un serveur sans le bon certificat a été accepté.'];
    const real = await probeTls('auth.univ-jfc.fr');
    if (!real.ok) return [false, `Connexion directe à auth.univ-jfc.fr impossible (${real.message ?? real.code}).`];
    return [true, `Trafic détourné vers un autre serveur : refusé (${fake.message ?? `erreur ${fake.code}`}). Connexion directe : acceptée.`];
  },
};

// ------------------------------------------------------- empreintes

let integrity = null;
async function verifyFiles() {
  integrity ??= (async () => {
    const res = await fetch('manifest.json', { cache: 'no-store' });
    const manifest = await res.json();
    const names = Object.keys(manifest.files).sort();
    const results = await Promise.all(
      names.map(async (name) => {
        const body = await (await fetch(name, { cache: 'no-cache' })).arrayBuffer();
        return [name, await sha256(body)];
      }),
    );
    const computed = Object.fromEntries(results);
    const lines = names.map((n) => `${computed[n]}  ${n}\n`).join('');
    const fingerprint = await sha256(new TextEncoder().encode(lines));
    const mismatches = names.filter((n) => computed[n] !== manifest.files[n]);
    return { manifest, computed, fingerprint, mismatches };
  })();
  return integrity;
}

export async function versionLabel() {
  try {
    const m = await (await fetch('manifest.json', { cache: 'no-store' })).json();
    return `v${m.version} · empreinte ${m.fingerprint.slice(0, 4)}…${m.fingerprint.slice(-4)}`;
  } catch {
    return '';
  }
}

// ------------------------------------------------------------ écran

export function setupTransparency({ sessionPlace, syncId = () => null, onErase }) {
  const dialog = $('[data-sheet]');
  let timer = null;

  function facts() {
    $('[data-fact-relay]', dialog).textContent = RELAY_URL;
    const engine = stats.engine;
    const engineEl = $('[data-fact-engine]', dialog);
    if (engine) engineEl.firstChild.textContent = `curl ${engine.curl} + ${engine.ssl}`;
    $('[data-fact-hosts]', dialog).replaceChildren(...[...PORTAL_HOSTS].map((host) => h('span.host', { text: host })));
    $('[data-stat-conn]', dialog).textContent = String(stats.connections);
    $('[data-stat-vol]', dialog).textContent = kilo(stats.sent + stats.received);
    $('[data-stat-hosts]', dialog).textContent = stats.hosts.size
      ? [...stats.hosts].map(([host, n]) => `${host} × ${n}`).join(' · ')
      : 'aucune pour l’instant';
    const id = syncId();
    const idEl = $('[data-keep-id]', dialog);
    idEl.hidden = !id;
    // L'identifiant n'est plus affiché : tiré du mot de passe, il pourrait servir à en tester.
    if (id) idEl.textContent = 'Ta sauvegarde est rangée sous un identifiant anonyme et chiffré : ni ton nom, ni ton identifiant universitaire, ni ton mot de passe n’y figurent.';
    const place = sessionPlace();
    $('[data-fact-session]', dialog).textContent =
      place === 'device'
        ? 'La session (chiffrée) reste sur l’appareil, car « Rester connecté » est coché.'
        : place === 'tab'
          ? 'La session (chiffrée) reste dans cet onglet et disparaît à sa fermeture.'
          : 'La session reste en mémoire seulement (stockage indisponible).';
  }

  async function version() {
    const chip = $('[data-version-chip]', dialog);
    const fp = $('[data-fingerprint]', dialog);
    const status = $('[data-files-status]', dialog);
    const files = $('[data-files]', dialog);
    try {
      const { manifest, computed, fingerprint, mismatches } = await verifyFiles();
      chip.textContent = `v${manifest.version}`;
      fp.textContent = `sha256-${fingerprint}`;
      const same = fingerprint === manifest.fingerprint && !mismatches.length;
      status.replaceChildren(
        icon(same ? 'check' : 'alert', 'ic ic--sm'),
        same
          ? `Les ${Object.keys(computed).length} fichiers reçus correspondent aux empreintes publiées. Compare cette empreinte avec celle du dépôt ou de « isis-hub manifest ».`
          : `${mismatches.length} fichier(s) ne correspondent pas aux empreintes publiées !`,
      );
      status.classList.toggle('is-ok', same);
      const main = ['index.html', 'js/main.js', 'assets/hub.css', 'vendor/libcurl/libcurl.wasm'];
      files.replaceChildren(
        ...main.filter((n) => computed[n]).map((n) => h('div.file-row', {}, h('span', { text: n }), h('code', { text: `${computed[n].slice(0, 8)}…${computed[n].slice(-4)}` }))),
      );
    } catch (error) {
      status.textContent = `Empreintes indisponibles : ${error.message}`;
    }
  }

  const sheet = modal(dialog, {
    onOpen() {
      facts();
      version();
      timer = setInterval(facts, 1000);
    },
    onClose() {
      clearInterval(timer);
    },
  });

  // ---- contrôles
  const verify = $('[data-verify]', dialog);
  const summary = $('[data-check-summary]', dialog);
  function setCheck(li, state, detail) {
    li.classList.remove('is-ok', 'is-fail', 'is-running');
    if (state) li.classList.add(`is-${state}`);
    const box = $('.chk-ic', li);
    if (state === 'ok') box.replaceChildren(icon('check'));
    else if (state === 'fail') box.replaceChildren(icon('x'));
    else if (state === 'running') box.replaceChildren(h('span.spinner'));
    else box.replaceChildren();
    if (detail) $('[data-check-detail]', li).textContent = detail;
    $('[data-check-state]', li).textContent = `Contrôle ${{ ok: 'réussi', fail: 'échoué', running: 'en cours', '': 'en attente' }[state]}`;
  }
  verify.addEventListener('click', async () => {
    verify.disabled = true;
    summary.hidden = true;
    const items = $$('[data-check]', dialog);
    items.forEach((li) => setCheck(li, ''));
    let passed = 0;
    try {
      await ready();
    } catch {}
    for (const li of items) {
      setCheck(li, 'running');
      const started = performance.now();
      let ok;
      let detail;
      try {
        [ok, detail] = await CHECKS[li.dataset.check]();
      } catch (error) {
        [ok, detail] = [false, `Contrôle impossible : ${error.message}`];
      }
      if (motionOK()) await sleep(Math.max(0, 350 - (performance.now() - started)));
      setCheck(li, ok ? 'ok' : 'fail', detail);
      if (ok) passed++;
    }
    summary.className = `chk-summary${passed === items.length ? '' : ' chk-summary--fail'}`;
    summary.replaceChildren(
      icon(passed === items.length ? 'check' : 'alert', 'ic ic--sm'),
      passed === items.length ? `${passed} contrôles réussis · à l’instant` : `${items.length - passed} contrôle(s) en échec sur ${items.length}`,
    );
    summary.hidden = false;
    verify.disabled = false;
    facts();
  });

  const copy = $('[data-copy]', dialog);
  copy.addEventListener('click', () => copyButton(copy, $('[data-fingerprint]', dialog).textContent));

  return sheet;
}
