import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardHeader, Callout, PageHeader } from "@/components/ui/display";
import { BoxArt } from "@/components/brand/BoxSpinner";
import { Markdown } from "@/components/assistant/Markdown";
import { BoardroomLive } from "@/components/boardroom/BoardroomLive";
import { BoardroomSessionActions } from "@/components/boardroom/BoardroomSessionActions";
import { BoardroomStatusChip } from "@/components/boardroom/BoardroomStatusChip";
import { prisma } from "@/lib/db";
import { formatDayTime } from "@/lib/format/datetime";
import { hasRoleAtLeast, requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Boardroom session" };

export default async function BoardroomSessionPage({ params }: PageProps<"/w/[workspaceSlug]/boardroom/[sessionId]">) {
  const { workspaceSlug, sessionId } = await params;
  const { user, workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
  const session = await prisma.boardroomSession.findFirst({
    where: { id: sessionId, workspaceId: workspace.id },
    select: {
      id: true,
      title: true,
      question: true,
      status: true,
      rounds: true,
      summary: true,
      createdAt: true,
      createdById: true,
      createdBy: { select: { name: true } },
      seats: { orderBy: { position: "asc" }, select: { id: true, name: true, persona: true } },
      turns: { orderBy: [{ round: "asc" }, { createdAt: "asc" }], select: { id: true, seatId: true, round: true, role: true, content: true } },
    },
  });
  if (!session) notFound();
  const names = new Map(session.seats.map((s) => [s.id, s.name]));
  const seatTurns = session.turns.filter((t) => t.role === "SEAT");
  const nextIndex = seatTurns.length;
  const total = session.seats.length * session.rounds;
  const speaking = session.status === "RUNNING" ? (nextIndex < total ? session.seats[nextIndex % session.seats.length]?.name ?? null : "The moderator") : null;
  const base = `/w/${workspace.slug}/boardroom`;
  const canDelete = session.createdById === user.id || hasRoleAtLeast(membership.role, "ADMIN");

  return (
    <div className="flex flex-col gap-6">
      <BoardroomLive slug={workspace.slug} sessionId={session.id} active={session.status === "DRAFT" || session.status === "RUNNING"} />
      <Link href={base} className="inline-flex w-fit items-center gap-1.5 text-body-ui font-semibold text-accent-text">
        <ArrowLeft aria-hidden className="size-4" /> Boardroom
      </Link>
      <PageHeader
        title={session.title}
        description={`${session.createdBy?.name ?? "Former member"} · ${formatDayTime(session.createdAt, workspace.timezone)}`}
        actions={
          <>
            <BoardroomStatusChip status={session.status} />
            <BoardroomSessionActions slug={workspace.slug} sessionId={session.id} canDelete={canDelete && session.status !== "RUNNING"} exportHref={session.status === "DONE" ? `${base}/${session.id}/export` : null} />
          </>
        }
      />
      <Card>
        <CardHeader title="Question" titleAs="h2" />
        <p className="whitespace-pre-wrap text-body-ui text-ink">{session.question}</p>
        <ul className="mt-4 flex flex-col gap-1.5 border-t border-line pt-4">
          {session.seats.map((seat) => (
            <li key={seat.id} className="text-caption text-ink-secondary"><span className="font-semibold text-ink">{seat.name}</span>: {seat.persona}</li>
          ))}
        </ul>
      </Card>

      {session.status === "FAILED" ? <Callout tone="danger" title="The session stopped early.">The assistant couldn&apos;t finish this debate. Start a new session to try again.</Callout> : null}

      {session.summary ? (
        <Card as="section" aria-labelledby="boardroom-outcome">
          <h2 id="boardroom-outcome" className="mb-3 text-title text-ink">Outcome</h2>
          <Markdown source={session.summary} />
        </Card>
      ) : null}

      <section aria-labelledby="boardroom-transcript" className="flex flex-col gap-4">
        <h2 id="boardroom-transcript" className="text-h4 text-ink">Transcript</h2>
        {Array.from({ length: session.rounds }, (_, i) => i + 1).map((round) => {
          const turns = seatTurns.filter((t) => t.round === round);
          if (turns.length === 0) return null;
          return (
            <div key={round} className="flex flex-col gap-3">
              <h3 className="text-overline text-ink-muted">Round {round}</h3>
              {turns.map((turn) => (
                <Card key={turn.id} as="article" padding="sm">
                  <p className="mb-2 text-label text-ink">{turn.seatId ? names.get(turn.seatId) ?? "Seat" : "Seat"}</p>
                  <Markdown source={turn.content} />
                </Card>
              ))}
            </div>
          );
        })}
        {speaking ? (
          <p className="flex items-center gap-2 text-body-ui text-ink-muted" role="status">
            <BoxArt size={16} /> {speaking} is thinking
          </p>
        ) : seatTurns.length === 0 && session.status === "DRAFT" ? (
          <p className="text-body-ui text-ink-muted">The panel hasn&apos;t started yet.</p>
        ) : null}
      </section>
    </div>
  );
}
