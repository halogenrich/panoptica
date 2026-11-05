# Security

How the app protects the lab's data, and what the university's IT needs to host it: [docs/security-and-data.md](docs/security-and-data.md).

## Reporting a problem

If you find a way to see or change data you should not, or anything else that looks like a security problem, tell the maintainers privately (in person, or by a private message to the repository owner). Do not open a public issue and do not test it on the lab's real data. We confirm within a week and say when it is fixed.

## Supported versions

Only the latest release gets fixes. Admins see new releases in Admin settings › Updates.

## Checks on every change

`npm run check` (typecheck, unit tests, server security checks, build) and `npm audit` run on every push and pull request; a release is only published when they pass.
