# ISIS Hub : un seul binaire Go (seule dépendance : golang.org/x/text, intégrée dans vendor/) qui sert l'appli et le relais aveugle.
# Les tests du serveur tournent pendant la construction : une image ne sort que s'ils passent.

# Construction sur la machine qui construit (tests natifs), compilation croisée vers la cible.
# Go maintenu (correctifs de sécurité), image épinglée par empreinte : la même à chaque construction.
# Mise à jour : docker buildx imagetools inspect golang:1.27-alpine (nouvelle empreinte).
FROM --platform=$BUILDPLATFORM golang:1.27-alpine@sha256:70bd7ddea8b6cbe5d6943cde279d6b67feb10cc924fb9100d1d8757c1575b280 AS build
ARG TARGETOS TARGETARCH
WORKDIR /src
COPY go.mod go.sum ./
COPY vendor ./vendor
COPY cmd ./cmd
COPY internal ./internal
COPY web ./web
COPY test/fixtures/calendars ./test/fixtures/calendars
ARG VERSION=1.1.4
ENV CGO_ENABLED=0
RUN go vet -mod=vendor ./... && go test -mod=vendor ./... \
 && GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} go build -mod=vendor -trimpath -ldflags "-s -w -X main.Version=${VERSION}" -o /out/isis-hub ./cmd/isis-hub \
 && go run -mod=vendor ./cmd/isis-hub manifest | tail -1 \
 && mkdir -p /out/data

# Image finale : le binaire, rien d'autre (ni shell, ni gestionnaire de paquets).
FROM scratch
COPY --from=build /out/isis-hub /isis-hub
# Certificats racines : le serveur lit lui-même l'export public d'ADE pour les calendriers filtrés.
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
# Dossier des retours (seule donnée conservée), monté sur un volume en production.
COPY --from=build --chown=65532:65532 /out/data /data
USER 65532:65532
ENV ADDR=:8080 DATA_DIR=/data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=4s --start-period=5s CMD ["/isis-hub", "healthcheck"]
ENTRYPOINT ["/isis-hub"]
