// Messagerie ou Moodle en panne (maintenance, HTTP 502) : ce n'est pas une session expirée.
// Avant, la page d'erreur de BlueMind valait « Session expirée » : tout était effacé, en boucle
// après chaque reconnexion (Face ID). « Session expirée » exige maintenant l'avis du CAS.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { useTransport } from '../web/js/net/http.js';
import { HOSTS, NotSignedIn, PortalDown } from '../web/js/portals/config.js';
import { forgetCasCheck } from '../web/js/portals/cas.js';
import * as mail from '../web/js/portals/mail.js';
import * as moodle from '../web/js/portals/moodle.js';

const res = (url, status, body, extra = {}) => ({
  status, ok: status >= 200 && status < 300, url, redirected: false,
  text: async () => body, json: async () => JSON.parse(body), ...extra,
});
const casForm = (url) => res(url, 200, '<form><input type="hidden" name="execution" value="e1"/></form>');
const fresh = () => {
  forgetCasCheck();
  mail.reset();
  moodle.reset();
};

/** Transport : `portal(url)` répond pour les portails ; le CAS dit si la session est valable. */
function serve(casAlive, portal) {
  const seen = [];
  useTransport(async (url, init = {}) => {
    seen.push(url);
    if (url.startsWith(`${HOSTS.cas}/cas/login`) && init.redirect === 'manual') {
      return casAlive ? res(url, 302, '', { location: 'https://ent.univ-jfc.fr/uPortal/Login?ticket=ST-1-abc' }) : casForm(url);
    }
    return portal(url, init);
  });
  return seen;
}

test('messagerie en HTTP 502 : « indisponible », jamais « session expirée »', async () => {
  fresh();
  serve(true, (url) => res(url, 502, '<!DOCTYPE html><title>Welcome to BlueMind</title>'));
  await assert.rejects(mail.connect(), (e) => e instanceof PortalDown && !(e instanceof NotSignedIn));
});

test('messagerie renvoyée au CAS : session expirée seulement si le CAS le confirme', async () => {
  fresh();
  serve(false, (url) => casForm(`${HOSTS.cas}/cas/login?service=x`));
  await assert.rejects(mail.connect(), NotSignedIn);
  fresh();
  serve(true, (url) => casForm(`${HOSTS.cas}/cas/login?service=x`));
  await assert.rejects(mail.connect(), PortalDown, 'CAS encore valable : la messagerie va mal, la session est bonne');
});

test('Moodle en maintenance : « indisponible » ; sans session CAS : « session expirée »', async () => {
  fresh();
  serve(true, (url) => res(url, 503, '<html>Maintenance</html>'));
  await assert.rejects(moodle.connect(), PortalDown);
  fresh();
  serve(true, (url) => res(url, 200, '<html>Site en maintenance</html>'));
  await assert.rejects(moodle.connect(), PortalDown, 'page sans session alors que le CAS est valable');
  fresh();
  serve(false, (url) => res(url, 200, '<html>Se connecter sur le site</html>'));
  await assert.rejects(moodle.connect(), NotSignedIn);
});

test('CAS : seul « session valable » est gardé, un « non » est redemandé', async () => {
  fresh();
  const seen = serve(false, (url) => casForm(`${HOSTS.cas}/cas/login?service=x`));
  await assert.rejects(mail.connect(), NotSignedIn);
  await assert.rejects(mail.connect(), NotSignedIn);
  assert.equal(seen.filter((u) => u.startsWith(`${HOSTS.cas}/cas/login?service=`)).length, 2);
});
