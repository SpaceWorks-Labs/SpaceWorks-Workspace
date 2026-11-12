import "server-only";

import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import { publish } from "@/lib/realtime";
import { createAnthropicClient, getAssistantConfig, messageText, modelOptions, streamTurn, usageTotals } from "@/lib/assistant/client";
import { assertAssistantAllowed, recordAssistantUsage } from "@/lib/assistant/usage";
import { moderatorMessage, moderatorSystemPrompt, seatSystemPrompt, seatTurnMessage, type SeatInfo, type TurnInfo } from "@/lib/assistant/boardroomPrompts";

/**
 * Runs a Boardroom session: seats speak one after another in every round
 * (each sees the transcript so far), then a moderator writes the
 * recommendation and dissent. Progress is announced on the realtime stream
 * `boardroom:<id>` (ids only); the page refetches turns.
 *
 * Claimed with a conditional DRAFT → RUNNING update, so starting twice runs
 * once. A session left RUNNING by a crashed process is failed by the
 * assistant's periodic job (`failStaleBoardrooms`).
 */

const STALE_AFTER_MS = 20 * 60_000;

async function announce(workspaceId: string, sessionId: string, type: string, data: Record<string, string | number | null> = {}) {
  await publish(workspaceId, `boardroom:${sessionId}`, { type, data: { sessionId, ...data } });
}

export async function runBoardroomSession(sessionId: string): Promise<"done" | "failed" | "skipped"> {
  const claimed = await prisma.boardroomSession.updateMany({ where: { id: sessionId, status: "DRAFT" }, data: { status: "RUNNING" } });
  if (claimed.count === 0) return "skipped";
  const session = await prisma.boardroomSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: {
      id: true,
      title: true,
      question: true,
      rounds: true,
      createdById: true,
      workspace: { select: { id: true, slug: true, name: true } },
      seats: { orderBy: { position: "asc" }, select: { id: true, name: true, persona: true, model: true } },
    },
  });
  const workspaceId = session.workspace.id;
  await announce(workspaceId, session.id, "boardroom.started");
  const usage = { tokensIn: 0, tokensOut: 0 };
  const count = (reply: Parameters<typeof usageTotals>[0]) => {
    const totals = usageTotals(reply);
    usage.tokensIn += totals.tokensIn;
    usage.tokensOut += totals.tokensOut;
  };
  try {
    const allowed = await assertAssistantAllowed(workspaceId);
    if (!allowed.ok) throw new Error(allowed.error);
    const config = await getAssistantConfig();
    if (!config) throw new Error("not configured");
    const client = createAnthropicClient(config.apiKey);
    const seats: SeatInfo[] = session.seats.map((s) => ({ id: s.id, name: s.name, persona: s.persona }));
    const transcript: TurnInfo[] = [];

    for (let round = 1; round <= session.rounds; round++) {
      for (const seat of session.seats) {
        const model = seat.model ?? config.model;
        const reply = await streamTurn(client, {
          model,
          max_tokens: 4000,
          output_config: { effort: "low" },
          system: seatSystemPrompt({ workspaceName: session.workspace.name, seat, seats, rounds: session.rounds }),
          messages: [{ role: "user", content: seatTurnMessage({ question: session.question, round, rounds: session.rounds, transcript }) }],
          ...modelOptions(model),
        });
        count(reply);
        const content = messageText(reply) || "(No answer this round.)";
        await prisma.$transaction([
          prisma.boardroomTurn.create({ data: { sessionId: session.id, seatId: seat.id, round, role: "SEAT", content } }),
          // Heartbeat for the stale-session sweep.
          prisma.boardroomSession.update({ where: { id: session.id }, data: { updatedAt: new Date() } }),
        ]);
        transcript.push({ seatId: seat.id, seatName: seat.name, round, role: "SEAT", content });
        await announce(workspaceId, session.id, "boardroom.turn", { round, seatId: seat.id });
      }
    }

    const summaryReply = await streamTurn(client, {
      model: config.model,
      max_tokens: 6000,
      output_config: { effort: "medium" },
      system: moderatorSystemPrompt(session.workspace.name),
      messages: [{ role: "user", content: moderatorMessage({ question: session.question, seats, transcript }) }],
      ...modelOptions(config.model),
    });
    count(summaryReply);
    const summary = messageText(summaryReply) || "The moderator could not write a summary.";
    await prisma.$transaction([
      prisma.boardroomTurn.create({ data: { sessionId: session.id, seatId: null, round: session.rounds, role: "MODERATOR", content: summary } }),
      prisma.boardroomSession.update({ where: { id: session.id }, data: { status: "DONE", summary } }),
    ]);
    await recordAssistantUsage({ workspaceId, userId: session.createdById, label: "Boardroom", ...usage }).catch(() => undefined);
    await announce(workspaceId, session.id, "boardroom.done");
    if (session.createdById) {
      await dispatch(workspaceId, {
        type: "boardroom.summary_ready",
        title: `Boardroom summary ready: ${session.title}`.slice(0, 150),
        body: summary.slice(0, 600),
        url: `/w/${session.workspace.slug}/boardroom/${session.id}`,
        recipients: [session.createdById],
        resource: { type: "boardroom_session", id: session.id },
        scope: { boardroomSessionId: session.id },
        data: { sessionId: session.id },
      });
    }
    return "done";
  } catch {
    console.error("[boardroom] session failed");
    await recordAssistantUsage({ workspaceId, userId: session.createdById, label: "Boardroom", ...usage }).catch(() => undefined);
    await prisma.boardroomSession.update({ where: { id: session.id }, data: { status: "FAILED" } });
    await announce(workspaceId, session.id, "boardroom.failed");
    return "failed";
  }
}

/** Fail sessions a crashed process left RUNNING (called by the periodic job). */
export async function failStaleBoardrooms(now: Date) {
  const stale = await prisma.boardroomSession.findMany({ where: { status: "RUNNING", updatedAt: { lt: new Date(now.getTime() - STALE_AFTER_MS) } }, select: { id: true, workspaceId: true }, take: 20 });
  for (const session of stale) {
    const updated = await prisma.boardroomSession.updateMany({ where: { id: session.id, status: "RUNNING" }, data: { status: "FAILED" } });
    if (updated.count) await announce(session.workspaceId, session.id, "boardroom.failed");
  }
}
