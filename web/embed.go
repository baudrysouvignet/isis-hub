// Package web contient les fichiers de l'appli, intégrés tels quels au binaire.
package web

import "embed"

// Files : tout ce qui est servi. Aucun autre fichier n'est accessible depuis l'extérieur.
//
//go:embed index.html admin.html app.webmanifest assets data js vendor
var Files embed.FS
