# Woe Deployment Guide

This guide covers the public package containing displayer and Webhooker. Run commands at the root of the actual release source. Generic AI/quota/push frameworks remain, but AI Tagger, vendor push implementations and their dedicated frontend controls are excluded.

## 1. Create resources

Prerequisites: Node.js ≥22.12, a Cloudflare account, and access to Workers, D1, R2, Queues, Images and SQLite-backed Durable Objects under that account's plan and quotas.

```bash
npm ci
npm --prefix frontend ci
npx wrangler login
npx wrangler d1 create woe-db
npx wrangler r2 bucket create woe-storage
npx wrangler queues create woe-plugin-jobs
```

Record the D1 UUID. The first deployment creates MessageStreamHubObject through the DO [[migrations]] declaration; it needs no separate creation command. Images uses a Worker binding, without a separate Images storage resource.

## 2. Configure wrangler.toml

```bash
cp example.wrangler.toml wrangler.toml
```

Replace database_id with the real UUID and ensure bucket_name matches the actual R2 bucket. Set workers_dev=true or configure a custom domain through [[routes]]. The template disables workers.dev, so leaving both access methods unconfigured will not expose the service.

The template retains DB/R2/IMAGES/ASSETS/MESSAGE_STREAM_HUB and Webhooker's PLUGIN_JOB_QUEUE producer/consumer. Queue settings are max_batch_size=1, max_retries=2 and max_concurrency=1: the first attempt plus two retries, for three attempts in total. Concurrency limits do not guarantee ordering or exactly-once delivery.

The default queue name is woe-plugin-jobs. If renamed, update the producer, consumer and [vars].PLUGIN_JOB_QUEUE_NAME together. Unknown queue names reach a branch that acknowledges and discards the batch. Default functionality needs no Workers AI (AI binding), QUOTA_KV or push queue (PUSH_QUEUE). Add resources and matching queue-name variables only when implementing extensions that require them.

REGISTRATION defaults to false. Retain the SQL text-module rules, DO migration history and cron. The daily cron removes terminal Plugin Jobs created over 30 days ago and marks pending jobs created over 24 hours ago as dead; it does not resend jobs to the queue. Generic push core and historical tables remain.

## 3. Set secrets

For the first deployment:

```bash
npx wrangler secret put DEFAULT_ADMIN_PASSWORD
openssl rand -base64 32 | npx wrangler secret put PLUGIN_SECRET_MASTER_KEY
```

Use a strong random bootstrap password; password/admin/123456 are rejected. The plugin master key must decode from base64 to 32 bytes. PLUGIN_SECRET_KEY_VERSION is positive-integer metadata in [vars], defaulting to "1". Saving Webhooker configuration validates the master key even when authToken is omitted.

Retain the existing master key and version across upgrades; do not generate a new one on each deployment. If replacing the key is necessary, also increase PLUGIN_SECRET_KEY_VERSION and have users enter their real authToken again. Changing the version cannot restore old ciphertext, and *** cannot serve as a new credential. Keep Secrets out of [vars], Git and logs.

For local development, put independent test values for DEFAULT_ADMIN_PASSWORD/PLUGIN_SECRET_MASTER_KEY in the ignored root .dev.vars. This file does not synchronize values to the cloud.

## 4. Build and deploy

```bash
npm run build:frontend
npx wrangler deploy --dry-run
npm run deploy
```

build:frontend includes type checking and writes root public/. The deploy script refreshes buildInfo before deployment but does not rebuild the frontend. Direct npx wrangler deploy does not refresh buildInfo. A dry-run checks packaging and configuration parsing; it does not create resources or validate the real deployment.

On the first HTTP request, the Worker automatically applies the fixed 0000_initial_schema baseline and subsequent incremental migrations, including 0013_plugin_jobs. An empty database needs neither db:push nor a manually imported baseline. Migration failure returns 503 DATABASE_MIGRATION_FAILED; details are in Worker logs. Do not delete _migrations or reimport the baseline to repair an inconsistent database.

## 5. Initialize the administrator

Deployment does not create an everyday administrator. DEFAULT_ADMIN_USER (default admin) and the bootstrap password from step 3 only authorize initialization.

Open /setup, enter the bootstrap username/password, then choose the actual administrator username and an independent strong password. Sign in with that actual account afterward. Do not use both the same username and password as the bootstrap credentials; the same username with a different password is allowed. Initialization succeeds once; changing bootstrap variables does not change an existing account.

Equivalent API flow (replace the placeholders):

```bash
curl -u '<DEFAULT_ADMIN_USER>:<DEFAULT_ADMIN_PASSWORD>' -X POST 'https://<your-domain>/api/v1/init/admin' \
  -H 'Content-Type: application/json' -d '{"name":"woe-owner","pass":"<independent-strong-administrator-password>"}'
```

The API only checks that username/password are nonempty; choose a strong password yourself. The Web UI requires at least 8 characters.

## 6. Configure and verify Webhooker

Administrators have plugin permissions by default. An administrator grants non-administrators access through PUT /user/<userId>/plugin-permissions with body {"modulePaths":["builtin/webhooker","builtin/displayer"]}. This replaces the user's permission list; read the existing list and merge changes first.

Create a Webhooker instance in the browser, save its YAML and explicitly enable it. Minimal configuration:

```yaml
targetUrl: https://example.com/webhook  # Replace with your verified receiver
method: POST
timeoutMs: 5000
# Enter a real token the first time Bearer authentication is needed.
# The platform encrypts it; GET configuration reads return a mask.
# authToken: '<receiver-credential>'
```

Omit authToken when authentication is unnecessary. GET configuration reads return authToken masked as ***. Keeping `authToken: "***"` on a later save retains the existing ciphertext; it is invalid as a first credential. Removing authToken or setting it to null / an empty string clears the stored credential; entering a real new value replaces it. Legacy plaintext headers.Authorization remains supported, but cannot coexist with authToken and does not receive authToken's encryption or masking protection; prefer the encrypted field. The default body contains pluginId/userId/event/message/at, with appId inside message. Add application names or other data through a custom body template. Keep real message content, credentials and complete production YAML out of Git.

Check /api/v1/health and /api/v1/version first. POST /api/v1/message with an application token and record messageId. Use the owner's Basic credentials or client token with GET /api/v1/message/<messageId>/jobs?pluginId=<pluginId>, and confirm the actual request at the receiver. status=success means the task succeeded; successful message creation, a job row or queue submission alone does not prove delivery.

Webhooker is triggered only by message.create. POST /message/<messageId>/jobs returns 409 Conflict for it (the internal rejection reason is plugin-unavailable; the HTTP response does not expose that code field), so it cannot provide manual redelivery. Duplicate outbound requests are possible; handle duplicates according to the receiving application's requirements. Do not assume exactly-once delivery.

The default policy allows HTTPS only and statically blocks recognizable private/loopback addresses and hostnames. It rejects userinfo/fragment, path traversal and automatic redirects; Webhooker allows query strings. It does not resolve DNS in advance and cannot prevent DNS rebinding: use trusted receiver domains and verify their resolution. For a trusted deployment requiring an internal target, set WEBHOOKER_ALLOW_HTTP / WEBHOOKER_ALLOW_PRIVATE_NETWORK to the string "true" (case-insensitive). The former permits HTTP and the latter permits private networks; redeploy after changes. Values 1/yes/on do not enable either option, and other restrictions still apply.

Also verify that client-token WebSocket receives the same message ID, displayer enable/disable/display, browser sign-in, and icon upload/read/delete. Displayer has no message-event logs, so an empty log is normal. Record real Queue/D1/HTTP and browser results separately; unit tests and dry-run do not replace them.

## 7. Upgrade and rollback

```bash
git fetch --tags
release_tag=vX.Y.Z  # Replace with an actual published public tag
git switch --detach "$release_tag"
npx wrangler d1 export woe-db --remote --output ../woe-before-upgrade.sql
npm ci
npm --prefix frontend ci
npm run build:frontend
npm run deploy
```

Merge the new template section by section before deployment, retaining the existing DB/R2 IDs, DO migrations, routes, Secrets and cron. Upgrading from an older displayer-only package requires creating the Plugin Jobs Queue and setting the plugin master key, then creating/granting/configuring/enabling Webhooker; instances are not created automatically. An older synchronous Webhooker becomes asynchronous best-effort delivery. URL/empty-YAML/field-type validation is stricter, so test downstream compatibility.

Configuration rows for excluded plugins are not deleted automatically, and those instances cannot load. Existing push_outbox rows and queued messages are not automatically emptied: valid pending rows can remain suspended without a provider. Retain them for restoration or perform reviewed manual termination; do not assume automatic cleanup. Migration history and device compatibility fields remain, without automatically deleting historical data.

Rollback does not revert the schema. Disable task entry points and handle the backlog first to avoid duplicate outbound requests from new asynchronous jobs and older synchronous plugins. Retain the original master key. Check the older version's schema/ciphertext/password-hash compatibility; do not delete migration records or regenerate the key as a rollback procedure.

## 8. Troubleshooting

| Symptom | Check |
|---|---|
| Saving configuration returns 503 secret-key-unavailable | Master key exists, decodes from base64 to 32 bytes, and its version is a positive integer. |
| Saving configuration returns 409 secret-reentry-required | The key version changed: enter the real authToken again instead of retaining the old mask. |
| Job error.code=secret-decrypt-failed | Current master key cannot decrypt the ciphertext; restore the original key or re-enter the real authToken. |
| Message succeeds but no job appears | Plugin permissions, enabled state, filters, saved configuration and enqueue-rejection logs. |
| Job failed / enqueue-send-failed | PLUGIN_JOB_QUEUE binding/name; cron does not resend jobs. |
| outbound-blocked | Target URL and deployment outbound policy; do not bypass it through redirects. |
| pending does not progress | Queue consumer, actual queue name and Worker logs; checking the producer alone is insufficient. |
| Database returns 503 | Logs and _migrations/sqlite_master; back up the database and inspect its structure first. |
| Frontend is stale or returns 404 | Rebuild public/ before deployment; check ASSETS and domain routes. |

GET /message/<id>/jobs returns status/error/result without the task payload. Task snapshots may contain business content and are deleted under terminal retention rules; protect backups as sensitive data.
