# ZCode 3.17 compatibility and automatic offers

Scope: update the existing gateway for the official 3.17.2 client and automatically process provider-offered free grants. Keep Node 24.14+, the encrypted vault, existing protocols and legacy templates. No paid purchases, fabricated eligibility, referral creation or verification bypass.

Evidence: official release v3.17.2, source commit a9fe401eede6e6e5e01be9048679c206fe6f02d9. The Windows release archive matches its published SHA256SUMS. The client uses billing preview/claim and marketing/touch; the old agent/configs CAPTCHA preflight is absent from the current claim flow. Preview grants may omit dates. Claim responses contain the actual grant period. Marketing buttons explicitly distinguish claim_zcode_plan from navigation and external URLs.

Implementation plan:

- [x] Add failing tests for modern template extraction, metadata version discovery and propagation to billing.
- [x] Read the app version from adjacent package metadata/ASAR (or explicit provision argument); extract modern prompt sections without depending on minified symbol names. Preserve legacy extraction and templates.
- [x] Add failing tests for marketing claims, repeated undated offers, grant expiry, HTTP errors, numeric string codes, per-source failures and server time.
- [x] Query billing preview and marketing touch independently. Merge only explicit claim actions and free model grants. Persist real claim expiry, provider retry holds and bounded diagnostic summaries. Refresh entitlements after claims. Stop on login/risk/verification requirements.
- [x] Expose authenticated offer status and add a one-shot claims CLI. Enable automatic claims for new installations, preserving an explicit false opt-out.
- [x] Run all tests and syntax checks, provision from the verified 3.17.2 archive, then perform available authenticated live checks without publishing credentials.
- [x] Update both guides, release notes and CI; publish the verified branch as a pull request and provide a source archive and patch.

Coverage limit: automatically handles the two verified official offer channels. Invitations, paid plans, CAPTCHA, eligibility requirements and future unknown endpoints remain provider-controlled. An empty preview is not proof that no other promotion exists.
