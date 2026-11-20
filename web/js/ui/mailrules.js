// Fiche « Règles et étiquettes » (bouton réglages de la tuile Mails).
// Tout reste sur l'appareil : voir core/mailprefs.js.

import { $, h, icon, toast } from '../core/dom.js';
import * as MP from '../core/mailprefs.js';
import { modal } from './layout.js';

export function setupMailRules({ onRuleAdded }) {
  const dialog = $('dialog[data-rules-sheet]');
  const sheet = modal(dialog, { onOpen: render });
  const tagList = $('[data-tag-list]', dialog);
  const ruleList = $('[data-rule-list]', dialog);
  const action = $('[data-rule-action]', dialog);

  const removeBtn = (label, run) =>
    h('button.icon-btn.icon-btn--sm', { type: 'button', title: label, attrs: { 'aria-label': label }, on: { click: run } }, icon('x', 'ic ic--sm'));

  function render() {
    tagList.replaceChildren(
      ...(MP.tags().length
        ? MP.tags().map((t) =>
            h('li', {}, h('span.mtag', { class: `mtag--${t.color}`, text: t.name }), removeBtn(`Supprimer l’étiquette ${t.name}`, () => {
              if (confirm(`Supprimer l’étiquette « ${t.name} » ? Elle sera retirée des mails et des règles qui l’utilisent.`)) MP.removeTag(t.id);
            })),
          )
        : [h('li.cs-none', { text: 'Aucune étiquette.' })]),
    );
    const prev = action.value;
    action.replaceChildren(
      h('option', { value: 'trash', text: 'mettre à la corbeille' }),
      ...MP.tags().map((t) => h('option', { value: `tag:${t.id}`, text: `étiqueter « ${t.name} »` })),
    );
    if ([...action.options].some((o) => o.value === prev)) action.value = prev;
    ruleList.replaceChildren(
      ...(MP.rules().length
        ? MP.rules().map((r) =>
            h(
              'li',
              {},
              h(
                'span.rule-text',
                {},
                `Si ${r.field === 'subject' ? 'l’objet' : 'l’expéditeur'} contient `,
                h('b', { text: `« ${r.text} »` }),
                ' → ',
                r.action === 'tag' ? h('span.mtag', { class: `mtag--${MP.tagById(r.tag)?.color}`, text: MP.tagById(r.tag)?.name ?? '?' }) : h('b', { text: 'corbeille' }),
              ),
              removeBtn('Supprimer la règle', () => MP.removeRule(r.id)),
            ),
          )
        : [h('li.cs-none', { text: 'Aucune règle pour l’instant.' })]),
    );
  }
  MP.onMailPrefs(() => dialog.open && render());

  // Alerte « Nouvelle connexion » de Moodle due à ISIS Hub (core/loginalerts.js).
  const alerts = $('[data-login-alerts]', dialog);
  const syncAlerts = () => (alerts.checked = MP.loginAlertsOn());
  alerts.addEventListener('change', () => MP.setLoginAlerts(alerts.checked));
  MP.onMailPrefs(syncAlerts);
  syncAlerts();

  $('[data-tag-form]', dialog).addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('[data-tag-name]', dialog);
    try {
      if (MP.addTag(input.value)) input.value = '';
    } catch (err) {
      toast(err.message, 'alert');
    }
  });

  $('[data-rule-form]', dialog).addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('[data-rule-text]', dialog);
    const [kind, tag] = action.value.split(':');
    try {
      MP.addRule({ field: $('[data-rule-field]', dialog).value, text: text.value, action: kind, tag });
      text.value = '';
      onRuleAdded?.();
    } catch (err) {
      toast(err.message, 'alert');
    }
  });

  document.querySelectorAll('[data-mail-rules]').forEach((b) => b.addEventListener('click', sheet.open));
  return sheet;
}
