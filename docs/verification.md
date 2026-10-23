# Verification record

Date: 2026-10-24.

## Automated checks

- Twenty-one local tests passed, including account encryption and tamper rejection, account rotation and cooldown, lease lifetime, OAuth pending/ready/expiry handling, tool identity preservation, client-key history isolation and streamed output.
- A clean clone of the public repository passed the same twenty-one tests.
- Node syntax checks passed and the production Docker image built successfully.

## Live checks

Using owner-authorized Z.ai accounts with active Start Plan entitlements:

- GLM-5.3 and GLM-5.3-Flash responded to ordinary model requests.
- JSON and SSE succeeded for Chat Completions, Responses and Anthropic Messages through the VPS bridge.
- Responses previous_response_id continuation succeeded.
- Function call, synthetic tool result and continuation succeeded for Chat Completions, Responses and Anthropic Messages. The test harness supplied a fixed result; no external tool executed.
- Streamed Chat Completions function deltas and terminal tool_calls finish reason succeeded.
- Flash base64 image input, low reasoning effort and a sampling parameter succeeded through the public OmniRoute gateway using an in-memory red/blue PNG.
- OmniRoute Provider Quotas resolved actual token counters from both GLM model buckets through the custom quota endpoint. Grant expiry is displayed with an explicit label, not described as a daily reset.
- Anthropic tool results, Responses tool results using full history, and streamed Chat function deltas succeeded through public OmniRoute.
- The deployed bridge was registered in the owner's OmniRoute. Its catalog exposed zcg/glm-5.3-flash and zcg/glm-5.3. Public gateway Chat Completions and SSE succeeded.
- The real ZCode OAuth initialization endpoint issued a valid authorization flow. The automated polling tests exercised successful completion; a fresh live browser-consent completion has not yet been independently verified. The initial live account was imported from the owner's authenticated desktop profile.

Two distinct real accounts were imported from successive owner-authorized desktop logins. Billing and model inference succeeded independently for both after switching the desktop account, so the older plan token had not been revoked. Both accounts are enabled in the deployed pool. Two concurrent public OmniRoute requests completed successfully. The Provider Quotas response reported an aggregate grant of 600,000,000 Flash tokens and 400,000,000 GLM-5.3 tokens across the two accounts. Failure-path scheduling and bounded retries are verified with synthetic accounts; a forced failure of a real provider account is not claimed.

GitHub Actions did not execute its test steps: GitHub reported that the owner's account was locked due to a billing issue. This is separate from the passing local and clean-clone tests. See workflow runs for their current state.

No account credential, master key, private vendor prompt template or environment file is included in the public repository. Runtime files are provisioned separately.

## Compatibility boundaries

Initially, OmniRoute request detail storage was disabled, so public previous_response_id returned previous_response_not_found. After the owner explicitly requested logging, detailed storage and management-key logging were enabled; array-input continuation passed. At that stage individual customer No-Log preferences were preserved; the owner subsequently requested logging for every key and the default was aligned accordingly. See follow-up verification below.

Start Plan is the default account route. Package discovery and dot-free quota mapping have automated coverage. The optional Coding Plan subscription route uses a separate credential and endpoint; its billing balance remains unknown and a live paid-subscription request is not claimed.

The independent reviewer could not start because the configured inherited agent model was unavailable. Manual source review and automated/live checks were completed; this is not represented as an independent review.

## Follow-up verification

Owner-requested detailed request logging was enabled in OmniRoute along with logging for the management test key; customer keys initially retained individual No-Log preferences; the owner later requested all keys use logging by default. Responses previous_response_id with function tools passed through public OmniRoute when the initial input was an array of messages. The earlier string-input test cannot be resumed by OmniRoute 3.8.52-web because its history reader requires an array.

Low, high and max effort requests all succeeded. The persisted OmniRoute pipeline recorded the same reasoning_effort value in clientRawRequest.body and providerRequest.body for each level. This establishes parameter forwarding, not a quantified change in model quality or internal compute. Discovery metadata was configured to advertise the three supported effort levels.

The subsequent owner instruction enabled per-key logging by default: all 13 existing router keys were read back with noLog=false, and the portal createKey/applyPlan defaults were updated to false in commit 6b2dacf. Detail retention remains 30 days. Management uses an existing oma_ access token; /v1/models needs a separate router service API key on this OmniRoute release. Upstream provider credentials are not used as platform-management credentials.

## Local CLI recovery and login links

The owner's local vault could not be opened with the current local master key; its original deployment key decrypted both saved accounts. The local configuration was backed up privately and restored without deleting the vault. Desktop import then succeeded for the existing second account, and live OAuth initialization succeeded. This confirms local vault recovery and flow initialization, not a new completed browser-consent flow.

The CLI now explains vault authentication failures and refuses `init` when an existing vault has no matching environment file. Login opens the default browser, provides OSC 8 links in interactive terminals, and supports `--no-browser`. Twenty-six local tests passed, including wrong-key preservation, initialization refusal, launcher argument handling, terminal-link validation and browser-launch fallback. Syntax checks passed for ten source modules. Actual link click behavior depends on the terminal's OSC 8 support; browser-launch tests use an injected launcher. The Indonesian guide is available in `README.id.md`.
