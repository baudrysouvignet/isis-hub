// Le même dossier sert d'extension et de site : on choisit le transport selon l'endroit où la page tourne.
const isExtension = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);

export const platform = (await import(isExtension ? './extension.js' : './web.js')).default;
