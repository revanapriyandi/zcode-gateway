# ZCode Gateway implementation plan

Goal: implement and publish the approved independently authored gateway and connect its private deployment to OmniRoute.

1. Write failing tests for encrypted account persistence, round-robin selection, cooldown, request conversion and tool continuation. Run with `npm test` before implementing `src/accounts.ts` and `src/protocols.ts`.
2. Implement account vault, scheduler and OpenAI/Anthropic normalized protocol conversion. Verify real file tamper rejection and fixture round trips.
3. Implement OAuth CLI init/poll, validation and timeout, prompt provisioning from the installed official client, upstream HTTP and streaming. Verify via local fake upstreams and direct live calls.
4. Implement authenticated HTTP endpoints and bounded client-scoped Responses history. Verify authentication, malformed requests, SSE output, cancellation, tool results and previous_response_id isolation.
5. Implement the administration CLI, Docker image and documentation. Run checks, complete live protocol tests, and scan tracked files for private material before commit.
6. Provision a private VPS container, register a distinct OmniRoute provider, test public-gateway inference and streaming, and publish the clean repository. Record remaining live-account limitations.
