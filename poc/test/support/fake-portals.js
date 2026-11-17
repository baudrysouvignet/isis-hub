// Faux portails pour les tests : CAS, Moodle et messagerie réduits à leurs redirections et cookies,
// tels qu'observés sur les vrais. `raw` a la même forme que la requête chiffrée de l'appli web.
const html = (status, body, setCookies = []) => ({ status, setCookies, location: undefined, text: async () => body });
const redirect = (status, location, setCookies = []) => ({ status, location, setCookies, text: async () => '' });
const json = (value, status = 200) => html(status, JSON.stringify(value));

const cookiesOf = (init) =>
  Object.fromEntries((init.headers?.Cookie ?? '').split('; ').filter(Boolean).map((c) => c.split(/=(.*)/s).slice(0, 2)));

export function createPortals({ username = 'alice', password = 'secret' } = {}) {
  const log = [];
  const tickets = new Map(); // ticket -> service
  const cas = { tgt: null };
  const moodle = { sessions: new Map(), next: 1 };
  const mail = { sessions: new Set() };
  let ticketCount = 0;

  const FORM = '<form id="fm1"><input name="username"/><input name="password"/><input type="hidden" name="execution" value="EXEC-1"/></form>';
  const MOODLE_SERVICE = 'https://moodle.univ-jfc.fr/login/index.php?authCAS=CAS';
  const MAIL_SERVICE = 'https://mail.univ-jfc.fr/auth/cas';

  function casServer(url, init, cookies) {
    const signedIn = cas.tgt !== null && cookies.TGC === cas.tgt;
    if (url.pathname === '/cas/logout') {
      cas.tgt = null;
      return html(200, 'Déconnexion réussie', ['TGC=; Max-Age=0; Path=/cas; Secure; HttpOnly']);
    }
    if (url.pathname !== '/cas/login') return html(404, '');

    if (init.method === 'POST') {
      const form = new URLSearchParams(init.body);
      const ok = form.get('username') === username && form.get('password') === password && form.get('execution') === 'EXEC-1';
      if (!ok) return html(401, FORM, ['TGC=; Max-Age=0; Path=/cas; Secure; HttpOnly']);
      cas.tgt = `TGT-${Math.random().toString(36).slice(2)}`;
      return html(200, 'Connexion réussie', [`TGC=${cas.tgt}; Path=/cas; Secure; HttpOnly`]);
    }

    const service = url.searchParams.get('service');
    if (service && signedIn) {
      const ticket = `ST-${++ticketCount}`;
      tickets.set(ticket, service);
      return redirect(302, `${service}${service.includes('?') ? '&' : '?'}ticket=${ticket}`);
    }
    if (service && url.searchParams.get('gateway')) return redirect(302, service);
    if (signedIn) return html(200, 'Connexion réussie');
    return html(200, FORM, ['org.springframework.web.servlet.i18n.CookieLocaleResolver.LOCALE=fr; Path=/; Secure; HttpOnly']);
  }

  const validate = (ticket, service) => tickets.get(ticket) === service && tickets.delete(ticket);

  function moodleServer(url, init, cookies) {
    const setCookies = [];
    let id = cookies.MoodleSession;
    if (!moodle.sessions.has(id)) {
      id = `m${moodle.next++}`;
      moodle.sessions.set(id, { user: 0, gateway: false });
      setCookies.push(`MoodleSession=${id}; path=/; secure; SameSite=Lax`);
    }
    const session = moodle.sessions.get(id);
    const page = () => html(200, `<script>M.cfg = {"wwwroot":"x","sesskey":"${session.user ? 'SK' : 'anon'}","userId":${session.user}};</script>`, setCookies);

    if (url.pathname === '/my/') return session.user ? page() : redirect(303, 'https://moodle.univ-jfc.fr/login/index.php', setCookies);
    if (url.pathname === '/login/index.php') {
      if (!url.searchParams.has('authCAS')) return page();
      const ticket = url.searchParams.get('ticket');
      if (ticket && validate(ticket, MOODLE_SERVICE)) {
        // Moodle change d'identifiant de session à la connexion.
        moodle.sessions.delete(id);
        const fresh = `m${moodle.next++}`;
        moodle.sessions.set(fresh, { user: 15768, gateway: false });
        return redirect(303, 'https://moodle.univ-jfc.fr/my/', [`MoodleSession=${fresh}; path=/; secure; SameSite=Lax`]);
      }
      if (session.gateway) return page(); // le CAS est revenu sans ticket : on reste sur la page de connexion
      session.gateway = true;
      return redirect(302, `https://auth.univ-jfc.fr/cas/login?service=${encodeURIComponent(MOODLE_SERVICE)}&gateway=true`, setCookies);
    }
    if (url.pathname === '/lib/ajax/service.php') {
      if (!session.user || url.searchParams.get('sesskey') !== 'SK') {
        return json([{ error: true, exception: { errorcode: 'invalidsesskey', message: 'Session échue' } }]);
      }
      const [{ methodname }] = JSON.parse(init.body);
      const courses = methodname.includes('search')
        ? []
        : [{ id: 2125, fullname: 'FIA4-1-ISI-2 - Aide à la décision', shortname: 'FIA4-1-ISI-2', idnumber: 'FIA4-1-ISI-2', coursecategory: 'ISIS-FIA4-SEMESTRE7' }];
      return json([{ error: false, data: { courses } }]);
    }
    return html(404, '');
  }

  function mailServer(url, init, cookies) {
    const signedIn = mail.sessions.has(cookies.BMSID);
    if (url.pathname === '/auth/cas') {
      if (!validate(url.searchParams.get('ticket'), MAIL_SERVICE)) return html(403, '');
      const id = `bm${mail.sessions.size + 1}`;
      mail.sessions.add(id);
      return redirect(302, '/', [`BMSID=${id}; Path=/; Secure; HttpOnly`]);
    }
    if (!signedIn) return redirect(302, `https://auth.univ-jfc.fr/cas/login?service=${encodeURIComponent(MAIL_SERVICE)}`);
    if (url.pathname === '/') return redirect(302, '/webapp/mail/');
    if (url.pathname === '/webapp/mail/') return html(200, '<html>Messagerie</html>');
    if (url.pathname === '/session-infos') {
      return json({ sid: 'SID', domain: 'dom.internal', userId: 'U1', defaultEmail: 'alice@etud.univ-jfc.fr', formatedName: 'Alice Martin' });
    }
    if (url.pathname.startsWith('/api/')) {
      if (init.headers?.['X-BM-ApiKey'] !== 'SID') return html(403, '');
      if (url.pathname === '/api/mail_folders/dom_internal/user.U1/_all') return json([{ uid: 'inbox', value: { fullName: 'INBOX' } }]);
      if (url.pathname.endsWith('/_sorted')) return json([12, 11, 10]);
      if (url.pathname.endsWith('/_count')) return json({ total: 1 });
      if (url.pathname.endsWith('/_mgetById')) {
        return json(
          JSON.parse(init.body).reverse().map((id) => ({
            internalId: id,
            flags: id === 12 ? [] : ['Seen'],
            value: { body: { subject: `Sujet ${id}`, preview: '…', date: id * 1000, recipients: [{ kind: 'Originator', dn: 'Scolarité', address: 's@univ-jfc.fr' }] } },
          })),
        );
      }
    }
    return html(404, '');
  }

  const servers = { 'auth.univ-jfc.fr': casServer, 'moodle.univ-jfc.fr': moodleServer, 'mail.univ-jfc.fr': mailServer };

  async function raw(href, init = {}) {
    const url = new URL(href);
    log.push({ method: init.method ?? 'GET', url: href, headers: { ...init.headers }, body: init.body });
    const server = servers[url.hostname];
    if (!server) throw new Error(`hôte inconnu du test : ${url.hostname}`);
    return server(url, { method: 'GET', ...init }, cookiesOf(init));
  }

  return { raw, log, cas };
}
