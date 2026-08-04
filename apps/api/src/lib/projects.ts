import { and, eq, inArray } from "drizzle-orm";
import { normalizeRepo } from "@bagsy/shared";
import { db } from "../db/client.js";
import { linkedRepos, projects } from "../db/schema.js";
import { newId } from "../lib/crypto.js";

export interface ProjectWithRepos {
  id: string;
  name: string;
  slug: string;
  repos: string[];
}

export function projectSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function reposOfProject(projectId: string): Promise<string[]> {
  const rows = await db
    .select({ repo: linkedRepos.repo })
    .from(linkedRepos)
    .where(eq(linkedRepos.projectId, projectId));
  return rows.map((r) => r.repo).sort();
}

/** The project a linked repo belongs to, with all sibling repos — null when standalone. */
export async function getProjectForRepo(
  orgId: string,
  repo: string,
): Promise<ProjectWithRepos | null> {
  const rows = await db
    .select({ project: projects })
    .from(linkedRepos)
    .innerJoin(projects, eq(linkedRepos.projectId, projects.id))
    .where(and(eq(linkedRepos.orgId, orgId), eq(linkedRepos.repo, normalizeRepo(repo))))
    .limit(1);
  const project = rows[0]?.project;
  if (!project) return null;
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    repos: await reposOfProject(project.id),
  };
}

export async function getProjectBySlug(
  orgId: string,
  slug: string,
): Promise<ProjectWithRepos | null> {
  const rows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.orgId, orgId), eq(projects.slug, projectSlug(slug))))
    .limit(1);
  const project = rows[0];
  if (!project) return null;
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    repos: await reposOfProject(project.id),
  };
}

export async function listProjects(orgId: string): Promise<ProjectWithRepos[]> {
  const rows = await db.select().from(projects).where(eq(projects.orgId, orgId));
  const out: ProjectWithRepos[] = [];
  for (const project of rows) {
    out.push({
      id: project.id,
      name: project.name,
      slug: project.slug,
      repos: await reposOfProject(project.id),
    });
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Attach linked repos to a project. Every repo must already be linked to the
 * org, and a repo can be in at most one project — both are reported, not
 * silently skipped.
 */
export async function addReposToProject(
  orgId: string,
  projectId: string,
  repos: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalized = [...new Set(repos.map(normalizeRepo))];
  if (normalized.length === 0) return { ok: true };

  const rows = await db
    .select()
    .from(linkedRepos)
    .where(and(eq(linkedRepos.orgId, orgId), inArray(linkedRepos.repo, normalized)));
  const byRepo = new Map(rows.map((r) => [r.repo, r]));

  const unlinked = normalized.filter((r) => !byRepo.has(r));
  if (unlinked.length > 0) {
    return {
      ok: false,
      error: `not linked to this team: ${unlinked.join(", ")} (bagsy link-repo first)`,
    };
  }
  const taken = normalized.filter((r) => {
    const row = byRepo.get(r)!;
    return row.projectId !== null && row.projectId !== projectId;
  });
  if (taken.length > 0) {
    return {
      ok: false,
      error: `already in another project: ${taken.join(", ")} (a repo belongs to at most one project)`,
    };
  }

  await db
    .update(linkedRepos)
    .set({ projectId })
    .where(and(eq(linkedRepos.orgId, orgId), inArray(linkedRepos.repo, normalized)));
  return { ok: true };
}

export async function createProject(input: {
  orgId: string;
  name: string;
  repos: string[];
  createdByUserId: string;
}): Promise<{ project: ProjectWithRepos } | { error: string; status: 400 | 409 }> {
  const name = input.name.trim().replace(/\s+/g, " ");
  const slug = projectSlug(name);
  if (!slug) return { error: "project name must contain letters or digits", status: 400 };

  const existing = await getProjectBySlug(input.orgId, slug);
  if (existing) return { error: `project "${slug}" already exists`, status: 409 };

  const [row] = await db
    .insert(projects)
    .values({
      id: newId("prj"),
      orgId: input.orgId,
      name,
      slug,
      createdByUserId: input.createdByUserId,
    })
    .returning();

  const added = await addReposToProject(input.orgId, row!.id, input.repos);
  if (!added.ok) {
    await db.delete(projects).where(eq(projects.id, row!.id));
    return { error: added.error, status: 400 };
  }

  return {
    project: { id: row!.id, name, slug, repos: await reposOfProject(row!.id) },
  };
}

/** Detach a repo from its project — back to standalone semantics; active claims keep working. */
export async function removeRepoFromProject(
  orgId: string,
  projectId: string,
  repo: string,
): Promise<{ ok: true; removed: boolean }> {
  const normalized = normalizeRepo(repo);
  const rows = await db
    .update(linkedRepos)
    .set({ projectId: null })
    .where(
      and(
        eq(linkedRepos.orgId, orgId),
        eq(linkedRepos.repo, normalized),
        eq(linkedRepos.projectId, projectId),
      ),
    )
    .returning({ id: linkedRepos.id });
  return { ok: true, removed: rows.length > 0 };
}

/** Delete a project; member repos return to standalone semantics. */
export async function deleteProject(orgId: string, projectId: string): Promise<void> {
  await db
    .update(linkedRepos)
    .set({ projectId: null })
    .where(and(eq(linkedRepos.orgId, orgId), eq(linkedRepos.projectId, projectId)));
  await db.delete(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)));
}
