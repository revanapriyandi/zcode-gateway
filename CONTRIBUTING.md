# Contributing to ZCode Gateway

Bug reports, documentation fixes, compatibility updates, and tested improvements are welcome. Use [GitHub Issues](https://github.com/revanapriyandi/zcode-gateway/issues/new/choose) for reproducible problems, feature suggestions, or usage questions. Reports in English or Bahasa Indonesia are welcome.

## Run the project checks

Use Node.js 24.14 or newer. There are no npm production dependencies to install.

```sh
git clone https://github.com/revanapriyandi/zcode-gateway.git
cd zcode-gateway
npm test
npm run check
```

The automated tests run without a ZCode account. They use temporary account vaults and fixture providers. CI runs on Ubuntu and Windows.

## Send a change

1. Fork the repository and create a branch for a focused change.
2. Follow the existing module boundaries and code style. For behavior changes, include a regression test that fails before the fix and passes afterward.
3. Run `npm test`, `npm run check`, and `git diff --check`.
4. Update both README languages when commands, setup, or supported behavior changes.
5. Open a pull request describing the problem, resulting behavior, checks run, and any remaining verification limits.

For ZCode compatibility changes, identify the official client version and the API or bundle behavior that changed. Distinguish fixture checks from live verification. A passing mock claim does not prove a live account can claim an offer.

## Keep private data local

Do not attach `.env`, `data/`, private prompt templates, login URLs, credentials, or account tokens to commits or issues. Share sanitized HTTP status codes, provider error codes, source status, and reproduction steps instead. Vendor prompt text must remain locally provisioned from the official client.

## Scope

The gateway adapts protocols and manages accounts; clients execute requested tools. Automatic promotions use provider-offered free grant actions. Changes that purchase plans, invent eligibility, or bypass provider verification are outside this project's scope.

Contributions follow the repository's [MIT license](LICENSE). Vendor assets retain their original rights.
