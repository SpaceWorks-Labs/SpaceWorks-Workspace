import { HomeActivity } from "./HomeActivity";
import { HomeAnnouncements, HomeServices } from "./HomeCards";
import { DashboardLayout } from "@/components/ui/layouts";
import Link from "next/link";
import { QuickCreateButtons } from "@/components/command-palette/QuickCreate";
import {
  Card,
  CardHeader,
  Chip,
  EmptyState,
  PageHeader,
  StatTile,
} from "@/components/ui/display";
import { getDashboardData } from "@/lib/dashboard";
import {
  formatDayTime,
  formatTimeZoneName,
} from "@/lib/format/datetime";
import { formatMoney } from "@/lib/format/money";
import { requireWorkspace } from "@/lib/permissions";
import { canContribute } from "@/lib/roles";
import { taskUrl } from "@/lib/tasks/links";
import { shellMessage } from "@/lib/shell/messages";
export const metadata = { title: "My day" };
export default async function WorkspaceHome({
  params,
}: PageProps<"/w/[workspaceSlug]">) {
  const { workspaceSlug } = await params;
  const { user, workspace, membership } = await requireWorkspace(workspaceSlug);
  const d = await getDashboardData(workspace, user.id, membership);
  const base = `/w/${workspace.slug}`;
  const tz = workspace.timezone;
  const upcoming = [
    ...d.meetings.map((m) => ({
      ...m,
      href: `${base}/meetings/${m.id}`,
      kind: "Meeting",
    })),
    ...d.shifts.map((s) => ({
      id: s.id,
      title: s.shiftType.name,
      startsAt: s.startsAt,
      href: `${base}/rota`,
      kind: "Shift",
    })),
  ]
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .slice(0, 8);
  return (
    <DashboardLayout
      header={<PageHeader
        kicker={workspace.name}
        title={shellMessage(workspace.defaultLocale, "home")}
        description={`${user.name ? `Hello, ${user.name.split(" ")[0]}. ` : ""}${workspace.tagline ?? "Make room for your next good build."}`}
      />}
      stats={<section
        aria-label="Overview"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        <StatTile
          label="My open tasks"
          value={d.myOpenTasks}
          href={d.show.myTasks ? `${base}/my-tasks` : undefined}
        />
        <StatTile
          label="Members"
          value={d.memberCount}
          href={`${base}/members`}
        />
        <StatTile
          label="Coming up"
          value={upcoming.length}
          href={d.show.meetings ? `${base}/meetings` : undefined}
        />
        {d.kittyMinor !== null ? (
          <StatTile
            label="The kitty"
            value={formatMoney(d.kittyMinor, workspace.currency)}
            href={`${base}/finance`}
          />
        ) : (
          <StatTile
            label="Unread mentions"
            value={d.mentions.length}
            href={`${base}/notifications?tab=mentions`}
          />
        )}
      </section>}
      actions={<nav aria-label="Quick actions" className="flex flex-wrap gap-3">
        {canContribute(membership) ? (
          <QuickCreateButtons slug={workspaceSlug} userId={user.id} />
        ) : null}
        <Link
          className="inline-flex min-h-11 items-center px-3 underline"
          href={`${base}/search`}
        >
          Search workspace
        </Link>
        {d.show.links ? <Link
          className="inline-flex min-h-11 items-center px-3 underline"
          href={`${base}/links`}
        >
          Links
        </Link> : null}
      </nav>}
      rail={d.show.activity ? <HomeActivity activity={d.activity} base={base} tz={tz} /> : null}
    >
      {!d.myTasks.length && !upcoming.length && !d.announcements.length && !d.activity.length ? (
        <EmptyState patch title={d.show.projects ? "No plans yet. Find a project for the next build night." : "Nothing new yet."} action={d.show.projects ? <Link href={`${base}/projects`} className="inline-flex min-h-11 items-center font-semibold text-accent-text underline">Browse projects →</Link> : undefined} />
      ) : null}
      {d.show.myTasks ? (
            <Card>
              <CardHeader
                title="My tasks"
                action={
                  <Link
                    className="inline-flex min-h-11 items-center underline"
                    href={`${base}/my-tasks`}
                  >
                    See all
                  </Link>
                }
              />
              {d.myTasks.length ? (
                <ul className="divide-y divide-line">
                  {d.myTasks.map((task) => (
                    <li key={task.id} className="flex items-center gap-3 py-3">
                      <Link
                        className="min-w-0 flex-1 break-words text-label underline-offset-4 hover:underline"
                        href={taskUrl(
                          workspaceSlug,
                          task.project?.key,
                          task.number,
                        )}
                      >
                        {task.title}
                        <span className="mt-1 block text-caption text-ink-muted">
                          {task.project?.key ?? "Task"}-{task.number}
                          {task.dueAt
                            ? ` · ${formatDayTime(task.dueAt, tz)}`
                            : ""}
                        </span>
                      </Link>
                      {task.dueAt ? (
                        <Chip tone={task.dueAt < d.now ? "danger" : "neutral"}>
                          {task.dueAt < d.now ? "Overdue" : "Due"}
                        </Chip>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  No tasks assigned.{" "}
                  {d.show.projects ? <Link className="underline" href={`${base}/projects`}>
                    Browse projects
                  </Link> : null}
                </p>
              )}
            </Card>
          ) : null}
          {d.show.meetings || d.show.shifts ? <Card>
            <CardHeader
              title="Upcoming"
              description={`Times in ${formatTimeZoneName(d.now, tz)}`}
              action={d.show.meetings ?
                <Link
                  className="inline-flex min-h-11 items-center underline"
                  href={`${base}/meetings`}
                >
                  Meetings
                </Link> : undefined
              }
            />
            {upcoming.length ? (
              <ul className="divide-y divide-line">
                {upcoming.map((e) => (
                  <li
                    className="flex items-center gap-3 py-3"
                    key={`${e.kind}:${e.id}`}
                  >
                    <Link
                      href={e.href}
                      className="min-w-0 flex-1 break-words text-label hover:underline"
                    >
                      {e.title}
                      <span className="block text-caption text-ink-muted">
                        {formatDayTime(e.startsAt, tz)}
                      </span>
                    </Link>
                    <Chip tone="info">{e.kind}</Chip>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                Nothing planned.{" "}
                {d.show.meetings && canContribute(membership) ? <Link className="underline" href={`${base}/meetings`}>
                  Schedule a meeting
                </Link> : null}
              </p>
            )}
          </Card> : null}
          {d.show.announcements ? <HomeAnnouncements announcements={d.announcements} base={base} /> : null}
          {d.mentions.length ? (
            <Card>
              <CardHeader title="Mentions" />
              <ul className="divide-y divide-line">
                {d.mentions.map((n) => (
                  <li key={n.id}>
                    <Link
                      className="block min-h-11 py-3 text-label hover:underline"
                      href={`${base}/notifications?tab=mentions`}
                    >
                      {n.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {d.unrepliedLowRatings !== null ? <StatTile label="Unreplied low ratings" value={d.unrepliedLowRatings} href={`${base}/app-reviews?replied=no&sort=lowest`} /> : null}
          {d.show.services ? <HomeServices services={d.services} base={base} /> : null}
    </DashboardLayout>
  );
}
