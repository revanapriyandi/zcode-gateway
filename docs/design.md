# Design

Approved 2026-10-24: standalone public `revanapriyandi/zcode-gateway`, OAuth multiple accounts, OpenAI Chat Completions and Responses, Anthropic Messages, streaming and function-tool continuation, encrypted storage, Docker and OmniRoute integration.

Node.js 24 native TypeScript, no production dependencies. Protocol conversion, account storage, OAuth, scheduling and HTTP serving remain separate. The bridge never executes requested tools. Required vendor prompt templates are provisioned privately from an installed ZCode client and excluded from Git. Accounts and API clients use distinct credentials. A CLI controls authentication and account management; no public administrative HTTP surface is required.

The service must not silently discard unsupported content or hosted tools. Account fallback is bounded and occurs before inference output; stream failure cannot replay a response already sent. Responses state is bounded, client-scoped and expires. The application is single-process per encrypted vault; replicas require separate vaults.

Live tests require an entitled ZCode account. A second distinct account requires the owner to complete a second OAuth login. Automated multi-account verification must remain distinct from two-live-account proof.
