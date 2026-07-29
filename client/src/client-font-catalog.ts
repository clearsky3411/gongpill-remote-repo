import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";

const FONT_EXTENSIONS = new Set([".otf", ".ttc", ".ttf"]);
const MAX_USER_FONT_BYTES = 32 * 1024 * 1024;

export interface GongpilClientFontFile {
  fileName: string;
  sha256: string;
  bytes: number;
  families: string[];
}

export interface GongpilClientBundledFont {
  id: string;
  displayName: string;
  role: "ui" | "monospace";
  version: string;
  sourceUrl: string;
  licenseId: string;
  preferredFamily: string;
  files: GongpilClientFontFile[];
}

export interface GongpilClientFontLicense {
  id: string;
  name: string;
  fileName: string;
  sourceUrl: string;
}

export interface GongpilClientFontCatalog {
  schemaVersion: 1;
  fontsRoot: string;
  fonts: GongpilClientBundledFont[];
  licenses: GongpilClientFontLicense[];
}

export interface GongpilClientUserFontFile {
  id: string;
  fileName: string;
  path: string;
  bytes: number;
  sha256: string;
}

export async function LoadClientFontCatalog(appRoot: string): Promise<GongpilClientFontCatalog> {
  if (!isAbsolute(appRoot)) {
    throw new Error("appRoot는 절대 경로여야 합니다.");
  }
  const fontsRoot = resolve(appRoot, "client", "resources", "fonts");
  const manifestPath = join(fontsRoot, "font-manifest.json");
  const manifest = ParseFontManifest(JSON.parse(RemoveByteOrderMark(await readFile(manifestPath, "utf8"))));
  const rootRealPath = await realpath(fontsRoot);

  for (const license of manifest.licenses) {
    await RequireRegularContainedFile(rootRealPath, join(fontsRoot, "licenses", license.fileName));
  }
  for (const font of manifest.fonts) {
    for (const file of font.files) {
      const fontPath = await RequireRegularContainedFile(rootRealPath, join(fontsRoot, file.fileName));
      const bytes = await readFile(fontPath);
      if (bytes.byteLength !== file.bytes) {
        throw new Error(`번들 글꼴 크기가 manifest와 다릅니다: ${file.fileName}`);
      }
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (sha256 !== file.sha256) {
        throw new Error(`번들 글꼴 checksum이 올바르지 않습니다: ${file.fileName}`);
      }
    }
  }

  return {
    schemaVersion: 1,
    fontsRoot,
    fonts: manifest.fonts,
    licenses: manifest.licenses,
  };
}

export async function ListClientUserFontFiles(fontRoot: string): Promise<GongpilClientUserFontFile[]> {
  if (!isAbsolute(fontRoot)) {
    throw new Error("fontRoot는 절대 경로여야 합니다.");
  }
  await mkdir(fontRoot, { recursive: true });
  const rootRealPath = await realpath(fontRoot);
  const entries = await readdir(rootRealPath, { withFileTypes: true });
  const files: GongpilClientUserFontFile[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en-US"))) {
    const extension = extname(entry.name).toLocaleLowerCase("en-US");
    if (!FONT_EXTENSIONS.has(extension)) {
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`사용자 글꼴은 일반 파일이어야 합니다: ${entry.name}`);
    }
    const fontPath = await RequireRegularContainedFile(rootRealPath, join(rootRealPath, entry.name));
    const stat = await lstat(fontPath);
    if (stat.size <= 0 || stat.size > MAX_USER_FONT_BYTES) {
      throw new Error(`사용자 글꼴 크기가 허용 범위를 벗어났습니다: ${entry.name}`);
    }
    const bytes = await readFile(fontPath);
    files.push({
      id: `user:${entry.name.toLocaleLowerCase("en-US")}`,
      fileName: entry.name,
      path: fontPath,
      bytes: stat.size,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return files;
}

function ParseFontManifest(value: unknown): Omit<GongpilClientFontCatalog, "fontsRoot"> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Client Package 글꼴 manifest 형식이 올바르지 않습니다.");
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.fonts) || !Array.isArray(candidate.licenses)) {
    throw new Error("Client Package 글꼴 manifest 버전을 지원하지 않습니다.");
  }
  const licenses = candidate.licenses.map(ParseLicense);
  const licenseIds = new Set(licenses.map((license) => license.id));
  if (licenseIds.size !== licenses.length) {
    throw new Error("Client Package 글꼴 license ID가 중복되었습니다.");
  }
  const fonts = candidate.fonts.map((font) => ParseBundledFont(font, licenseIds));
  const fontIds = new Set(fonts.map((font) => font.id));
  if (fontIds.size !== fonts.length) {
    throw new Error("Client Package 글꼴 ID가 중복되었습니다.");
  }
  return { schemaVersion: 1, fonts, licenses };
}

function ParseLicense(value: unknown): GongpilClientFontLicense {
  const candidate = RequireRecord(value, "글꼴 라이선스");
  return {
    id: RequireId(candidate.id, "license ID"),
    name: RequireText(candidate.name, "license 이름", 200),
    fileName: RequireSafeRelativeFile(candidate.fileName, ".txt", "license 파일"),
    sourceUrl: RequireHttpsUrl(candidate.sourceUrl, "license 출처"),
  };
}

function ParseBundledFont(
  value: unknown,
  licenseIds: ReadonlySet<string>,
): GongpilClientBundledFont {
  const candidate = RequireRecord(value, "번들 글꼴");
  const role = candidate.role;
  if (role !== "ui" && role !== "monospace") {
    throw new Error("번들 글꼴 역할이 올바르지 않습니다.");
  }
  const licenseId = RequireId(candidate.licenseId, "글꼴 license ID");
  if (!licenseIds.has(licenseId)) {
    throw new Error(`번들 글꼴 license를 찾을 수 없습니다: ${licenseId}`);
  }
  if (!Array.isArray(candidate.files) || candidate.files.length === 0 || candidate.files.length > 8) {
    throw new Error("번들 글꼴 파일 목록이 올바르지 않습니다.");
  }
  return {
    id: RequireId(candidate.id, "글꼴 ID"),
    displayName: RequireText(candidate.displayName, "글꼴 이름", 200),
    role,
    version: RequireText(candidate.version, "글꼴 버전", 64),
    sourceUrl: RequireHttpsUrl(candidate.sourceUrl, "글꼴 출처"),
    licenseId,
    preferredFamily: RequireText(candidate.preferredFamily, "글꼴 패밀리", 200),
    files: candidate.files.map(ParseFontFile),
  };
}

function ParseFontFile(value: unknown): GongpilClientFontFile {
  const candidate = RequireRecord(value, "번들 글꼴 파일");
  const fileName = RequireSafeRelativeFile(candidate.fileName, undefined, "글꼴 파일");
  if (!FONT_EXTENSIONS.has(extname(fileName).toLocaleLowerCase("en-US"))) {
    throw new Error(`지원하지 않는 번들 글꼴 확장자입니다: ${fileName}`);
  }
  if (
    !Array.isArray(candidate.families)
    || candidate.families.length === 0
    || !candidate.families.every((family) => typeof family === "string" && family.length > 0 && family.length <= 200)
  ) {
    throw new Error(`번들 글꼴 패밀리 목록이 올바르지 않습니다: ${fileName}`);
  }
  if (typeof candidate.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(candidate.sha256)) {
    throw new Error(`번들 글꼴 checksum 형식이 올바르지 않습니다: ${fileName}`);
  }
  if (typeof candidate.bytes !== "number" || !Number.isInteger(candidate.bytes) || candidate.bytes <= 0) {
    throw new Error(`번들 글꼴 크기가 올바르지 않습니다: ${fileName}`);
  }
  return {
    fileName,
    sha256: candidate.sha256,
    bytes: candidate.bytes,
    families: [...candidate.families],
  };
}

async function RequireRegularContainedFile(rootRealPath: string, candidatePath: string): Promise<string> {
  const candidateRealPath = await realpath(candidatePath);
  const relativePath = relative(rootRealPath, candidateRealPath);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`글꼴 경로가 허용된 루트를 벗어났습니다: ${candidatePath}`);
  }
  const stat = await lstat(candidatePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`글꼴 자원은 일반 파일이어야 합니다: ${candidatePath}`);
  }
  return candidateRealPath;
}

function RequireRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} 형식이 올바르지 않습니다.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function RequireId(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9.-]{0,127}$/.test(value)) {
    throw new Error(`${label} 형식이 올바르지 않습니다.`);
  }
  return value;
}

function RequireText(value: unknown, label: string, maximumLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximumLength) {
    throw new Error(`${label} 형식이 올바르지 않습니다.`);
  }
  return value;
}

function RequireSafeRelativeFile(
  value: unknown,
  requiredExtension: string | undefined,
  label: string,
): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.includes("/")
    || value.includes("\\")
    || value === "."
    || value === ".."
  ) {
    throw new Error(`${label} 이름이 올바르지 않습니다.`);
  }
  if (requiredExtension !== undefined && extname(value).toLocaleLowerCase("en-US") !== requiredExtension) {
    throw new Error(`${label} 확장자가 올바르지 않습니다.`);
  }
  return value;
}

function RequireHttpsUrl(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} URL이 올바르지 않습니다.`);
  }
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error(`${label} URL은 HTTPS여야 합니다.`);
  }
  return url.href;
}

function RemoveByteOrderMark(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}
