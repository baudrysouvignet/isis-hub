# libcurl.js 0.7.5 (copie figée)

curl et mbedTLS compilés en WebAssembly : c'est ce qui chiffre les échanges dans la page.

- Source : https://github.com/ading2210/libcurl.js (licence LGPL-3.0-or-later, voir `LICENSE`)
- Paquet : https://registry.npmjs.org/libcurl.js/-/libcurl.js-0.7.5.tgz
- Intégrité du paquet (npm) : `sha512-O7OizjbbSYvAGFkbat3gwih2PXpI4jKTk25SD2tPJnMsmKTU5UIK7x8exbD9DCBFPkL3FEcqYJAvqlELESBmYA==`

Fichiers copiés tels quels depuis le paquet (SHA-256) :

```
8ff1f9b4e722086308569613acb2817e763f730e53fd7712cf2bb1868f731eaf  libcurl.mjs
6a7d769e903e65d93d0f6103fd4632a11368d3ab1868aa3d0abcef47a117030a  libcurl.wasm
```

Pour vérifier : `npm pack libcurl.js@0.7.5`, extraire, puis `shasum -a 256 package/libcurl.mjs package/libcurl.wasm`.
