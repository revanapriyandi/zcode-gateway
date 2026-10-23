# ZCode Gateway

[English](README.md) | [Bahasa Indonesia](README.id.md)

Use your own ZCode Start Plan accounts through OpenAI and Anthropic-compatible APIs. This standalone Node.js gateway supports OAuth login, an encrypted multi-account vault, streamed model output and function-tool conversations. It can run behind OmniRoute or be used directly.

This is an independent integration with an undocumented ZCode endpoint. It is not affiliated with Z.ai. Compatibility was checked against ZCode desktop **3.16.3**, with **GLM-5.3** and **GLM-5.3-Flash** entitlements. Provider changes can break the integration.

## Supported endpoints

| Endpoint | JSON | SSE | Function tools |
|---|---|---|---|
| `POST /v1/chat/completions` | Yes | Yes | Calls and results |
| `POST /v1/responses` | Yes | Yes | Calls, outputs and `previous_response_id` |
| `POST /v1/messages` | Yes | Yes | Anthropic `tool_use` and `tool_result` |
| `GET /v1/models` | Enabled account entitlements | — | — |
| `GET /health` | Authenticated process health | — | — |
| `GET /api/usage` | Provider quota with 60-second cache | — | — |
| `GET /api/plans` | Account packages and selected routes | — | — |

Sampling controls (`temperature` from 0 to 1, `top_p` from 0 to 1 and integer `top_k` up to 1000) are validated and forwarded. Reasoning effort is accepted from Chat Completions `reasoning_effort`, Responses `reasoning.effort` or Anthropic `output_config.effort`. Structured-output and strict-schema guarantees return an explicit unsupported error.

The gateway returns tool requests to the caller. It never runs shell commands, opens files or executes tools on the server. OpenAI hosted tools such as code interpreter and web search are not supplied by this gateway; unsupported tool types return an error. Using an OpenAI or Anthropic API format does not change which upstream model you are using.

## Local setup

Requires Node.js **24.14 or newer**. There are no npm production dependencies.

```sh
git clone https://github.com/revanapriyandi/zcode-gateway.git
cd zcode-gateway
node src/cli.ts init
node --env-file=.env src/cli.ts provision "/path/to/official/ZCode/resources/glm/zcode.cjs"
node --env-file=.env src/cli.ts login zai "Account one"
node --env-file=.env src/cli.ts serve
```

On a typical Windows installation, provision with:

```powershell
node --env-file=.env src/cli.ts provision 'C:\Program Files\ZCode\resources\glm\zcode.cjs'
```

`init` creates `.env` with independent random master and client API keys. Read `ZCODE_API_KEYS` from that private file to configure your client. Keep `.env` and `data/` out of Git. The server binds to `127.0.0.1:8080` by default.

Provisioning extracts only the supported prompt functions from your installed official client into `data/template.json`. It does not execute the installed application's entrypoint or modify ZCode. Vendor prompt text is **not distributed in this repository** and is not covered by this project's MIT license. The extractor fails when its expected bundle structure is absent; do not force it against another release without verification.

The private template also records the provisioning machine's platform, shell, locale, timezone and working directory. Both upstream headers and environment context preserve those original values when the gateway moves to a VPS. This keeps the request consistent with the desktop profile being delegated; it does not grant the gateway access to that desktop's files or tools. Treat this metadata as private and regenerate the template when intentionally moving to a different client profile.

OAuth login prints a one-time authorization link. Open it in your browser, choose the account and authorize. Polling completes in the CLI without a localhost callback. To add a second account, run login again and select a different account in the browser. Reauthorizing the same identity updates its credentials instead of duplicating it. The CLI supports `zai` and `bigmodel` authorization; live verification in the initial release uses Z.ai.

Login also opens your default browser automatically and prints a short clickable link in terminals that support OSC 8 hyperlinks. The full URL remains available for manual copying. Terminal link behavior varies; in Git Bash, Ctrl+click may be required. Use `login zai "Account one" --no-browser` over SSH or when you prefer to open the URL yourself. If browser launch fails, the CLI continues waiting for manual authorization.

If you already signed in using the local ZCode desktop application:

```sh
node --env-file=.env src/cli.ts import-desktop "Desktop account"
```

This imports only your current user's existing login into the encrypted vault. It does not export tokens to the console or alter your desktop profile.

## Multiple accounts

Stop the gateway before running commands that mutate its vault:

```sh
node --env-file=.env src/cli.ts login zai "Account two"
node --env-file=.env src/cli.ts accounts
node --env-file=.env src/cli.ts quota
node --env-file=.env src/cli.ts disable ACCOUNT_ID
node --env-file=.env src/cli.ts enable ACCOUNT_ID
node --env-file=.env src/cli.ts remove ACCOUNT_ID
```

Selection rotates among enabled, model-entitled accounts, with one in-flight request per account. Quota, authentication and transient failures may try another account before any response content is sent. Risk-control rejection code 3012 pauses that account locally for 15 minutes and returns the error without trying to bypass its block. This delay is local policy, not an upstream reset guarantee. Streams are never replayed after output begins. Account credentials that fail authorization require a new login; the gateway does not pretend an undocumented refresh endpoint exists.

`quota` reads reported plan and balance data. Unknown counters remain unknown. The scheduler uses entitlements and provider errors, rather than guessing token balances from missing fields. Promotions are not automatically claimed.

The vault is AES-256-GCM encrypted with a separate master key. One process owns a vault at a time. Stop the service before administration, and back up both encrypted data and the master key securely. After an unclean process exit, verify that its PID is no longer running before removing a stale `data/vault.lock`.

If `accounts`, `login` and `import-desktop` all fail with `Cannot decrypt account vault` (older releases printed `Unsupported state or unable to authenticate data`), the error occurs while opening the gateway vault, before OAuth or desktop import. Restore the original `ZCODE_MASTER_KEY` associated with that `data/accounts.enc`. Keep the current `.env` and encrypted vault as a private backup first. The same error can also indicate a damaged vault, so verify a known matching key before concluding that the file is corrupt.

Do not delete `accounts.enc` or rerun `init` with existing data to recover accounts: a newly generated key cannot unlock the previous vault. `init` refuses to generate keys when an existing vault is present. Keep each deployment's `.env` and data directory paired. When copying a vault between machines, its original master key must accompany it securely; client API keys can be different.

Node's `--env-file=.env` preserves variables already set in the shell, and `ZCODE_MASTER_KEY_FILE` takes priority over `ZCODE_MASTER_KEY`. Check for stale overrides if the correct `.env` still fails. Never paste master keys, client keys, or account tokens into an issue or terminal transcript.

## Choose a package or subscription

Every account defaults to `start-plan`. Active packages, model entitlements, expiry and reported token buckets are discovered from the account. New packages on the same route appear on the next quota refresh. The upstream decides which promotional bucket is charged; the gateway cannot force an arbitrary bucket ID.

```sh
node --env-file=.env src/cli.ts plans
node --env-file=.env src/cli.ts plan ACCOUNT_ID start-plan
node --env-file=.env src/cli.ts plan ACCOUNT_ID coding-plan --key-file /private/subscription-key --models glm-5.3,glm-5.3-flash
```

The subscription key is read from a private file and encrypted inside the vault. Switching routes changes only that account. Reauthorizing an existing identity preserves its chosen route. Coding Plan uses its own subscription Anthropic endpoint and key, independently of Start Plan JWT expiry. This optional route has fixture coverage; a paid account is required for live validation. Unknown subscription counters remain unknown. Switching back to `start-plan` restores discovery from the promotional route. See the [provider's subscription configuration](https://docs.z.ai/devpack/tool/claude).

Billing reads require the original `X-Device-Mid`. Provisioning records it privately from the desktop telemetry file when available. Login and import retain it with the account. A missing device ID can make quota unavailable. Quota expiry timestamps denote the end of a grant, not a promise of daily reset.

OmniRoute custom providers can display counters in **Provider Quotas** using the connection's `providerSpecificData.quotaEndpoint`:

```json
{
  "url": "http://zcode-gateway:8080/api/usage",
  "auth": "bearer",
  "plan": "plan",
  "quotas": {
    "glm-5.3-flash": {
      "total": "quotaBuckets.glm_5_3_flash.total",
      "used": "quotaBuckets.glm_5_3_flash.used",
      "remaining": "quotaBuckets.glm_5_3_flash.remaining",
      "resetAt": "quotaBuckets.glm_5_3_flash.resetAt",
      "displayName": "GLM-5.3-FLASH tokens (grant expiry)"
    },
    "glm-5.3": {
      "total": "quotaBuckets.glm_5_3.total",
      "used": "quotaBuckets.glm_5_3.used",
      "remaining": "quotaBuckets.glm_5_3.remaining",
      "resetAt": "quotaBuckets.glm_5_3.resetAt",
      "displayName": "GLM-5.3 tokens (grant expiry)"
    }
  }
}
```

`quotaBuckets` has dot-free field names because OmniRoute splits mapping paths at dots. `quotas` retains the model IDs. The connection uses its existing gateway client key; no upstream login is exposed to OmniRoute. It shows totals across enabled accounts. `/api/usage` also exposes per-account counters and quota errors. Add mappings for new model buckets when other packages expose them.

## Connect clients

Use your private gateway client key in these examples:

```sh
curl http://127.0.0.1:8080/v1/chat/completions \
  -H "Authorization: Bearer $GATEWAY_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"glm-5.3-flash","messages":[{"role":"user","content":"Hello"}],"stream":true}'
```

For Claude Code and Anthropic-compatible clients:

```sh
export ANTHROPIC_BASE_URL=http://127.0.0.1:8080
export ANTHROPIC_AUTH_TOKEN="$GATEWAY_KEY"
export ANTHROPIC_MODEL=glm-5.3-flash
```

For an OpenAI Chat Completions client, use base URL `http://127.0.0.1:8080/v1`. For a Responses client, use the same base with the Responses wire protocol and model `glm-5.3-flash` or `glm-5.3`.

In OmniRoute, create an **OpenAI-compatible / Chat Completions** provider with the bridge's reachable `/v1` base URL and its client key. Import models from `/v1/models`. A Claude-compatible caller may then use OmniRoute's existing protocol translation. Direct Anthropic access to this bridge is also supported. OmniRoute needs enabled detailed request logs and a client key with No-Log disabled to resolve `previous_response_id`. Send the initial Responses `input` as an array of messages; OmniRoute 3.8.52-web cannot resume string input. With logging disabled, send the complete history instead. Direct bridge continuation uses its own bounded in-memory store. The integration does not enable global prompt logging.

## Docker

Provision and log in on the host first. The container runs as UID 1000 and needs write access to `data/`. On Linux, set the directory ownership appropriately, then:

```sh
docker compose up -d --build
```

The example publishes only `127.0.0.1:8080`. For OmniRoute on a shared private Docker network, remove published ports and connect both containers to that network; use `http://zcode-gateway:8080/v1` as the provider base. Never publish an unauthenticated inference service.

Configuration:

| Variable | Meaning |
|---|---|
| `ZCODE_MASTER_KEY` | Required encryption secret, at least 32 characters |
| `ZCODE_MASTER_KEY_FILE` | Alternative file containing the master key |
| `ZCODE_API_KEYS` | Comma-separated allowed client API keys, each at least 24 characters |
| `ZCODE_API_KEYS_FILE` | Alternative file containing client keys |
| `ZCODE_DATA_DIR` | Private data directory; default `./data` |
| `HOST`, `PORT` | Listen address and port |

Use a reverse proxy with TLS if clients reach the gateway across an untrusted network. OAuth URLs are login-session data: share them only with the account owner. Logs never include upstream tokens, client keys or prompts.

## Limits

- Required ZCode identity/context text adds input tokens and influences model behavior. Caller instructions are merged into the required stable context block, not sent as a fourth system block.
- GLM-5.3 always reasons; requests that disable thinking return a clear error. Effort mapping is minimal/low to low, medium/high to high, xhigh/max to max. See the [provider thinking documentation](https://docs.z.ai/guides/capabilities/thinking).
- Responses history is in memory, scoped by API key, expires after one hour and is limited to 100 records of at most 512 KiB each. Restarting the server clears it. With `store:false`, supply the full history yourself.
- Images require PNG/JPEG/WebP/GIF base64 input. Remote image URLs and other modalities are rejected. Actual image availability depends on the selected model and entitlement.
- Request body limit is 8 MiB and request deadline is 180 seconds. This is not a complete implementation of every OpenAI or Anthropic product feature.
- The gateway is a single-process service; do not run replicas against one vault file. High availability requires a shared transactional account backend, which this release does not provide.

## Verification

```sh
npm test
npm run check
node --env-file=.env scripts/smoke.mjs
node --env-file=.env scripts/tools-smoke.mjs
node --env-file=.env scripts/capabilities-smoke.mjs
```

The live smoke scripts spend a small amount of upstream quota. They cover JSON and SSE on all three protocols, Responses continuation, tool results on all protocols, streamed function deltas, and Flash vision with low reasoning effort. The tools use fixed synthetic results and never call a weather service. The image test generates a red/blue PNG entirely in memory.

Set `TEST_BASE_URL`, `TEST_API_KEY` and `TEST_MODEL` to target another deployment. Set `TEST_STATELESS=1` for the tools test when using OmniRoute without stored request logs. Run sequentially with a single account. Tests using fake accounts establish scheduler behavior; live verification is recorded separately in [docs/verification.md](docs/verification.md).

## Research and provenance

- [TriDefender/zcode-api](https://github.com/TriDefender/zcode-api), inspected at `00501ce0e26e0276b9e858e9149299a62d91c7e5`, helped identify the current request assembly and OAuth flow. This project does not vendor its implementation, dependencies or bundled prompt asset. That revision's license is CC-BY-NC-SA-4.0; older README references to MIT should not be used as its license authority.
- [kyle123740/dsh-zcode-cli-proxy](https://github.com/kyle123740/dsh-zcode-cli-proxy) documents the app-server alternative. This gateway does not host an autonomous coding agent.
- [OmniRoute discussion 9056](https://github.com/cheaper-inference/OmniRoute/discussions/9056) records earlier restrictions. Current behavior must be tested against the account and client release in use.

Application code in this repository is MIT licensed. Private vendor-derived runtime templates and your credentials remain outside the repository.
