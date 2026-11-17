// Données fictives pour l'aperçu local /demo (voir preview-server.mjs). Jamais chargé par l'appli ni l'extension.
// La page se croit dans l'extension : `chrome` est simulé et `fetch` répond à la place des portails.
(() => {
  const anonymous = new URLSearchParams(location.search).has('anon');
  const HOUR = 3600e3;

  window.chrome = {
    runtime: { id: 'demo' },
    storage: { local: { get: async () => ({}), set: async () => {} } },
    tabs: {
      create: async ({ url }) => (alert(`L'extension ouvrirait ici :\n${url}`), { id: 1 }),
      getCurrent: async () => null,
      update: async () => {},
      remove: async () => {},
      onUpdated: { addListener() {} },
      onRemoved: { addListener() {} },
    },
  };

  // ------------------------------------------------------------------ ADE
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = (d) =>
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;

  const SLOTS = [
    [8.25, 10.25],
    [10.5, 12.5],
    [13.75, 15.75],
    [16, 18],
  ];
  const COURSES = [
    ['CM', 'A4-1-ISI-2', 'Aide à la décision', 'B101', 'DURAND Alice', ''],
    ['TD', 'A4-1-ISI-2', 'Aide à la décision', 'B106', 'DURAND Alice', ''],
    ['TD', 'A4-1-ISI-1', 'Architecture fonctionnelle et technique des SIS', 'B107', '', 'Intervenant : Marc Petit'],
    ['CM', 'A4-1-SES-4', 'Système décisionnel de santé', 'B105', 'MARTIN Chloé', ''],
    ['TD', 'A4-1-LSS-1', 'Anglais', 'B106', 'SMITH John', ''],
    ['TP', 'A4-1-ISI-3', 'Développement mobile', 'B102', 'BERNARD Luc', ''],
    ['TD', 'A4-1-SES-1', 'Epidémiologie et santé des données', '', 'ROUX Emma', ''],
    ['CM', 'A4-1-SES-3', 'Sciences médicales', 'B007', 'LEROY Paul', 'Examen'],
  ];

  function ical() {
    const now = new Date();
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)));
    const out = ['BEGIN:VCALENDAR', 'VERSION:2.0'];
    const add = (start, end, summary, room, description) =>
      out.push('BEGIN:VEVENT', `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `SUMMARY:${summary}`, `LOCATION:${room}`, `DESCRIPTION:${description}`, `UID:${stamp(start)}${summary}`, 'END:VEVENT');
    let n = 0;
    for (const week of [0, 1, 4, 5]) {
      for (let day = 0; day < 5; day++) {
        const base = monday.getTime() + (week * 7 + day) * 24 * HOUR - HOUR; // UTC+1
        if (week === 1 && day > 2) {
          add(new Date(base + 8 * HOUR), new Date(base + 12 * HOUR), 'Université de la E-SANTE', '', '\\n\\nPrésence Obligatoire\\nISIS-FIA4-SEMESTRE7\\n');
          continue;
        }
        SLOTS.slice(0, day === 4 ? 2 : 4).forEach(([from, to]) => {
          const [kind, code, title, room, teacher, note] = COURSES[n++ % COURSES.length];
          const summary = `${kind}-${code} ${title}`;
          const short = code.split('-').slice(2).join('-');
          add(new Date(base + from * HOUR), new Date(base + to * HOUR), summary, room && `ISIS - ${room}`, `\\n${short} ${title}\\n${note}\\n${summary}\\n${teacher}\\n(Exporté le:01/01/2026 00:00)\\n`);
        });
      }
    }
    return [...out, 'END:VCALENDAR'].join('\r\n');
  }

  // --------------------------------------------------------------- Moodle
  const course = (id, code, title, category = 'ISIS-FIA4-SEMESTRE7') => ({
    id,
    fullname: `${code} - ${title}`,
    shortname: `${code} - ${title}`,
    idnumber: code,
    coursecategory: category,
  });
  const ENROLLED = [
    { id: 1, fullname: 'Apprentissage à ISIS', shortname: 'Suivi-alternance', idnumber: '', coursecategory: 'Cycle ingénieur statut apprenti' },
    course(2, 'FIA4-1-ISI-2', 'Aide à la décision'),
    course(3, 'FIA4-1-ISI-3', 'Développement mobile'),
    course(4, 'FIA4-1-SES-1', 'Epidémiologie et santé des données'),
  ];
  const SEARCHABLE = [
    course(5, 'FIA4-1-ISI-1', 'Architecture fonctionnelle et technique des SIS'),
    course(6, 'FIA4-1-LA-1', 'Anglais'), // code différent de celui d'ADE (A4-1-LSS-1) : retrouvé par l'intitulé
  ];

  function moodle(url, init) {
    if (url.pathname.endsWith('/service.php')) {
      const [{ methodname, args }] = JSON.parse(init.body);
      const terms = (args.criteriavalue ?? '').toLowerCase().split(/\s+/);
      const courses = methodname.includes('search')
        ? SEARCHABLE.filter((c) => terms.every((t) => c.fullname.toLowerCase().includes(t))).map((c) => ({ ...c, categoryname: c.coursecategory }))
        : ENROLLED;
      return [{ error: false, data: { courses } }];
    }
    return `<script>M.cfg = {"sesskey":"mock","userId":${anonymous ? 0 : 42}};</script>`;
  }

  // ----------------------------------------------------------------- mail
  const MAILS = [
    ['Scolarité ISIS', 'Planning des soutenances de fin de semestre', 'Bonjour à tous, vous trouverez ci-joint le planning prévisionnel des soutenances…', 0.4, false],
    ['Alice Durand', 'TD Aide à la décision : sujet du projet', 'Le sujet est disponible sur Moodle, rendu attendu pour le vendredi…', 3, false],
    ['Bibliothèque universitaire', 'Rappel : document à rendre', 'Un document emprunté arrive à échéance dans 3 jours.', 26, true],
    ['BDE', 'Soirée de Noël, inscriptions ouvertes', 'Les inscriptions sont ouvertes jusqu’à mercredi, places limitées !', 30, true],
    ['Service des sports', 'Créneaux du second semestre', 'Les inscriptions aux activités sportives ouvriront le…', 52, true],
    ['Relations internationales', 'Mobilité : réunion d’information', 'Une réunion de présentation des mobilités aura lieu en amphi…', 75, true],
    ['Marc Petit', 'Supports du cours d’architecture', 'Bonjour, les supports de la séance de lundi sont en ligne.', 99, true],
    ['DSI', 'Maintenance de la messagerie', 'Une interruption de service est prévue samedi entre 8h et 10h.', 123, true],
    ['Scolarité ISIS', 'Certificats de scolarité', 'Vos certificats sont disponibles depuis votre ENT.', 150, true],
    ['Chloé Martin', 'Re: question sur le TP', 'Oui, vous pouvez rendre le compte-rendu en binôme.', 170, true],
  ];

  function mail(url, init) {
    const path = url.pathname;
    if (path === '/session-infos') {
      return anonymous
        ? { redirected: 'https://auth.univ-jfc.fr/cas/login' }
        : { sid: 'mock', domain: 'mock.internal', userId: 'U', defaultEmail: 'prenom.nom@etud.univ-jfc.fr', formatedName: 'Prénom Nom' };
    }
    if (path.endsWith('/_all')) return [{ uid: 'inbox-uid', value: { fullName: 'INBOX' } }];
    if (path.endsWith('/_sorted')) return MAILS.map((_, i) => 100 - i);
    if (path.endsWith('/_count')) return { total: MAILS.filter((m) => !m[4]).length };
    if (path.endsWith('/_mgetById')) {
      return JSON.parse(init.body)
        .reverse() // l'ordre de réponse n'est pas garanti : le client doit retrier
        .map((id) => {
          const [dn, subject, preview, hoursAgo, seen] = MAILS[100 - id];
          return {
            internalId: id,
            flags: seen ? ['Seen'] : [],
            value: { body: { subject, preview, date: Date.now() - hoursAgo * HOUR, recipients: [{ kind: 'Originator', dn, address: 'expediteur@univ-jfc.fr' }] } },
          };
        });
    }
    throw new Error(`Route de messagerie non simulée : ${path}`);
  }

  // ---------------------------------------------------------------- fetch
  const routes = { 'adecampus.univ-jfc.fr': ical, 'moodle.univ-jfc.fr': moodle, 'mail.univ-jfc.fr': mail };
  const realFetch = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const route = routes[url.hostname];
    if (!route) return realFetch(input, init);
    await new Promise((resolve) => setTimeout(resolve, 250 + Math.random() * 400));
    const body = route(url, init);
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return {
      ok: true,
      status: 200,
      url: body?.redirected ?? url.href,
      text: async () => text,
      json: async () => JSON.parse(text),
    };
  };
})();
