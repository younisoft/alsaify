# Roles, permissions and security model

## Account types
| Type | How created | Can do |
|---|---|---|
| **General Manager (owner)** | Only via `scripts/bootstrap-owner.mjs`, run once with project-admin credentials, then Google sign-in with that exact email | Everything. Is the only one who can invite users or change permissions, finance settings, accounting periods and backups. Sensitive actions execute immediately and are recorded as auto-approved |
| **Team member** | GM creates an invitation (real email entered by the GM, plus individual permissions). The member signs in with the matching, verified Google account | Only the permissions granted, module × action |
| **Distributor portal** | GM invites a separate email linked to one distributor record. Works only while «بوابة الموزعين» is enabled | Read-only: own balance, custody, batches, payments, statement |

There is no public registration. Any Google account can authenticate with Firebase, but without an accepted invitation it gets **no data and no actions**. The attempt is logged in `security_events` and the GM is notified (tested).

**Dahman** has two separate identities:
- his **employee** account, with the permissions the GM assigns;
- his **distributor** record (`D000x`), an ordinary distributor in the ledger.

Nothing links the two automatically. His employee permissions never grant access to his own distributor account, and the reverse is also true. If he should view his statement, the GM can create a separate portal login (tested).

## Permission matrix
17 modules × 8 actions (`view, create, edit, approve, cancel, export, print, manage`), edited as a checkbox grid in **الفريق والصلاحيات**. New members get **nothing** except what the GM ticks. Financial modules are marked ● and are never granted by default. Members don't inherit from each other (tested: Al-Ashbat ≠ Azzam).

What each action gates on the server:

| Module | view | create | edit | approve | cancel | manage |
|---|---|---|---|---|---|---|
| distributors | read records, statements | new distributor (special terms and opening balance need `approve`) | contact data; request term changes and adjustments | approve term changes and adjustments | — | — |
| batches | read | create / deliver (custom unit price needs `approve`) | deliver, return | **finalize** (creates the receivable); approve credit overrides | cancel (finalized → approval) | — |
| payments | read | record receipts | — | reallocate; approve cancellations | request cancellation | — |
| collection | read follow-ups | add / update follow-ups | — | — | — | — |
| expenses | read | record | — | approve cancellations | request cancellation | — |
| purchases | read | create (no financial effect yet) | — | **approve = receive and post** (not one's own entry) | cancel | — |
| suppliers | read | create, pay | edit | approve opening balances and cancellations | request payment cancellation | — |
| inventory | read | items, issues, returns, transfers, counts | edit items | approve count / damage adjustments | — | warehouses |
| assets | read | register existing assets (needs `approve`) | edit | run depreciation | — | — |
| cash | read balances and statements | transfers, other vouchers (owner capital needs `approve`) | cash counts | approve count differences | — | create / disable accounts |
| reports / dashboard | read reports, journal | — | — | — | — | — |
| tasks | see all tasks | create | edit any task | mark done | — | — |
| archive | read all documents | upload to any record | — | — | — | — |
| settings | — | — | — | — | — | company, lists, rates, system (finance section: GM only) |
| audit | read the audit log | — | — | — | — | — |

`export` and `print` are recorded in the matrix. Exports run client-side over data the user may already read, so they are not an additional server control.

### Suggested starting point (not applied; the GM decides)
| Member | Suggested |
|---|---|
| Azzam (technical maintenance) | tasks: view, create · inventory: view, create · assets: view |
| Al-Ashbat (technical maintenance) | tasks: view, create · inventory: view |
| Dahman (distributor + maintenance) | tasks: view, create · inventory: view. Add batches / payments `create` only if he records deliveries or collections for the company |

## Approval workflow
Request → pending in **الاعتمادات** → reviewed by a user with `approve` on that module → approved (executed atomically) or rejected → audit record, and the requester is notified.
- **Separation of duties**: nobody can approve their own request (tested). Purchases can't be approved by the person who entered them (GM excepted).
- Approval-gated operations:
  - payment cancellation
  - cancellation of a finalized batch
  - debit / credit adjustments
  - commission or credit-limit changes
  - credit-limit override (block policy)
  - cash-count differences
  - inventory count / damage adjustments
  - expense cancellation
  - approved-purchase cancellation
  - supplier-payment cancellation
- Executors re-validate the current state at approval time. For example, an already-cancelled receipt can't be cancelled twice.

## Enforcement layers
1. **Firestore rules** (`firestore.rules`):
   - clients can **only read**, and only collections their permissions allow;
   - every client write is denied, the GM's included;
   - audit logs, counters and idempotency records are private.
   - 34 rules tests, including a re-run of the Phase-1 attack scenarios.
2. **Server API** (`functions/src/core/api.ts`): every call
   - loads the user's profile **fresh** (so a suspension applies on the next call);
   - checks the permission;
   - validates input with zod;
   - runs in a transaction with idempotency, period lock and audit.
3. **Storage rules** (`storage.rules`):
   - uploads only under `documents/{module}/{recordId}/`, with a create permission;
   - PDF, images, docx or xlsx only, under 10 MB;
   - no overwrite or delete.
4. **UI** hides what you can't do. That is convenience, not security.

## Remaining hardening (needs a real project)
- Enable **App Check** (reCAPTCHA Enterprise) and set `ENFORCE_APP_CHECK=true` for functions.
- Restrict the web API key (HTTP referrers) in Google Cloud Console.
- Optionally block account creation for uninvited emails with an Identity Platform blocking function (`beforeUserCreated`). Today such users authenticate but get no access.
