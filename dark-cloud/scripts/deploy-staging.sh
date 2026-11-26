#!/usr/bin/env bash
# Deploys DARK-CLOUD to a STAGING Firebase project only, then verifies the live HTTPS PWA.
# Usage: STAGING_PROJECT=<staging-project-id> ./scripts/deploy-staging.sh
# Auth (one of): `npx firebase login` on your machine, or GOOGLE_APPLICATION_CREDENTIALS=<service-account.json> for CI.
set -euo pipefail
cd "$(dirname "$0")/.."
P="${STAGING_PROJECT:?Set STAGING_PROJECT to the staging Firebase project id}"

# ---- safety guards: never production, never the legacy AI Studio project
PROTECTED="${PROTECTED_PROJECTS:-zesty-doodad-jpd8p}"
if [[ "$P" =~ [Pp][Rr][Oo][Dd] ]] || [[ " $PROTECTED " == *" $P "* ]]; then echo "REFUSED: '$P' looks like production or is protected." >&2; exit 1; fi
ENVF=web/.env.staging
[[ -f $ENVF ]] || { echo "Missing $ENVF (copy web/.env.example and fill the STAGING project's web config)" >&2; exit 1; }
grep -q "^VITE_FIREBASE_PROJECT_ID=$P$" $ENVF || { echo "REFUSED: $ENVF does not point at $P" >&2; exit 1; }
grep -q "^VITE_USE_EMULATORS=true" $ENVF && { echo "REFUSED: emulator mode enabled in $ENVF" >&2; exit 1; }

echo "==> Tests"
npm run test:unit
echo "==> Build"
npm run build -w functions
(cd web && npx vite build --mode staging)

echo "==> Deploy to STAGING project $P (rules, indexes, storage, functions, hosting)"
npx firebase deploy --project "$P" --only firestore:rules,firestore:indexes,storage,functions,hosting --non-interactive

URL="https://$P.web.app"
echo "==> Verify $URL"
for path in / /manifest.webmanifest /sw.js /icons/maskable-512.png /version.json; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$URL$path"); echo "$path → $code"; [[ $code == 200 ]] || { echo "Verification failed for $path" >&2; exit 1; }
done
curl -sI "$URL/sw.js" | grep -i "cache-control" || true
LOCAL=$(cat web/dist/version.json); LIVE=$(curl -s "$URL/version.json")
[[ "$LOCAL" == "$LIVE" ]] || { echo "Live version $LIVE != built $LOCAL" >&2; exit 1; }
node scripts/make-qr.mjs "$URL"
echo "Staging deployed and verified: $URL  (build $LIVE)"
echo "Next: bootstrap the GM once — node scripts/bootstrap-owner.mjs --project $P --email <GM Google email> --name \"المهندس توهيب السيفي\""
