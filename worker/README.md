# HackerTok Push Worker

This Worker provides HackerTok's anonymous per-installation Web Push alerts. It
discovers Hacker News stories in a rolling seven-day window, verifies their live
Firebase score, and creates one lifetime alert when the score becomes strictly
greater than 1,000.

The Worker, D1 database, and both Queues are intentionally kept in this
repository so frontend, service-worker, API, schema, and deployment changes can
be released together.

## Architecture

- Detection, Queue-wake recovery, and bounded cleanup each run every five
  minutes on separate offsets, so their D1 query budgets cannot accumulate in
  one Worker invocation.
- D1 is the authoritative ledger for subscriptions, story events, fan-out
  progress, and deliveries.
- Cloudflare Turnstile protects only a previously unknown installation's first
  enrollment. Reconciliation by the same random bearer token stays silent.
- `hackertok-push-fanout` pages the event audience in groups of 50.
- `hackertok-push-delivery` sends one encrypted Web Push request per invocation.
- Queue messages contain only D1 IDs. Missing or stale messages are republished
  by Cron.
- `web-push-neo` builds RFC 8291 `aes128gcm`, VAPID-authenticated requests with
  Web Crypto; the Worker does not enable `nodejs_compat`.

Queue delivery is at-least-once. D1 uniqueness, fenced leases, Web Push `Topic`,
and notification tags suppress ordinary duplicates, but a relay accepting a
request immediately before an invocation crashes can still cause a rare visible
duplicate.

## Cloudflare provisioning

A Cloudflare account is required. The Free plan does not normally require a
payment card, but verify the current Cloudflare signup and product terms before
provisioning.

Install dependencies and authenticate Wrangler:

```bash
npm ci
npx wrangler login
```

Create the resources once:

```bash
npx wrangler d1 create hackertok-push
npx wrangler queues create hackertok-push-fanout
npx wrangler queues create hackertok-push-delivery
```

Copy the returned D1 UUID into `worker/wrangler.jsonc` for manual deployments.
The release workflow instead reads it from the
`CLOUDFLARE_D1_DATABASE_ID` repository variable and renders a temporary config.
The three Rate Limiting `namespace_id` values in that file must be unique within
the target Cloudflare account; replace them before the first deployment if the
account already uses any of those IDs.

Generate one VAPID pair offline:

```bash
node --input-type=module <<'EOF'
const pair = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
);
const publicKey = Buffer.from(
  await crypto.subtle.exportKey('raw', pair.publicKey),
).toString('base64url');
const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_JWK=${JSON.stringify(privateJwk)}`);
EOF
```

Keep an offline recovery copy. Put only the private JWK in Cloudflare Secrets:

```bash
npx wrangler secret put VAPID_PRIVATE_JWK --config worker/wrangler.jsonc
```

Set the matching public key in `VAPID_PUBLIC_KEY`, keep `VAPID_KEY_ID` stable,
and use an HTTPS or `mailto:` operator contact for `VAPID_SUBJECT`. Production
uses `https://hackertok.github.io/`.

Create a free Managed Turnstile widget restricted to
`hackertok.github.io`. Put its public site key in `TURNSTILE_SITE_KEY` and its
secret key only in Cloudflare Secrets:

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY --config worker/wrangler.jsonc
```

Use Cloudflare's published test site/secret pair from
`worker/.dev.vars.example` only for local automated development, never for a
production Worker. The local-only `ALLOW_TURNSTILE_TEST_KEYS` override is absent
from deployable Wrangler configuration, so deployed Workers reject Cloudflare's
published test credentials at runtime; the release workflow also rejects test
site keys before deployment.

Apply the migrations and deploy:

```bash
npm run worker:migrate:remote
npm run worker:deploy
```

## GitHub release configuration

Configure these GitHub Actions values:

Repository secrets:

- `CLOUDFLARE_API_TOKEN`: least-privilege token that can deploy this Worker,
  apply D1 migrations, and attach Queue consumers.
- `CLOUDFLARE_ACCOUNT_ID`: the target Cloudflare account.

Repository variables:

- `CLOUDFLARE_D1_DATABASE_ID`: provisioned D1 UUID.
- `PUSH_API_URL`: deployed HTTPS Worker origin, with no path.
- `VAPID_PUBLIC_KEY`: public base64url VAPID key.
- `TURNSTILE_SITE_KEY`: public site key for the hostname-restricted production
  widget.

Create a protected GitHub Environment named `push-production`, require an
operator reviewer, and attach the staging evidence from the rollout checklist
below to the release before approval. The backend deployment job targets that
environment.

The private VAPID JWK and Turnstile secret remain Cloudflare Secrets; they are
never copied to GitHub.
The release workflow validates and builds the tagged frontend, applies
expand-only migrations, deploys the Worker, waits for bootstrap readiness,
smoke-tests public config, and only then deploys the already-built Pages
artifact. Releases are serialized and are not cancelled midway.

## Local development and verification

Useful commands:

```bash
npm run worker:types
npm run worker:typecheck
npm run worker:migrate:local
npm run worker:test
npm run worker:dry-run
npm run worker:dev
```

For local delivery testing, copy `worker/.dev.vars.example` to
`worker/.dev.vars`, fill it with a disposable matching VAPID pair, and retain
the published Turnstile test pair. Real production private keys must not be used
locally.

Local/preview frontend builds may omit `VITE_PUSH_API_URL`; notification UI is
then absent. To connect the frontend to a Worker:

```bash
VITE_PUSH_API_URL=http://localhost:8787 npm run dev
```

Do not use production subscription data in local development.

## Pre-production rollout gates

Use isolated staging D1 and Queue resources and a staging Worker URL. Never
copy production subscriptions into staging. Before publishing the Pages
artifact:

1. Let staging finish bootstrap and confirm `/health/ready` returns `204`, the
   `x-hackertok-release` response header identifies the staging build, the
   config threshold is `1000`, and historical qualifying stories remain seeded
   without deliveries.
2. Enroll through HackerTok's transient action, verify Turnstile normally stays
   hidden (and can surface its managed interaction when Cloudflare requires
   one), and invoke the fixed self-test endpoint on Chrome/Android, Firefox,
   Edge, macOS Safari, and an installed iOS/iPadOS Home Screen PWA.
3. On each device, verify delivery with the browser/app killed and verify a cold
   notification click opens only the expected `/#/item/{id}` route.
4. Exercise detector, 50-installation fan-out pages, retry recovery, and a
   single delivery while inspecting Workers Analytics. Record p95 and p99 CPU,
   Queue lag, retries, and status classes. Every handler needs comfortable
   margin below the Free plan's 10 ms CPU limit and zero CPU-limit errors.
5. Confirm projected Queue operations remain below the intervention thresholds
   for the 350-installation cap before enabling the production API URL.

Playwright's synthetic service-worker push tests validate payload handling and
navigation only; they do not replace real relay interoperability checks.

## API

- `GET /health/ready`: returns `204` only after bootstrap reaches `ACTIVE` and
  the public/private VAPID and Turnstile configurations are present; otherwise
  `503`. The body is always empty, and `x-hackertok-release` identifies the
  deployed build.
- `GET /v1/push/config`: returns the enabled state, strict threshold, VAPID key
  ID, public application-server key, and public Turnstile site key.
- `PUT /v1/push/subscription`: idempotently creates or reconciles the caller's
  subscription. Requires exact-origin CORS, JSON, and a random 32-byte bearer
  token. A previously unknown token also requires a fresh, single-use
  Turnstile token validated by the Worker; an existing token does not.
- `DELETE /v1/push/subscription`: token-only idempotent opt-out.
- `POST /v1/push/self-test`: heavily rate-limited fixed-message delivery for
  operator/device QA. It cannot send caller-supplied notification content.

Subscription endpoints are restricted to the maintained HTTPS relay-host
allowlist. Requests with credentials, custom ports, oversized bodies, invalid
keys, redirects, or unknown relay hosts are rejected. CORS is a browser policy,
not authentication; possession of the random token is the authorization
boundary for an existing installation, while Turnstile is the initial
anonymous-admission control. Apple relay hosts are admitted through the documented
`*.push.apple.com` suffix.

## Bootstrap and alert semantics

On first deployment, the Worker freezes a seven-day range, enumerates Algolia
candidates, and verifies them with the official Firebase API. Existing
qualifying stories are seeded without alerts. Enrollment remains disabled and
readiness remains `503` until this scan completes. A candidate that still
cannot be verified after 12 bootstrap attempts is conservatively seeded as a
historical deferred item, so a permanently unavailable item cannot block
activation and can never produce a historical alert.

After activation, every five minutes the Worker rescans the complete rolling
window. Candidate discovery is bulk-upserted in one D1 statement and at most ten
Firebase results are persisted per detector invocation. The conservative upper
bound is 31 of the Free plan's 50 D1 queries, leaving at least 19 queries of
headroom. An event requires a matching positive HN ID, `type: "story"`, a
bounded nonempty title, no dead/deleted marker, and a live integer score greater
than 1,000. A score of exactly 1,000 and transient API failures remain
recheckable. HN ID uniqueness makes the event lifetime-deduplicated.
An undetected outage lasting longer than seven days can age stories out of the
discovery window, so the scan-freshness alert below remains a required control.

## Delivery and recovery

Relay responses are handled as follows:

- `2xx`: accepted by the relay.
- `404/410`: terminal delivery; disable and immediately scrub the endpoint and
  key material.
- `408/429/5xx` or timeout: bounded exponential retry, honoring capped
  `Retry-After`.
- `400/401/403/413` or redirects from an unverified installation: disable only
  that installation; never open the global circuit.
- The same sender/auth fault from a previously verified installation: pause
  that delivery locally. Open the global circuit only after three distinct
  verified installations report the same fault class within five minutes.
- Other `4xx`: terminalize only that delivery (and disable a newly enrolled
  endpoint if it has never completed one accepted delivery).

Delivery attempts expire absolutely 12 hours after the story event. Cron
recovers a story committed without fan-out, deliveries committed without Queue
messages, stale leases, and page progress without a next wake-up. Local
sender/auth suspects use progressive backoff and stop after six attempts.
Pre-migration installations without retained acceptance evidence are marked as
legacy-unknown: they are neither deleted by one fault nor allowed to contribute
to a global circuit until a `2xx` verifies their current endpoint.

## VAPID recovery and rotation

The normal operation is to keep the VAPID pair stable indefinitely. Restore the
offline copy if a deployment secret is lost.

If the pair is compromised and must be replaced:

1. Pause Queue publishing and delivery.
2. Generate and securely back up a new pair.
3. Set the new private JWK secret, public key, and a new `VAPID_KEY_ID`.
4. Deploy the Worker and frontend together.
5. Resume delivery and watch circuit/error metrics.

Deliveries for subscriptions enrolled under an older key ID are terminalized
and their relay material is scrubbed rather than sent with the wrong private
key. The frontend detects the application-server-key mismatch and presents one
gesture-safe repair action. Rotation therefore requires users to revisit
HackerTok and repair enrollment.

## Free-plan operating envelope

Initial admission is protected by server-validated Turnstile and atomically
capped at 350 active installations. Unknown opt-out tombstones are also bounded
to three times that cap using a transactionally maintained retained-row counter;
replaying an already disabled token is write-free. The release gate is zero
CPU-limit errors with comfortable margin below the Free plan's 10 ms CPU limit
for detector, fan-out, and single-delivery handlers.

Intervene when any of these occur:

- 70% of the daily Queue operation budget is reached.
- Any Worker CPU limit error occurs.
- The last successful scan is older than two Cron intervals.
- The oldest pending work exceeds 15–30 minutes.
- Retry rate exceeds 5%.

Monitor bootstrap phase, scan freshness, fan-out cursors, delivery age/state,
Queue lag and operations, relay response classes, circuit state, and CPU time.
On a circuit or budget alarm, stop publishing new Queue wakes; work remains
durable in D1. Raising the 350-installation cap requires new burst measurements
and demonstrated free-tier headroom or a paid-plan decision.

The operator Queue-budget kill switch is stored in D1 and is checked by the
detector, both Queue handlers, and both recovery publishers:

```bash
npx wrangler d1 execute PUSH_DB --remote --config worker/wrangler.jsonc \
  --command "UPDATE app_state SET queue_publishing_paused = 1 WHERE id = 1"
# Resume only after checking Queue usage, lag, and pending-work expiry:
npx wrangler d1 execute PUSH_DB --remote --config worker/wrangler.jsonc \
  --command "UPDATE app_state SET queue_publishing_paused = 0 WHERE id = 1"
```

Public config, subscription writes, and self-tests have per-IP/per-token where
applicable plus aggregate limits. The active-installation count is maintained
transactionally in the D1 ledger, and a separate retained-row count bounds
unknown tombstones without scanning subscriptions.
An installation becomes relay-verified only after a `2xx` delivery or fixed
self-test; changing its endpoint or keys clears that evidence. Public self-tests
can never contribute to or open the global delivery circuit.

## Data retention and incident response

Endpoint and key material are scrubbed immediately on opt-out, expiry, or relay
`404/410`. A token-hash tombstone is retained for 30 days to prevent stale
reconciliation from resurrecting enrollment. Accepted/terminal deliveries are
retained for seven days; story IDs remain as minimal lifetime-deduplication
tombstones, with title/score details scrubbed after 90 days. The subscription's
relay-verification timestamp is lifecycle metadata and is cleared whenever its
endpoint or encryption keys change.

Never log authorization headers, raw tokens, endpoints, subscription keys, or
request bodies. Logs use public story IDs, internal ledger IDs, and coarse
status classes only.

For an incident:

1. Pause Queue consumers or publishing while preserving D1 state.
2. Revoke the Cloudflare deployment token if credentials may be exposed.
3. Rotate the VAPID pair only if its private key may be exposed, following the
   repair procedure above.
4. Inspect coarse relay/circuit/Queue metrics without exporting subscription
   bodies.
5. Patch, run Worker tests and a dry run, deploy the Worker first, smoke-test,
   then resume Queue processing and publish the Pages artifact.
