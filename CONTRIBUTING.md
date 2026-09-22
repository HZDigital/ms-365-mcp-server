# Contributor Guidelines

Thank you for helping improve the Microsoft 365 MCP Server. We welcome bug
reports, documentation improvements, feature proposals, and code contributions.

## Before You Start

For a bug fix or documentation change, please open an [issue](https://github.com/HZDigital/ms-365-mcp-server/issues),
or comment on an existing one, before submitting a pull request. Include the
issue number in the pull request description.

For a new feature or a change that affects the server's tool surface,
authentication, permissions, configuration, or deployment behavior, please
start a [discussion](https://github.com/HZDigital/ms-365-mcp-server/discussions)
or issue first. Describe the problem, the proposed behavior, affected Microsoft
Graph endpoints or permissions, configuration changes, and any security or
backward-compatibility considerations. This gives maintainers a chance to agree
on the approach before significant implementation work begins.

Small fixes, tests, and documentation improvements do not need a prior proposal.

Please do not report security vulnerabilities in public issues or discussions.
Follow the process in [SECURITY.md](SECURITY.md) instead.

## Our Standards

Help keep the project welcoming, constructive, and focused on the best outcome
for its users. In particular:

- Use respectful, inclusive language.
- Be considerate of different viewpoints and experiences.
- Accept constructive feedback gracefully.
- Keep reviews and discussions focused on the change and its impact.
- Avoid sharing credentials, tokens, tenant data, customer data, or other
  sensitive information in issues, pull requests, logs, or test fixtures.

Maintainers may edit, remove, or reject contributions that do not meet these
standards.

## 1. Development Setup

### Requirements

- Node.js `>= 22.13.0` (see the `engines` field in `package.json`)
- npm, using the committed `package-lock.json`

### Install and verify

```bash
git clone https://github.com/HZDigital/ms-365-mcp-server.git
cd ms-365-mcp-server
npm ci
npm run verify
```

`npm run verify` regenerates the Graph client and then runs linting, formatting
checks, TypeScript checking, a production build, and the complete test suite.
It is the recommended final check before opening a pull request.

Use the following commands while developing:

```bash
npm run dev # Run the server from src/
npm run dev:http # Run the HTTP server locally in organization mode
npm run test # Run the Vitest suite once
npm run test:watch # Run tests in watch mode
npm run lint # Check ESLint rules
npm run lint:fix # Apply safe ESLint fixes
npm run format # Format supported source and documentation files
npm run format:check # Check formatting without changing files
npm run typecheck # Type-check without emitting files
npm run build # Build dist/
```

## 2. Development Notes

### Generated Graph client

The Microsoft Graph client under `src/generated/` is generated code. Do not
hand-edit it. When changing the endpoint definitions, generation pipeline, or
supported Graph API surface, run:

```bash
npm run generate
```

Commit the resulting generated changes when they are relevant to your change.
Generation may download and process the Microsoft Graph OpenAPI specification,
so it requires network access.

### Authentication and test data

Most tests run locally without a Microsoft 365 tenant. Tests or manual checks
that authenticate against Microsoft 365 must use an account and tenant you are
authorized to access. Never commit `.env` files, access tokens, client secrets,
redirect URIs for private environments, or captured Graph responses containing
personal or organizational data.

For local interactive use, see the [local-development instructions](README.md#local-development)
and [authentication documentation](README.md#authentication) in the README.

### Scope and security changes

Changes to tool definitions, Graph permissions, authentication, allowed scopes,
read-only behavior, request routing, logging, cache storage, or outbound actions
need focused tests. Call out any new or broadened Graph permission in the pull
request, and update the README or deployment documentation when user-facing
configuration changes.

`main` triggers Azure deployment workflows. Do not modify deployment workflows,
container configuration, or Azure settings as incidental cleanup; explain and
test those changes explicitly.

## 3. Git Workflow

1. Create a fork if you do not have write access, then create a descriptive
   branch from the latest `main` branch. Use a slash-separated name such as
   `fix/calendar-timezone` or `feat/dataverse-search`.
2. Make a focused change with tests and documentation where appropriate.
3. Run the relevant checks during development and `npm run verify` before
   submitting the pull request.
4. Commit using the conventional commit format described below.
5. Open a pull request against `main`. Link its issue or discussion, describe
   the motivation and implementation, list validation performed, and identify
   any configuration, permission, or deployment impact.

Keep commits focused and easy to review. Rebase or squash a noisy history before
requesting review when appropriate.

## 4. Commit Message Format

This project uses [semantic-release](https://semantic-release.gitbook.io/semantic-release/),
so use [Conventional Commits](https://www.conventionalcommits.org/).

```text
feat: add calendar availability tool
fix(auth): preserve encrypted token cache metadata
docs: clarify OBO deployment settings
test: cover missing site permission
```

Common types are `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, and
`build`. Keep the summary concise and written in the imperative present tense.
Use a scope when it adds useful context, such as `auth`, `graph`, `teams`, or
`dataverse`.

## 5. Pull Request Checklist

Before requesting review, confirm that:

- The pull request is focused and targets `main`.
- Its description links the related issue or discussion and explains how to
  test the change.
- Relevant tests were added or updated, and `npm run test` passes.
- `npm run lint`, `npm run format:check`, `npm run typecheck`, and `npm run build`
  pass; preferably, `npm run verify` passes.
- User-facing behavior, environment variables, CLI options, Graph permissions,
  deployment guidance, and examples are documented in `README.md` or `docs/`
  when changed.
- Generated files are updated when the generation inputs changed.
- No secrets, personal data, tenant-specific settings, or unnecessary build
  artifacts are included.

Maintainers may request changes to preserve backward compatibility, protect the
least-privilege permission model, or keep the MCP tool surface clear and safe.

## 6. Coding and Naming Conventions

- Write new application code in TypeScript and keep the project in ESM style.
- Follow the repository's ESLint and Prettier configuration. Use two-space
  indentation, single quotes, semicolons, trailing commas where supported, and
  a 100-character print width; let `npm run format` enforce the details.
- Use descriptive, lower-case kebab-case branch names. Use descriptive TypeScript
  filenames that match the surrounding code.
- Keep generated code in `src/generated/` separate from handwritten code.
- Prefer small, testable functions. Validate untrusted input and make errors
  actionable without exposing tokens or sensitive request data.
- Preserve existing behavior unless the pull request explicitly documents a
  breaking change.

## 7. Testing Guidance

Place unit and integration-style tests in `test/` and name them `\*.test.ts`.
Tests run with Vitest in the Node environment. Add regression coverage for bugs
and cover both success and failure paths for behavior that affects permissions,
authentication, Graph requests, or mutation safeguards.

When a change modifies generated endpoint definitions, run `npm run generate`
before testing so the test suite exercises the generated client that will be
shipped.

---

For installation, configuration, and deployment details, return to the
[README](README.md).
