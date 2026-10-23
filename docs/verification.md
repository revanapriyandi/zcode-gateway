# Verification record

Date: 2026-10-24.

## Automated checks

- Twenty local tests passed, including account encryption and tamper rejection, account rotation and cooldown, lease lifetime, OAuth pending/ready/expiry handling, tool identity preservation, client-key history isolation and streamed output.
- A clean clone of the public repository passed the same twenty tests.
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

OmniRoute 3.8.52-web resolves previous_response_id through its request-log storage. That storage was disabled, so the public OmniRoute test returned previous_response_not_found. A full-history Responses tool continuation passed. Global logging was not enabled by this integration. Direct bridge previous_response_id continuation passed.

Start Plan is the default account route. Package discovery and dot-free quota mapping have automated coverage. The optional Coding Plan subscription route uses a separate credential and endpoint; its billing balance remains unknown and a live paid-subscription request is not claimed.

The independent reviewer could not start because the configured inherited agent model was unavailable. Manual source review and automated/live checks were completed; this is not represented as an independent review.
