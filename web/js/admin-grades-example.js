// Exemple de maquette de notes (format accepté par « Importer un JSON »). Une classe :
//   rules      seuils : moyenne minimale d'une UE, note éliminatoire d'une matière
//   semesters  1 à 4 semestres : id (court), label. Chaque étudiant passe au suivant avec
//              « Terminer le semestre » : aucune date de semestre n'est nécessaire.
//     ues        id (« 7.1 »), name, coef
//       matieres   name, coef, code (code ADE, facultatif : lien avec l'emploi du temps)
//         evals      label, coef, date (facultative : sinon prise dans l'emploi du temps par le code)
// Les « id » des matières et des évaluations sont facultatifs : ils sont créés à l'import.
// Plusieurs classes d'un coup : { "FIA4": { …comme ci-dessous… }, "FIE5": { … } }.

export const EXAMPLE = {
  rules: { ue: 10, matiere: 7 },
  semesters: [
    {
      id: 'S7',
      label: 'Semestre 7',
      ues: [
        {
          id: '7.1',
          name: 'Systèmes d’information de santé',
          coef: 6,
          matieres: [
            {
              name: 'Interopérabilité des SI de santé',
              coef: 3,
              code: 'A4-1-ISI-2',
              evals: [
                { label: 'Quiz FHIR', coef: 1, date: '2026-11-05' },
                { label: 'Projet HL7', coef: 2, date: '2026-12-11' },
                { label: 'Examen', coef: 3, date: '2027-01-14' },
              ],
            },
            {
              name: 'Bases de données avancées',
              coef: 3,
              code: 'A4-1-BDA-1',
              evals: [
                { label: 'TD noté', coef: 1 },
                { label: 'Examen', coef: 2, date: '2027-01-12' },
              ],
            },
          ],
        },
        {
          id: '7.2',
          name: 'Gestion, communication et langues',
          coef: 5,
          matieres: [
            { name: 'Anglais professionnel', coef: 2, code: 'A4-1-ANG-2', evals: [{ label: 'Oral', coef: 1 }, { label: 'Écrit', coef: 2, date: '2027-01-08' }] },
            { name: 'Projet tutoré', coef: 3, evals: [{ label: 'Jalon', coef: 1 }, { label: 'Soutenance', coef: 2, date: '2027-01-21' }] },
          ],
        },
      ],
    },
    {
      id: 'S8',
      label: 'Semestre 8',
      ues: [
        {
          id: '8.1',
          name: 'Entreprise',
          coef: 8,
          matieres: [{ name: 'Période en entreprise', coef: 5, evals: [{ label: 'Évaluation du tuteur', coef: 1 }, { label: 'Rapport', coef: 2 }] }],
        },
      ],
    },
  ],
};
