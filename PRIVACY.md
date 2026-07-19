# Privacy

HackerTok does not require an account and does not link Web Push enrollment to
a Hacker News identity or profile.

## Data used for story alerts

If you enable 1,000+ point story alerts, HackerTok stores one anonymous
installation record containing:

- A browser push-relay endpoint.
- The browser-provided `p256dh` public key and authentication secret required to
  encrypt Web Push messages.
- A one-way hash of a random bearer token stored by that browser.
- A one-way hash of the endpoint, the VAPID key ID, and lifecycle timestamps,
  including whether that endpoint has completed an accepted relay delivery.
- Internal story, fan-out, delivery, retry, and coarse relay-status records.

HackerTok does not ask for or store your name, email address, Hacker News
username, contacts, advertising identifiers, or browsing history for alerts.
IP-based rate limiting is handled by Cloudflare's rate-limiter binding; IP
addresses are not written to the HackerTok D1 subscription database.

## Browser push services

Native Web Push necessarily passes encrypted messages through the push service
selected by your browser or operating system, such as services operated by
Google, Mozilla, Microsoft, or Apple. Those providers receive the relay endpoint and
transport metadata under their own privacy terms. Notification payloads are
encrypted for the browser subscription.

Cloudflare runs the Worker, D1 database, and Queues used by this feature.
GitHub Pages hosts the HackerTok frontend.

## Anonymous enrollment verification

When you first enable alerts, HackerTok loads Cloudflare Turnstile and sends its
short-lived response token to the Worker for server-side validation. Cloudflare
processes the browser and network signals needed to assess that request under
its own privacy terms. Most visitors see no additional control; a managed
verification interaction may appear when Cloudflare requires one.

The Turnstile response is single-use, expires after five minutes, and is not
stored in HackerTok's D1 database. Reconciliation of an already known random
bearer token does not run another Turnstile challenge.

## Retention and deletion

- Opt-out, permission revocation observed on a later visit, subscription
  expiration, or relay `404/410` immediately scrubs the endpoint and encryption
  keys.
- A token-hash tombstone remains for up to 30 days to stop a stale browser
  reconciliation request from restoring an opted-out subscription.
- Accepted and terminal delivery records are retained for seven days for
  recovery and operational diagnosis.
- Minimal Hacker News story IDs remain indefinitely to prevent duplicate
  lifetime alerts. Stored title and score details are scrubbed after 90 days.
- Active subscription data remains until opt-out, browser-reported expiry, or a
  terminal relay response.

## Controls

Version 1 uses one transient, explicit opt-in action. It never opens a native
notification prompt on page load or after an unrelated click. Turnstile runs
only as part of that action and stays hidden unless managed verification needs
an interaction.

Browser or operating-system notification settings are the initial opt-out
surface. When you later open HackerTok, it reconciles permission and
subscription state and sends a token-only deletion request where needed.
HackerTok intentionally defers a unified notifications/theme settings menu to a
future version.

The random bearer token, subscription fingerprint, pending deletion markers,
and push configuration are stored together in browser IndexedDB so pages and
the service worker can reconcile browser endpoint rotation safely. Tabs use
same-origin browser coordination only; it does not send additional data to a
third party. Other local HackerTok preferences remain in browser storage.
Clearing site data removes these local values; the browser push subscription or
notification permission may also need to be removed in browser settings.

## Logging

HackerTok application logs must not contain raw bearer tokens, authorization
headers, relay endpoints, encryption keys, or subscription request bodies.
Operational logs use public Hacker News story IDs, internal ledger IDs, and
coarse result classes.

## Contact

For privacy or security concerns, use the private reporting process in
[SECURITY.md](SECURITY.md).
