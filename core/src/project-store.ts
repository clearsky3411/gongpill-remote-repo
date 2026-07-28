import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface GongpilProjectSummary {
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface GongpilProjectManifest extends GongpilProjectSummary {
  schemaVersion: 1;
}

export class GongpilProjectStoreError extends Error {
  public constructor(code: string, message: string) {
    super(message);
    this.name = "GongpilProjectStoreError";
    this.code = code;
  }

  public readonly code: string;
}

export class GongpilProjectStore {
  public constructor(dataRoot: string) {
    this.dataRoot = dataRoot;
    this.projectsRoot = join(dataRoot, "projects");
  }

  public async Initialize(): Promise<void> {
    await mkdir(this.projectsRoot, { recursive: true });
    await this.EnsureMachineManifest();
  }

  public async ListProjects(): Promise<GongpilProjectSummary[]> {
    await this.Initialize();
    const entries = await readdir(this.projectsRoot, { withFileTypes: true });
    const projects: GongpilProjectSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !this.IsStableId(entry.name)) {
        continue;
      }
      try {
        projects.push(await this.ReadManifest(entry.name));
      }
      catch {
        // 손상되거나 불완전한 폴더는 사용자 목록에 노출하지 않는다.
      }
    }
    return projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  public async CreateProject(name: string): Promise<GongpilProjectSummary> {
    const normalizedName = this.NormalizeProjectName(name);
    await this.Initialize();

    const projectId = `project-${randomUUID()}`;
    const projectRoot = this.GetProjectRoot(projectId);
    const workspaceRoot = join(projectRoot, "workspace");
    const now = new Date().toISOString();
    const manifest: GongpilProjectManifest = {
      schemaVersion: 1,
      projectId,
      name: normalizedName,
      createdAt: now,
      updatedAt: now,
    };

    await mkdir(workspaceRoot, { recursive: true });
    await mkdir(join(projectRoot, "history"), { recursive: true });
    await writeFile(
      join(projectRoot, "project.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    await writeFile(
      join(workspaceRoot, "README.md"),
      `# ${normalizedName}\n\n공필에서 만든 첫 문서입니다.\n`,
      { encoding: "utf8", flag: "wx" },
    );
    return this.ToSummary(manifest);
  }

  public async GetProject(projectId: string): Promise<GongpilProjectSummary> {
    this.RequireProjectId(projectId);
    return await this.ReadManifest(projectId);
  }

  public GetWorkspaceRoot(projectId: string): string {
    return join(this.GetProjectRoot(projectId), "workspace");
  }

  public GetHistoryRoot(projectId: string): string {
    return join(this.GetProjectRoot(projectId), "history");
  }

  public async TouchProject(projectId: string): Promise<void> {
    const manifest = await this.ReadManifest(projectId);
    const updatedManifest: GongpilProjectManifest = {
      schemaVersion: 1,
      ...manifest,
      updatedAt: new Date().toISOString(),
    };
    await this.WriteManifestAtomically(projectId, updatedManifest);
  }

  private async EnsureMachineManifest(): Promise<void> {
    const machineManifestPath = join(this.dataRoot, "machine.json");
    try {
      await writeFile(machineManifestPath, `${JSON.stringify({
        schemaVersion: 1,
        machineId: `machine-${randomUUID()}`,
        createdAt: new Date().toISOString(),
      }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
  }

  private async WriteManifestAtomically(
    projectId: string,
    manifest: GongpilProjectManifest,
  ): Promise<void> {
    const projectRoot = this.GetProjectRoot(projectId);
    const manifestPath = join(projectRoot, "project.json");
    const tempPath = join(projectRoot, `.project-${randomUUID()}.tmp`);
    let fileHandle;
    try {
      fileHandle = await open(tempPath, "wx");
      await fileHandle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      await fileHandle.sync();
      await fileHandle.close();
      fileHandle = undefined;
      await rename(tempPath, manifestPath);
    }
    finally {
      await fileHandle?.close();
      await rm(tempPath, { force: true });
    }
  }

  private GetProjectRoot(projectId: string): string {
    this.RequireProjectId(projectId);
    return join(this.projectsRoot, projectId);
  }

  private async ReadManifest(projectId: string): Promise<GongpilProjectSummary> {
    this.RequireProjectId(projectId);
    let manifest: Partial<GongpilProjectManifest>;
    try {
      manifest = JSON.parse(await readFile(
        join(this.GetProjectRoot(projectId), "project.json"),
        "utf8",
      ));
    }
    catch (error) {
      throw new GongpilProjectStoreError("PROJECT_NOT_FOUND", "프로젝트를 찾지 못했습니다.");
    }
    if (
      manifest.schemaVersion !== 1
      || manifest.projectId !== projectId
      || typeof manifest.name !== "string"
      || typeof manifest.createdAt !== "string"
      || typeof manifest.updatedAt !== "string"
    ) {
      throw new GongpilProjectStoreError("PROJECT_MANIFEST_INVALID", "프로젝트 정보가 손상됐습니다.");
    }
    return this.ToSummary(manifest as GongpilProjectManifest);
  }

  private NormalizeProjectName(name: string): string {
    const normalizedName = name.trim().replace(/\s+/g, " ");
    if (normalizedName.length < 1 || normalizedName.length > 100) {
      throw new GongpilProjectStoreError(
        "PROJECT_NAME_INVALID",
        "프로젝트 이름은 1자 이상 100자 이하여야 합니다.",
      );
    }
    return normalizedName;
  }

  private RequireProjectId(projectId: string): void {
    if (!this.IsStableId(projectId) || !projectId.startsWith("project-")) {
      throw new GongpilProjectStoreError("PROJECT_ID_INVALID", "프로젝트 ID가 올바르지 않습니다.");
    }
  }

  private IsStableId(value: string): boolean {
    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
  }

  private ToSummary(manifest: GongpilProjectManifest): GongpilProjectSummary {
    return {
      projectId: manifest.projectId,
      name: manifest.name,
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt,
    };
  }

  private readonly dataRoot: string;
  private readonly projectsRoot: string;
}
