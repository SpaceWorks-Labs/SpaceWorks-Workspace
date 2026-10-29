# Patched standard Caddy image

The bundled edge keeps Caddy **2.11.7** and all its standard modules. Its Go build
uses the official **1.26.10** builder, with `golang.org/x/net` **0.62.0** and
`github.com/go-jose/go-jose/v4` **4.1.6** and `github.com/go-chi/chi/v5` **5.4.0**
selected in the checked-in module lock.
`go mod verify` checks downloaded modules against `go.sum`; `-mod=readonly`
prevents compilation from silently changing the dependency selection.

The final stage inherits the digest-pinned official Caddy image, upgrades its
Alpine packages, and replaces only the Caddy executable. It retains the official
root user, `/srv`, `/config`, `/data`, stock configuration, exposed ports and
command. The replacement executable receives the original privileged-port
capability again. Alpine repository security updates are resolved when rebuilding;
record the resulting image digest and package versions with each release.

```bash
docker build -t spaceworks-caddy:2.11.7-security-20261029 docker/caddy
docker run --rm spaceworks-caddy:2.11.7-security-20261029 caddy version
```

Setup (published app images or source), upgrades and compose smoke all build the
edge locally. No unpublished registry image is required. An installation behind
its own reverse proxy skips this build. Upgrades include these build sources in
their saved/replaced host bundle.

## Remaining advisory assessment

The standard module graph retains `github.com/go-jose/go-jose/v3` **3.0.5**. Its
upstream JWK/RSA parsing advisory lists **no patched v3 release**. The actual
executable contains `JSONWebKey.UnmarshalJSON`, `rawJSONWebKey.rsaPrivateKey`
and `ParseSigned`; updating Go and v4 does not remove this vulnerable code.

The shipped single/split reverse-proxy Caddyfiles across the four apps enable no
`acme_server`, JWK ingestion or certificate-provisioner HTTP handler. Smallstep's
ACME-server middleware calls the v3 parser; the outbound ACME client uses v4.
The internal issuer signs locally generated X.509 certificates. In actual runtime
testing, the adapted stock configuration had no ACME-server handler, public
`/acme/new-account` traffic reached the application, and trusted internal TLS,
proxy headers, hidden internal jobs and unchanged standard module IDs all passed.

Binary `govulncheck` 1.9.0 ran at symbol level. Its database timestamp was
2026-10-27T21:16:18Z and did not yet include this JOSE advisory, so its absence in
that report is not proof of safety. Raw Trivy retains the high advisory. Adding
an ACME server, custom JWK handling, or exposing the administrative configuration
API changes the assessment. This is a configured-path assessment, not a removal
of vulnerable code. OpenPGP remains an unmaintained transitive dependency; shipped
proxy routes do not configure it. No source call-graph analysis was completed.

The first patched candidate removed the original OS/Go/v4 high findings; its
symbol scan also identified two fixable HTML issues, prompting the x/net 0.62
lock update; the complete raw scan identified the fixed Chi 5.4.0 release too.
The final image was rebuilt and independently scanned without suppressions:

`sha256:0956bb7459167ed6f47cc9fbb29e2d3ddb452f7ba1b7313f175a1ebd74c91293`

Its extracted executable confirms Go 1.26.10, Caddy 2.11.7, x/net 0.62.0,
Chi 5.4.0 and JOSE v4.1.6. Trusted HTTPS using its generated local CA explicitly
negotiated HTTP/2 version 2. Reverse proxying, trusted-header sanitation, internal
job denial, disabled public ACME-server routing and standard-module parity passed.
The final raw scan retains **0 critical, 1 high, 2 medium and 1 unknown** findings:
only the unpatched JOSE v3 and unmaintained OpenPGP entries described here.
The repeated binary symbol scan reports OpenPGP; its database still predates
the JOSE advisories, so that absence does not establish safety.
Keep both raw scans. Removing PKI/ACME modules or backporting cryptographic
dependency code requires a separate reviewed change.

| Known finding | Final lock disposition |
| --- | --- |
| CVE-2026-114437, Chi forwarded-client IP middleware | Patched Chi 5.4.0 |
| CVE-2026-78661 and CVE-2026-97045, x/net HTML parsing/rendering | Patched x/net 0.62.0 |
| CVE-2026-116585, CVE-2026-116586, CVE-2026-116587, Go JOSE v3 | No fix listed; retain raw two medium/one high findings and the configured-path assessment above |
| GO-2026-5932, unmaintained OpenPGP | No fix listed; retained standard dependency, unused by shipped proxy configuration |

## Build resources

The first cold Go compilation took 164.8 seconds with two CPUs; the whole
BuildKit cgroup peaked at 2.21 GiB, including module/filesystem caches, under a
3 GiB limit. Allow at least 4 GiB RAM with swap and headroom for running app/data
services during upgrades. Published-app installations also compile this edge.
An external reverse proxy skips it. Dependency downloads add network-dependent
time; subsequent builds reuse the independent module/compiler cache mounts.

Primary references:

- [Official manual build instructions](https://caddyserver.com/docs/build)
- [Caddy 2.11.7 release](https://github.com/caddyserver/caddy/releases/tag/v2.11.7)
- [Official image sources](https://github.com/caddyserver/caddy-docker)
- [Go security releases](https://go.dev/doc/devel/release)
- [Go JOSE advisory](https://github.com/go-jose/go-jose/security/advisories/GHSA-mgcc-cww5-fp2q)
- [Chi advisory](https://github.com/advisories/GHSA-j6qf-3m9c-vwj3)
- [Alpine Brotli package](https://pkgs.alpinelinux.org/package/v3.23/main/x86_64/brotli-libs)
