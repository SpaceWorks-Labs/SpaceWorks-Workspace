import { SpaceWorksLogo } from "@/components/brand/SpaceWorksLogo";
import { Chip } from "@/components/ui/display";

type Card = { key: string; title: string; priority: "High" | "Medium" | "Low"; who: string };
const COLUMNS: { name: string; cards: Card[]; className?: string }[] = [
  { name: "To do", cards: [
    { key: "BOT-14", title: "Order spare stepper drivers", priority: "Low", who: "AR" },
    { key: "BOT-15", title: "Write the LED wall SOP", priority: "Medium", who: "JM" },
  ] },
  { name: "In progress", cards: [
    { key: "BOT-12", title: "Motor driver board", priority: "High", who: "MK" },
    { key: "BOT-9", title: "Log the laser cutter downtime", priority: "Medium", who: "RI" },
  ] },
  { name: "Review", className: "hidden sm:flex", cards: [
    { key: "BOT-11", title: "3D print notes for the gripper", priority: "Low", who: "MK" },
  ] },
];
const TONE = { High: "warning", Medium: "info", Low: "neutral" } as const;
const NAV = ["Home", "My tasks", "Projects", "Chat", "Docs", "Finance"];

/** A concept board drawn with the app's own tokens; sample data, never a claim. */
export function HeroPreview() {
  return (
    <figure className="relative m-0 bg-panel text-ink">
      <figcaption className="flex items-center gap-2 border-b border-line px-4 py-3 text-caption sm:px-6">
        <span aria-hidden className="size-2 rounded-full bg-primary" />
        <span><span className="hidden sm:inline">Space Works / </span>Workspace</span>
        <span className="ml-auto text-ink-muted">Concept preview · sample data</span>
      </figcaption>
      <div className="grid md:grid-cols-[200px_minmax(0,1fr)]">
        <div aria-hidden className="flex items-center gap-4 border-line bg-sidebar px-4 py-3 md:flex-col md:items-stretch md:border-r md:px-5 md:py-6">
          <SpaceWorksLogo variant="symbol" label={null} clearSpace={false} className="md:mb-6" />
          {NAV.map((item) => (
            <span
              key={item}
              className={item === "Projects"
                ? "rounded-md bg-sidebar-active px-3 py-2 text-label font-semibold text-on-sidebar-active"
                : "hidden rounded-md px-3 py-2 text-label text-ink md:block"}
            >
              {item}
            </span>
          ))}
        </div>
        <div data-zoom-target className="min-w-0 px-4 py-5 sm:px-8 sm:py-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-h1 text-ink">Build night</p>
            <span className="text-caption text-ink-muted">Project board</span>
          </div>
          <p className="mt-5 rounded-md border border-line px-4 py-3 text-body-ui text-ink-muted">Tasks, docs and people. All in one search.</p>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {COLUMNS.map((column) => (
              <div key={column.name} className={`flex min-w-0 flex-col gap-3 rounded-xl bg-surface p-3 ${column.className ?? ""}`}>
                <p className="flex items-center justify-between text-label font-semibold text-ink">
                  {column.name}
                  <span className="text-caption tabular-nums text-ink-muted">{column.cards.length}</span>
                </p>
                {column.cards.map((card) => (
                  <div key={card.key} className="flex flex-col gap-2 rounded-xl border border-line bg-panel p-3">
                    <span className="text-caption tabular-nums text-ink-muted">{card.key}</span>
                    <span className="text-body-ui font-semibold text-ink">{card.title}</span>
                    <span className="flex items-center justify-between gap-2">
                      <Chip tone={TONE[card.priority]} size="sm">{card.priority}</Chip>
                      <span aria-hidden className="inline-flex size-7 items-center justify-center rounded-full bg-accent-soft text-caption text-accent-text">{card.who}</span>
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}
