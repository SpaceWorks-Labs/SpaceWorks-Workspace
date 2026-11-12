import { CopyCommand } from "@/components/landing/CopyCommand";
import { DEPLOY_TARGETS } from "@/components/landing/content-docs";
import { INSTALL_COMMAND, repoFile } from "@/components/landing/content";
import { Eyebrow, ExternalLink, SectionTitle } from "@/components/landing/parts";

// From install.sh's own guide ("What you need" and "What it does").
const NEEDS = [
  ["A 64-bit Linux server", "x86_64 or arm64: Ubuntu, Debian, Fedora, RHEL, Alma, Rocky, Arch or openSUSE"],
  ["4 GB memory and 10 GB disk", "the installer offers swap when memory is short"],
  ["root, or a user with sudo", "Docker and Docker Compose are installed if missing"],
  ["A hostname", "with a DNS A record pointing at the server, ports 80 and 443 open"],
  ["An SMTP relay", "on a verified sending domain, and your super-admin email address"],
] as const;

const STEPS = [
  "Checks this server and downloads the latest release",
  "Asks every question, shows a summary and waits for you",
  "Installs to /opt/spaceworks-workspace and starts it with PostgreSQL, Redis, Silo object storage and Caddy HTTPS",
  "Optionally: nightly encrypted backups, a firewall, security updates and automatic deploys",
];

/** 03: the teal installer band, with the terminal pinned beside the checklist on wide screens. */
export function InstallSection() {
  return (
    <section id="install" aria-labelledby="landing-install-title" className="landing-teal landing-section bg-primary text-on-primary">
      <div className="landing-wrap grid items-start gap-x-16 gap-y-10 md:grid-cols-[1.15fr_1fr] lg:gap-x-[100px]">
        <div data-reveal>
          <Eyebrow>03 / Yours to run</Eyebrow>
          <SectionTitle id="landing-install-title">One command.<br />Your own server.</SectionTitle>
          <p className="mt-6 max-w-[34rem] text-body-l">The installer asks every question first and changes nothing until you confirm. It sets up Docker, generates secrets, pulls the release images and runs the migrations.</p>
          <h3 className="mt-10 text-label font-semibold">What you need</h3>
          <ul className="mt-2">
            {NEEDS.map(([title, body]) => (
              <li key={title} className="landing-band-line border-b py-4">
                <span className="block text-lg font-semibold leading-snug">{title}</span>
                <span className="mt-1 block text-body-ui">{body}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0 md:sticky md:top-8 md:row-span-2 md:pt-11">
          <div data-reveal className="yy-dark-band overflow-hidden rounded-xl bg-inverse text-on-inverse">
            <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3 text-label">
              <span>On a Linux server</span>
              <CopyCommand text={INSTALL_COMMAND} />
            </div>
            <pre className="code-text m-0 whitespace-pre-wrap break-words px-5 pt-6 pb-2 text-body-ui leading-7 [overflow-wrap:anywhere]">
              <span className="text-on-inverse">$ <code className="code-text">{INSTALL_COMMAND}</code></span>
            </pre>
            <ol className="code-text px-5 pt-3 pb-6 text-body-ui leading-7 text-ink-muted">
              {STEPS.map((step, index) => <li key={step} className="grid grid-cols-[2ch_1fr] gap-2"><span className="tabular-nums">{index + 1}.</span>{step}</li>)}
              <li aria-hidden className="pt-2"><span className="landing-cursor" /></li>
            </ol>
          </div>
          <p className="mt-6 max-w-[30rem] text-body-ui leading-relaxed">
            Run the same command later to update, back up, check or change settings. Prefer to read it first?{" "}
            <ExternalLink href={repoFile("install.sh")} arrow={false} className="font-semibold underline underline-offset-4">Read install.sh</ExternalLink>
          </p>
        </div>
        <div data-reveal>
          <h3 className="text-label font-semibold">Other ways to deploy</h3>
          <ul className="mt-2 grid gap-x-6 sm:grid-cols-2">
            {DEPLOY_TARGETS.map((target) => (
              <li key={target.title} className="landing-band-line border-b py-4">
                <ExternalLink href={target.href} className="text-body">{target.title}</ExternalLink>
                <span className="mt-1 block text-caption">{target.body}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
