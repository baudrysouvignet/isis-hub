// ISIS · TCG : les cartes face aux captures d'écran, au mieux de ce qu'un site peut faire.
//
// Ce qu'aucun site ne peut faire : empêcher la capture d'écran d'un téléphone (boutons de l'iPhone
// ou d'Android), ni dans le navigateur, ni dans l'appli installée sur l'écran d'accueil. Aucune
// interface ne le permet à une page web, et le système ne la prévient même pas.
//
// Ce que fait le jeu :
//  - les photos et les textes des cartes se floutent dès que la page n'est plus au premier plan
//    (changement d'appli et aperçu des applis ouvertes, volet d'Android et sa tuile « Capture
//    d'écran », outil Capture de Windows, autre fenêtre), et le restent un instant au retour ;
//  - sur ordinateur, elles se floutent dès que les touches des raccourcis de capture sont
//    enfoncées (⌘ ⇧ 3/4/5 sur Mac, ⊞ ⇧ S sur Windows, Ctrl ⇧ sur ChromeOS), avant la capture,
//    et après la touche Impr. écran ; elles reviennent au premier geste de la souris ;
//  - pas d'« Enregistrer l'image » (appui long, clic droit, glisser-déposer), pas d'impression.
// Partout où une carte ou une photo du jeu s'affiche : collection, « Mes apparitions » (accord des
// personnes sur la photo), jury « Tu préfères ? », ouverture d'un booster, fiches des cartes.
// Rien n'est envoyé au serveur, et rien n'est affiché : une capture repérée n'est ni comptée, ni
// signalée, ni commentée ; les cartes se floutent, c'est tout.

const CLASS = 'tcg-veil';
const PHOTO = '.tc, .tcg img, .tsh img, .op img'; // cartes, photos du jeu, ouverture d'un booster

export function shield() {
  const root = document.documentElement;
  const touch = matchMedia('(pointer: coarse)').matches;
  let timer = 0;
  let focused = document.hasFocus();
  let held = false; // touches d'un raccourci de capture enfoncées
  let sticky = false; // voile gardé jusqu'au prochain geste sur la page
  let since = 0;

  const veil = () => {
    clearTimeout(timer);
    root.classList.add(CLASS); // tout de suite, sans transition (tcg.css)
    since = performance.now();
  };
  const unveil = (delay) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (held || sticky || !focused || document.visibilityState !== 'visible') return;
      root.classList.remove(CLASS);
    }, delay);
  };
  // Retour sur la page : sur téléphone, assez tard pour qu'une capture lancée depuis le volet
  // d'Android (qui se referme d'abord) tombe encore sur les cartes floutées.
  const back = () => unveil(touch ? 1100 : 350);

  document.addEventListener('visibilitychange', () => (document.visibilityState === 'visible' ? back() : veil()));
  window.addEventListener('blur', () => {
    focused = false;
    veil();
  });
  window.addEventListener('focus', () => {
    focused = true;
    back();
  });
  window.addEventListener('pagehide', veil);
  window.addEventListener('pageshow', back);

  const shortcut = (e) => Boolean(e.shiftKey && (e.metaKey || e.ctrlKey));
  window.addEventListener(
    'keydown',
    (e) => {
      const mod = ['Meta', 'OS', 'Shift', 'Control'].includes(e.key);
      if (shortcut(e) || (mod && (e.key === 'Shift' ? e.metaKey || e.ctrlKey : e.shiftKey))) {
        held = sticky = true;
        veil();
      } else if (sticky && !mod && e.key !== 'Alt') {
        held = sticky = false;
        back();
      }
    },
    true,
  );
  window.addEventListener(
    'keyup',
    (e) => {
      if (e.key === 'PrintScreen' || e.key === 'Snapshot') {
        sticky = true;
        veil();
        return;
      }
      if (held && !shortcut(e)) held = false;
    },
    true,
  );
  // Le voile d'un raccourci reste jusqu'au premier geste sur la page : l'outil de capture du
  // système recouvre l'écran, la page ne reçoit rien tant qu'il est ouvert. Le geste dit aussi
  // quelles touches sont encore enfoncées (un relâchement peut ne jamais arriver à la page).
  const gesture = (e) => {
    held = shortcut(e);
    if (!focused && e.type === 'pointerdown') focused = true;
    if (held || performance.now() - since < 600) return;
    if (sticky || (root.classList.contains(CLASS) && focused)) {
      sticky = false;
      back();
    }
  };
  window.addEventListener('pointermove', gesture, { passive: true });
  window.addEventListener('pointerdown', gesture, { passive: true });

  // Ni menu « Enregistrer l'image », ni glisser-déposer d'une photo de carte.
  const onPhoto = (e) => e.target instanceof Element && e.target.closest(PHOTO);
  document.addEventListener('contextmenu', (e) => onPhoto(e) && e.preventDefault(), true);
  document.addEventListener('dragstart', (e) => onPhoto(e) && e.preventDefault(), true);
  window.addEventListener('beforeprint', veil);
  window.addEventListener('afterprint', back);

  if (!focused || document.visibilityState !== 'visible') veil();
}
