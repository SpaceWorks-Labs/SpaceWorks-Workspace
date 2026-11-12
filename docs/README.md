# Space Works Workspace documentation

[Project README](../README.md)

The workspace is invite-only and self-hosted. Start with local development,
then the architecture and the area contracts. Operators should read the VPS,
configuration and recovery guides before inviting members.

## Product and engineering

| Guide | Purpose |
| --- | --- |
| [Architecture](ARCHITECTURE.md) | Services, tenancy and data flows |
| [Design](DESIGN.md) | Brand, Design-Kit tokens, accessible controls, voice and layout |
| [Development](DEVELOPMENT.md) | Local installation and daily commands |
| [Configuration](CONFIGURATION.md) | Environment and secret reference |
| [Contributing](../CONTRIBUTING.md) | Branches, changes and verification |
| [Ownership](ROADMAP-BUILD.md) | Area boundaries and shared contracts |
| [Audit, November 2026](AUDIT-2026-11.md) | Codebase size, findings and recommendations |
| [Production audit, October 2026](PRODUCTION_AUDIT_2026-10-29.md) | Earlier production-readiness review |
| [Design fidelity audit](design-audit.md) | Screen-by-screen brand review |

## Integrations and machine access

| Guide | Purpose |
| --- | --- |
| [REST API](API.md) | The `/api/v1` machine API: tasks, projects and scoped tokens |
| [MCP server](MCP.md) | `/api/mcp` for AI clients, OAuth and API-key scopes |
| [Integrations](INTEGRATIONS.md) | Google, GitHub, messaging and other connections |
| [Social](SOCIAL.md) | Social accounts, analytics and comments |
| [App reviews](APP_REVIEWS.md) | Store connections and review replies |
| [Monitoring](MONITORING.md) | Checks, incidents and status pages |

## Deployment and operations

| Guide | Purpose |
| --- | --- |
| [VPS](DEPLOYMENT_VPS.md) | Guided installation, update, backups, settings, recovery and security |
| [Netlify + VPS](DEPLOYMENT_SPLIT.md) | Rendering workspace and private server gateway |
| [Images](CONTAINER_IMAGES.md) | VERSION, releases, GHCR packages and image roles |
| [Docker](DEPLOYMENT_DOCKER.md) | Containers with managed dependencies |
| [Cloud](DEPLOYMENT_CLOUD.md) | Render, Supabase, Upstash, R2, email and cron |
| [Staging](DEPLOYMENT_STAGING.md) | Isolated Compose testing |
| [AWS](DEPLOYMENT_AWS.md) | AWS deployment and managed services |
| [DigitalOcean](../.do/app.yaml) | App Platform spec using release images |
| [Kubernetes](DEPLOYMENT_KUBERNETES.md) | Helm, secrets, probes and migrations |
| [Release](PRODUCTION_RELEASE.md) | Acceptance and rollout |
| [Operations](production-operations.md) | Monitoring, privacy and disaster recovery |

## Feature areas

Work and collaboration

- [tasks](areas/tasks.md): tasks, assignment and the board
- [projects-plus](areas/projects-plus.md): milestones, timeline and reports
- [work-collaboration](areas/work-collaboration.md): meetings, goals, polls and ideas
- [team-calendar](areas/team-calendar.md): internal team calendar
- [chat](areas/chat.md): channels, direct messages and threads
- [docs-files](areas/docs-files.md) and [documents](areas/documents.md): docs, files and generated documents
- [community](areas/community.md): announcements and personal feeds
- [assistant](areas/assistant.md): the AI assistant

People and organisation

- [org-people](areas/org-people.md): organisation, reporting lines and people records
- [people-relationships](areas/people-relationships.md): contacts, pipeline and relationships
- [ops-gaps](areas/ops-gaps.md): leave, rota, help desk and other people tools

Money and governance

- [finance](areas/finance.md), [finance-tools](areas/finance-tools.md) and [ops-money](areas/ops-money.md): ledger, bills, requests and dues
- [recurring-costs](areas/recurring-costs.md): rent, utilities and remittances
- [moneycontrols](areas/moneycontrols.md): money and asset controls
- [funding-tools](areas/funding-tools.md): grants, donations and impact
- [governance-tools](areas/governance-tools.md), [govextras](areas/govextras.md) and [govextras-files](areas/govextras-files.md): compliance, board and safeguarding
- [analytics](areas/analytics.md): reports and exports

Product, marketing, IT and services

- [product-ops](areas/product-ops.md): roadmap, releases and QA
- [marketing-it](areas/marketing-it.md): content, assets and IT registers
- [social](areas/social.md): social analytics
- [app-reviews](areas/app-reviews.md): store review handling
- [monitor](areas/monitor.md): services monitor
- [secrets](areas/secrets.md): application secrets and the `sww` CLI
- [integrations-messaging](areas/integrations-messaging.md) and [integration-finish](areas/integration-finish.md): channels and connections

Platform

- [platform-shell](areas/platform-shell.md): navigation, shell and settings
- [jobs-queue](areas/jobs-queue.md): the BullMQ worker and beat
- [deployment](areas/deployment.md): packaging and split hosting
- [e2e-fix](areas/e2e-fix.md): production hosting smoke tests

Scope and review notes

- [remove-member-facing](areas/remove-member-facing.md): why member-facing features live in sibling apps
- [design-fidelity](areas/design-fidelity.md) and [review-fixes](areas/review-fixes.md): brand and review follow-ups
