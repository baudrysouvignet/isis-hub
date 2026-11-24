// ISIS · TCG : la messagerie de l'administrateur depuis la page /admin.
//
// La page d'administration est sur le même site que le Hub : elle peut rouvrir la session
// universitaire gardée (chiffrée) sur cet appareil, comme le Hub au démarrage, pour chercher dans
// l'annuaire (suggestions, comme le champ « Cc ») et envoyer les mails d'accord. Elle ne réécrit
// jamais cette session : ce qui change pendant la visite reste en mémoire. Sans connexion au Hub sur
// cet appareil, ni suggestions ni envoi : il faut d'abord se connecter au Hub.

let opening = null;

/** Module mail.js prêt (session du Hub rouverte), ou une erreur claire. */
export function mailBridge() {
  opening ??= (async () => {
    const [{ openVault }, engine, { useTransport }, cas, mail] = await Promise.all([
      import('../net/vault.js'),
      import('../net/engine.js'),
      import('../net/http.js'),
      import('../portals/cas.js'),
      import('../portals/mail.js'),
    ]);
    useTransport(engine.http);
    const vault = await openVault();
    engine.jar.replace(await vault.load());
    if (!cas.hasCasSession(engine.jar)) throw new Error('Connecte-toi d’abord au Hub sur cet appareil.');
    return mail;
  })().catch((err) => {
    opening = null; // nouvel essai au prochain appel (connexion faite entre-temps)
    throw err;
  });
  return opening;
}
