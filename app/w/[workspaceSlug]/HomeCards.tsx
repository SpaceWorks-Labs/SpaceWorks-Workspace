import Link from "next/link";
import { Card, CardHeader, Chip } from "@/components/ui/display";

type Announcement = { id: string; title: string; pinned: boolean; preview: string };

export function HomeAnnouncements({ announcements, base }: { announcements: Announcement[]; base: string }) {
  return (
    <Card>
      <CardHeader
        title="Announcements"
        action={
          <Link className="inline-flex min-h-11 items-center underline" href={`${base}/announcements`}>
            See all
          </Link>
        }
      />
      {announcements.length ? (
        <ul className="divide-y divide-line">
          {announcements.map((a) => (
            <li className="py-3" key={a.id}>
              <Link href={`${base}/announcements/${a.id}`} className="text-title hover:underline">
                {a.title}
              </Link>
              {a.pinned ? (
                <span className="ml-2">
                  <Chip>Pinned</Chip>
                </span>
              ) : null}
              <p className="mt-1 line-clamp-2 text-body-ui text-ink-secondary">{a.preview}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p>
          No announcements yet.{" "}
          <Link className="underline" href={`${base}/announcements`}>
            Visit announcements
          </Link>
        </p>
      )}
    </Card>
  );
}

export function HomeServices({ services, base }: { services: { lastStatus: string; _count: number }[]; base: string }) {
  return (
    <Card>
      <CardHeader
        title="Services status"
        action={
          <Link className="inline-flex min-h-11 items-center underline" href={`${base}/services`}>
            Services
          </Link>
        }
      />
      {!services.length ? <p>No monitors yet. <Link className="underline" href={`${base}/services`}>Open services</Link></p> : null}
      <div className="flex flex-wrap gap-3">
        {services.map((s) => (
          <Chip key={s.lastStatus} tone={s.lastStatus === "DOWN" ? "danger" : s.lastStatus === "UP" ? "success" : "neutral"}>
            {s._count} {s.lastStatus.toLowerCase().replaceAll("_", " ")}
          </Chip>
        ))}
      </div>
    </Card>
  );
}
