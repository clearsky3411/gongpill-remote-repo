import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CreateDefaultInstanceLayout as CreateDefaultCoreInstanceLayout,
  GongpilInstanceLayoutStore,
  GongpilInstanceLayoutStoreError,
} from "../../core/src/instance-layout-store.ts";
import {
  CreateDefaultInstanceLayout as CreateDefaultBrowserInstanceLayout,
  MoveCoWriterPartSection,
  MoveInstancePartWindow,
  ResizeAdjacentCoWriterPartSections,
  ResizeAdjacentInstancePartWindows,
  ToggleCoWriterPartSection,
  ToggleInstancePartWindow,
} from "../../browser/src/instance-layout.js";

const APP_ROOT = process.cwd();

test("Instance 레이아웃 v2 기본값은 Part Window와 공동 집필 Part Section을 명시한다", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "gongpil-instance-layout-default-"));
  try {
    const store = new GongpilInstanceLayoutStore(dataRoot);
    assert.deepEqual(await store.Read(), CreateDefaultCoreInstanceLayout());
    await assert.rejects(readFile(store.GetLayoutPath()), /ENOENT/);
  }
  finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("Instance 레이아웃을 원자 저장하고 새 Store에서 다시 읽는다", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "gongpil-instance-layout-save-"));
  try {
    const store = new GongpilInstanceLayoutStore(dataRoot);
    const defaults = CreateDefaultCoreInstanceLayout();
    const saved = await store.Update({
      ...defaults,
      partWindowOrder: ["documents", "projects", "editor", "co-writer"],
      partWindows: {
        ...defaults.partWindows,
        projects: { minimized: true, widthCssPx: 260 },
        editor: { minimized: false, widthCssPx: 900 },
      },
      coWriter: {
        partSectionOrder: ["chat", "context", "request"],
        partSections: {
          ...defaults.coWriter.partSections,
          chat: { collapsed: false, heightCssPx: 600 },
        },
      },
    });
    assert.deepEqual(saved.partWindowOrder, ["documents", "projects", "editor", "co-writer"]);
    assert.deepEqual(saved.partWindows.projects, { minimized: true, widthCssPx: 260 });
    assert.deepEqual(saved.coWriter.partSectionOrder, ["chat", "context", "request"]);
    assert.deepEqual(saved.coWriter.partSections.chat, { collapsed: false, heightCssPx: 600 });
    assert.equal(Date.parse(saved.updatedAt) > 0, true);
    assert.deepEqual(await new GongpilInstanceLayoutStore(dataRoot).Read(), saved);
    assert.deepEqual(
      (await readdir(join(dataRoot, "settings"))).sort(),
      ["instance-layout.json"],
    );
  }
  finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("잘못된 순서와 너비는 기존 Instance 레이아웃을 바꾸지 않는다", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "gongpil-instance-layout-invalid-"));
  try {
    const store = new GongpilInstanceLayoutStore(dataRoot);
    const defaults = CreateDefaultCoreInstanceLayout();
    const saved = await store.Update(defaults);
    await assert.rejects(
      store.Update({
        ...defaults,
        partWindowOrder: ["projects", "projects", "editor", "co-writer"],
      }),
      (error: unknown) => error instanceof GongpilInstanceLayoutStoreError
        && error.code === "INSTANCE_LAYOUT_INVALID",
    );
    await assert.rejects(
      store.Update({
        ...defaults,
        partWindows: { ...defaults.partWindows, editor: { minimized: false, widthCssPx: 100 } },
      }),
      /editor Part Window 너비/,
    );
    assert.deepEqual(await store.Read(), saved);
  }
  finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("동시 Instance 레이아웃 저장은 호출 순서대로 직렬화된다", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "gongpil-instance-layout-concurrent-"));
  try {
    const store = new GongpilInstanceLayoutStore(dataRoot);
    const defaults = CreateDefaultCoreInstanceLayout();
    const first = store.Update({
      ...defaults,
      partWindows: { ...defaults.partWindows, documents: { minimized: true, widthCssPx: 220 } },
    });
    const second = store.Update({
      ...defaults,
      partWindows: { ...defaults.partWindows, documents: { minimized: false, widthCssPx: 360 } },
    });
    await Promise.all([first, second]);
    assert.deepEqual((await store.Read()).partWindows.documents, { minimized: false, widthCssPx: 360 });
  }
  finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("Browser와 Core는 같은 Instance Part Window v2 기본값을 사용한다", () => {
  assert.deepEqual(CreateDefaultBrowserInstanceLayout(), CreateDefaultCoreInstanceLayout());
});

test("Instance Part Window를 최소화하고 좌우 경계 안에서 이동한다", () => {
  const defaults = CreateDefaultBrowserInstanceLayout();
  const minimized = ToggleInstancePartWindow(defaults, "projects");
  assert.equal(minimized.partWindows.projects.minimized, true);
  assert.equal(defaults.partWindows.projects.minimized, false);
  assert.deepEqual(MoveInstancePartWindow(defaults, "projects", -1).partWindowOrder, defaults.partWindowOrder);
  assert.deepEqual(
    MoveInstancePartWindow(defaults, "documents", -1).partWindowOrder,
    ["documents", "projects", "editor", "co-writer"],
  );
  assert.deepEqual(MoveInstancePartWindow(defaults, "co-writer", 1).partWindowOrder, defaults.partWindowOrder);
});

test("기존 v1 작업 영역 설정은 순서·너비·접힘을 보존해 v2로 읽는다", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "gongpil-instance-layout-v1-"));
  try {
    const store = new GongpilInstanceLayoutStore(dataRoot);
    await mkdir(join(dataRoot, "settings"), { recursive: true });
    await writeFile(store.GetLayoutPath(), JSON.stringify({
      schemaVersion: 1,
      panelOrder: ["documents", "projects", "co-writer", "editor"],
      panels: {
        projects: { collapsed: true, widthCssPx: 260 },
        documents: { collapsed: false, widthCssPx: 320 },
        editor: { collapsed: false, widthCssPx: 800 },
        "co-writer": { collapsed: true, widthCssPx: 500 },
      },
      updatedAt: "2026-07-28T00:00:00.000Z",
    }), "utf8");

    const migrated = await store.Read();
    assert.equal(migrated.schemaVersion, 2);
    assert.deepEqual(migrated.partWindowOrder, ["documents", "projects", "co-writer", "editor"]);
    assert.deepEqual(migrated.partWindows.projects, { minimized: true, widthCssPx: 260 });
    assert.deepEqual(migrated.partWindows["co-writer"], { minimized: true, widthCssPx: 500 });
    assert.deepEqual(migrated.coWriter, CreateDefaultCoreInstanceLayout().coWriter);
    assert.equal(migrated.updatedAt, "2026-07-28T00:00:00.000Z");
    assert.equal(JSON.parse(await readFile(store.GetLayoutPath(), "utf8")).schemaVersion, 1);

    const saved = await store.Update(migrated);
    assert.equal(JSON.parse(await readFile(store.GetLayoutPath(), "utf8")).schemaVersion, 2);
    assert.deepEqual(await store.Read(), saved);
  }
  finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("인접 Instance Part Window 크기 조절은 합계와 최소·최대 경계를 지킨다", () => {
  const defaults = CreateDefaultBrowserInstanceLayout();
  const resized = ResizeAdjacentInstancePartWindows(defaults, "editor", "co-writer", 100);
  assert.equal(resized.partWindows.editor.widthCssPx, 740);
  assert.equal(resized.partWindows["co-writer"].widthCssPx, 320);
  const clamped = ResizeAdjacentInstancePartWindows(defaults, "editor", "co-writer", 1000);
  assert.equal(clamped.partWindows.editor.widthCssPx, 760);
  assert.equal(clamped.partWindows["co-writer"].widthCssPx, 300);
  const minimized = ToggleInstancePartWindow(defaults, "editor");
  assert.deepEqual(
    ResizeAdjacentInstancePartWindows(minimized, "editor", "co-writer", 100),
    minimized,
  );
});

test("공동 집필 Part Section은 순서·접힘·높이 경계를 독립적으로 바꾼다", () => {
  const defaults = CreateDefaultBrowserInstanceLayout();
  const expandedContext = ToggleCoWriterPartSection(defaults, "context");
  assert.equal(expandedContext.coWriter.partSections.context.collapsed, false);
  assert.equal(defaults.coWriter.partSections.context.collapsed, true);
  assert.deepEqual(
    MoveCoWriterPartSection(defaults, "chat", -1).coWriter.partSectionOrder,
    ["chat", "context", "request"],
  );
  const resized = ResizeAdjacentCoWriterPartSections(expandedContext, "context", "chat", 80);
  assert.equal(resized.coWriter.partSections.context.heightCssPx, 360);
  assert.equal(resized.coWriter.partSections.chat.heightCssPx, 340);
  assert.deepEqual(
    ResizeAdjacentCoWriterPartSections(defaults, "context", "chat", 80),
    defaults,
  );
});

test("Instance 화면은 네 Part Window와 공동 집필 Part Section 조작을 제공한다", async () => {
  const [html, styles, script] = await Promise.all([
    readFile(join(APP_ROOT, "browser", "src", "index.html"), "utf8"),
    readFile(join(APP_ROOT, "browser", "src", "styles.css"), "utf8"),
    readFile(join(APP_ROOT, "browser", "src", "app.js"), "utf8"),
  ]);
  for (const panelId of ["projects", "documents", "editor", "co-writer"]) {
    assert.match(html, new RegExp(`data-panel-id="${panelId}"`));
  }
  assert.match(html, /id="layoutResetButton"/);
  assert.equal((html.match(/data-panel-action="toggle"/g) ?? []).length, 4);
  assert.equal((html.match(/data-panel-action="move-left"/g) ?? []).length, 4);
  assert.equal((html.match(/data-panel-action="move-right"/g) ?? []).length, 4);
  for (const partSectionId of ["context", "chat", "request"]) {
    assert.match(html, new RegExp(`data-part-section-id="${partSectionId}"`));
  }
  assert.equal((html.match(/data-part-section-action="toggle"/g) ?? []).length, 3);
  assert.equal((html.match(/data-part-section-action="move-up"/g) ?? []).length, 3);
  assert.equal((html.match(/data-part-section-action="move-down"/g) ?? []).length, 3);
  assert.match(styles, /\.panel\.is-minimized/);
  assert.match(styles, /\.panel-resizer/);
  assert.match(styles, /\.part-section-resizer/);
  assert.match(styles, /\.co-writer-part-sections/);
  assert.match(script, /instance\.layout\.read/);
  assert.match(script, /instance\.layout\.update/);
  assert.match(script, /MoveInstancePartWindowToIndex/);
  assert.match(script, /MoveCoWriterPartSectionToIndex/);
  assert.match(script, /ResizeAdjacentCoWriterPartSections/);
  assert.match(script, /role", "separator"/);
  assert.match(script, /ArrowLeft/);
  assert.match(script, /ArrowUp/);
  assert.match(script, /pointerdown/);
  assert.doesNotMatch(script, /localStorage|sessionStorage/);
});

test("손상된 Instance 레이아웃 파일은 조용히 초기화하지 않는다", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "gongpil-instance-layout-corrupt-"));
  try {
    const store = new GongpilInstanceLayoutStore(dataRoot);
    await mkdir(join(dataRoot, "settings"), { recursive: true });
    await writeFile(store.GetLayoutPath(), "{not-json", "utf8");
    await assert.rejects(
      store.Read(),
      (error: unknown) => error instanceof GongpilInstanceLayoutStoreError
        && error.code === "INSTANCE_LAYOUT_CORRUPT",
    );
  }
  finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});
