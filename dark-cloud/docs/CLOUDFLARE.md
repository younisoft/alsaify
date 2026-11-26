# Deploying the DARK-CLOUD PWA on Cloudflare Pages (Firebase backend unchanged)

**Short answer:** yes. The web app is a static PWA and can be served from Cloudflare Pages for free, from branch `ccr-d63cbb06-07jfmy`, with no change to the app. Verified locally on Cloudflare's own runtime (`wrangler pages dev`):
- deep links load the app;
- headers, service worker and manifest are served correctly;
- Chrome installability: 0 errors.

**But Cloudflare only replaces Firebase *Hosting*.** The backend (Authentication, Firestore, Cloud Functions, Storage) still has to exist in a Firebase project, and **it has never been deployed anywhere yet**. The old AI Studio project (`zesty-doodad-jpd8p`) runs the *old* app's data and rules; it is not a backend for this app.

## 1. Firebase dependencies and whether they keep working

| Dependency | Used for | Called from | Works with Cloudflare Pages? | Plan needed |
|---|---|---|---|---|
| Firebase Auth (Google sign-in, popup) | Login | Phone → `identitytoolkit.googleapis.com` + popup on `<project>.firebaseapp.com/__/auth/handler` | **Yes**, once the Pages domain is an *Authorized domain* | Free (Spark) |
| Cloud Firestore | All reads (live) | Phone → `firestore.googleapis.com` | **Yes**, unchanged | Free tier: 50k reads / 20k writes per day |
| Cloud Functions `api` (callable) | **Every** write, report and permission check | Phone → `europe-west1-<project>.cloudfunctions.net` | **Yes**, unchanged | **Blaze (pay-as-you-go, needs a payment card)** |
| Cloud Functions `dailyScan`, `dailyBackup` | Daily alerts, backups | Cloud Scheduler | Unaffected by hosting | **Blaze** |
| Cloud Storage | Document attachments, backup files | Phone → `firebasestorage.googleapis.com` | **Yes**, unchanged | Firebase announced in 2024 that new projects need **Blaze** for a Storage bucket (confirm on the pricing page) |
| App Check | Optional | — | Yes (only if configured) | Free |
| Firebase Hosting | Serving the web files | — | **Replaced by Cloudflare Pages** | — |

The app does **not** use Firebase Hosting's reserved `/__/` paths, rewrites or SDK auto-config. Its config comes from `VITE_*` build variables, so no code change is needed.

### The one blocker: a payment card
Cloud Functions can only be deployed on the **Blaze** plan, which requires a billing account with a card. This app's architecture routes every write through that function for security. For a 4-person team the usage should normally stay inside Blaze's monthly free allowance (about $0), but **Google still requires the card**. Set a budget alert at $1.

Options, given "no payment card":
- **A (recommended): a new Firebase project on Blaze**, paid by a card from anyone you trust. No code change. Set a $1 budget alert.
- **B: an existing Google Cloud project that already has billing.** For example, check whether the AI Studio project is on Blaze. Deploy into a **separate named Firestore database** (the code supports `FIRESTORE_DATABASE_ID`), so the old app's data is never touched. It needs care with rules and storage targets; I'd prepare it only if you confirm that project's billing status and owner access.
- **C: move the server API to Cloudflare Workers (free, no card).** This **rewrites the backend data layer** (the Admin SDK doesn't run on Workers), so your "do not rewrite" rule excludes it. Listed only for completeness.

## 2. Google sign-in on the Cloudflare domain
- **It works** with the current code (`signInWithPopup`), provided:
  1. `VITE_FIREBASE_AUTH_DOMAIN=<project>.firebaseapp.com`. That auth handler is served by Firebase automatically for every project, **without deploying Firebase Hosting**.
  2. These **Authorized domains** are added in Authentication → Settings:
     - `dark-cloud.pages.dev` (your Pages production domain; use the exact name Cloudflare assigns);
     - any custom domain you add later.

     Wildcards aren't supported, and Cloudflare *preview* URLs (`<hash>.dark-cloud.pages.dev`) are separate domains. Use the production URL for login.
- **Regional caveat:** the phone still talks directly to Google: `*.googleapis.com`, `*.cloudfunctions.net`, and the popup on `*.firebaseapp.com`. Cloudflare doesn't change that. Quick test on the phone, before anything else:
  - open `https://<project>.firebaseapp.com/__/auth/handler`. A small Firebase page or error text = reachable; a network error = blocked;
  - open `https://firestore.googleapis.com/`. Any Google response = reachable.
- If **only** `firebaseapp.com` is blocked: the auth handler can be proxied through the Cloudflare domain (a small Pages Function forwarding `/__/auth/*`, plus `authDomain` = your Pages domain, plus one redirect URI in the Google OAuth client). Prepare this only if the test fails.

## 3. Cloudflare Pages settings (verified by a clean-copy build simulation)

| Setting | Value |
|---|---|
| Repository / branch | `younisoft/alsaify` → **Production branch:** `ccr-d63cbb06-07jfmy` |
| Framework preset | None |
| **Root directory** | `dark-cloud/web`. Important: Cloudflare would treat `dark-cloud/functions` (the Firebase functions) as Cloudflare Functions if the root were `dark-cloud` |
| Build command | `cd .. && npm ci && npm run build:pages` |
| Build output directory | `dist` |
| Build time / size | ≈25 s, 47 files, 3.7 MB (free limits: 500 builds per month, 20,000 files) |
| SPA routing | Automatic (Cloudflare serves `index.html` for app routes because the build has no `404.html`). **Don't add a `_redirects` file** |
| Headers | `web/public/_headers` (security headers; `sw.js`, `index.html` and the manifest never cached; hashed assets immutable) |

Environment variables (Production). These are public web identifiers, not secrets:

```
NODE_VERSION=22
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
VITE_FIREBASE_API_KEY=<from: firebase apps:sdkconfig web>
VITE_FIREBASE_AUTH_DOMAIN=<project>.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=<project>
VITE_FIREBASE_STORAGE_BUCKET=<from sdkconfig>
VITE_FIREBASE_APP_ID=<from sdkconfig>
VITE_FUNCTIONS_REGION=europe-west1
VITE_FIRESTORE_DATABASE_ID=(default)
```
Never set `VITE_USE_EMULATORS` here.

## 4. Simplest deployment plan (in order; nothing is deployed until you say so)

**Backend, once, from any computer with Node 22 (mostly command line, minimal console):**
1. `npx firebase-tools login`, then `npx firebase-tools projects:create darkcloud-staging`.
2. **Console or Cloud Billing, once:** link a billing account (Blaze) and set a $1 budget alert. *Can't be avoided for Cloud Functions.*
3. **Console, once:** Authentication → Sign-in method → enable **Google**. Then Settings → Authorized domains → add the Pages domain (after step 8).
4. `npx firebase-tools firestore:databases:create "(default)" --location=eur3 --project darkcloud-staging`. Create the Storage bucket in the console if you want attachments.
5. `npx firebase-tools apps:create web dark-cloud --project darkcloud-staging`, then `apps:sdkconfig web` gives the values for the variables above.
6. From `dark-cloud/`:
   - `npm ci`
   - `npm run build -w functions`
   - `npx firebase-tools deploy --project darkcloud-staging --only firestore:rules,firestore:indexes,storage,functions` (no `hosting`).
7. `node scripts/bootstrap-owner.mjs --project darkcloud-staging --email <GM Google email> --name "المهندس توهيب السيفي"`.

**Frontend (free, no card):**

8. Sign up at Cloudflare (email only), then Workers & Pages → Create → Pages → Connect to Git → `younisoft/alsaify`. Enter the settings and variables from §3 → **Save and Deploy**.
9. Add the resulting `https://<name>.pages.dev` to Firebase Authorized domains (step 3).
10. Open it on the phone in Chrome, sign in as the GM, then ⋮ → **Install app**. Updates: push to the branch, Cloudflare rebuilds, and the app shows «تحديث الآن».

I can run steps 1 and 4–7 for you once a Firebase login or a service-account key for the **staging** project is available to this environment (never paste keys in chat). Step 8 needs your Cloudflare account, unless you provide a Cloudflare API token scoped to Pages. Then I can create the project with `wrangler` and deploy.
