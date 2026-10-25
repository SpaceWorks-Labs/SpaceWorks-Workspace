/** Idempotent platform demo records; the demo runner owns the shared workspace. */
export default async function seedPlatformShell(
  prisma,
  { workspaceId, workspace, users },
) {
  if (process.env.NODE_ENV === "production")
    throw new Error("Demo seeds are for development only.");
  const people = Array.isArray(users) ? users : Object.values(users);
  const user = people.find((u) => u?.id);
  if (!user) return;
  const entries = [
    {
      title: "Space Works on GitHub",
      url: "https://github.com/SpaceWorks-Labs",
      description: "Code and tools made by the crew.",
      tags: ["community", "code"],
    },
    {
      title: "Maker project notebook",
      url: "https://example.org/notebook",
      description:
        "A demo link for build notes. Replace it with your crew’s notebook.",
      tags: ["build", "notes"],
    },
  ];
  for (const data of entries) {
    const existing = await prisma.linkItem.findFirst({
      where: { workspaceId, url: data.url },
    });
    const row = existing
      ? await prisma.linkItem.update({ where: { id: existing.id }, data })
      : await prisma.linkItem.create({
          data: { ...data, workspaceId, createdById: user.id },
        });
    await prisma.searchDocument.upsert({
      where: { entityType_entityId: { entityType: "link", entityId: row.id } },
      create: {
        workspaceId,
        entityType: "link",
        entityId: row.id,
        title: row.title,
        body: row.description,
        url: `/w/${workspace.slug}/links#${row.id}`,
      },
      update: { title: row.title, body: row.description },
    });
    await prisma.bookmark.upsert({
      where: {
        workspaceId_userId_entityType_entityId: {
          workspaceId,
          userId: user.id,
          entityType: "link",
          entityId: row.id,
        },
      },
      create: {
        workspaceId,
        userId: user.id,
        entityType: "link",
        entityId: row.id,
      },
      update: {},
    });
    if (!existing)
      await prisma.activityEvent.create({
        data: {
          workspaceId,
          actorId: user.id,
          verb: "created",
          entityType: "link",
          entityId: row.id,
          summary: `Added ${row.title}`,
        },
      });
  }
  if (
    !(await prisma.savedView.findFirst({
      where: {
        workspaceId,
        ownerId: user.id,
        entityType: "link",
        name: "Community links",
      },
    }))
  )
    await prisma.savedView.create({
      data: {
        workspaceId,
        ownerId: user.id,
        entityType: "link",
        name: "Community links",
        query: { filters: { tag: "community" } },
        pinned: true,
      },
    });
  await prisma.notificationPreference.upsert({
    where: {
      workspaceId_userId_category: {
        workspaceId,
        userId: user.id,
        category: "tasks",
      },
    },
    create: {
      workspaceId,
      userId: user.id,
      category: "tasks",
      channels: ["IN_APP", "EMAIL"],
      digestFrequency: "DAILY",
    },
    update: {},
  });
}
