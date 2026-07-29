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
  MoveInstancePanel,
  ResizeAdjacentInstancePanels,
  ToggleInstancePanel,
} from "../../browser/src/instance-layout.js";

const APP_ROOT = process.cwd();

test("Instance 레이아웃 기본값은 네 작업 영역의 순서·접힘·너비를 명시한다", async () => {
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
      panelOrder: ["documents", "projects", "editor", "co-writer"],
      panels: {
        ...defaults.panels,
        projects: { collapsed: true, widthCssPx: 260 },
        editor: { collapsed: false, widthCssPx: 900 },
      },
    });
    assert.deepEqual(saved.panelOrder, ["documents", "projects", "editor", "co-writer"]);
    assert.deepEqual(saved.panels.projects, { collapsed: true, widthCssPx: 260 });
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
        panelOrder: ["projects", "projects", "editor", "co-writer"],
      }),
      (error: unknown) => error instanceof GongpilInstanceLayoutStoreError
        && error.code === "INSTANCE_LAYOUT_INVALID",
    );
    await assert.rejects(
      store.Update({
        ...defaults,
        panels: { ...defaults.panels, editor: { collapsed: false, widthCssPx: 100 } },
      }),
      /editor 작업 영역 너비/,
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
      panels: { ...defaults.panels, documents: { collapsed: true, widthCssPx: 220 } },
    });
    const second = store.Update({
      ...defaults,
      panels: { ...defaults.panels, documents: { collapsed: false, widthCssPx: 360 } },
    });
    await Promise.all([first, second]);
    assert.deepEqual((await store.Read()).panels.documents, { collapsed: false, widthCssPx: 360 });
  }
  finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("Browser와 Core는 같은 Instance 패널 기본값을 사용한다", () => {
  assert.deepEqual(CreateDefaultBrowserInstanceLayout(), CreateDefaultCoreInstanceLayout());
});

test("Instance 패널을 접고 펼치며 좌우 경계 안에서 이동한다", () => {
  const defaults = CreateDefaultBrowserInstanceLayout();
  const collapsed = ToggleInstancePanel(defaults, "projects");
  assert.equal(collapsed.panels.projects.collapsed, true);
  assert.equal(defaults.panels.projects.collapsed, false);
  assert.deepEqual(MoveInstancePanel(defaults, "projects", -1).panelOrder, defaults.panelOrder);
  assert.deepEqual(
    MoveInstancePanel(defaults, "documents", -1).panelOrder,
    ["documents", "projects", "editor", "co-writer"],
  );
  assert.deepEqual(MoveInstancePanel(defaults, "co-writer", 1).panelOrder, defaults.panelOrder);
});

test("인접 Instance 패널 크기 조절은 합계와 최소·최대 경계를 지킨다", () => {
  const defaults = CreateDefaultBrowserInstanceLayout();
  const resized = ResizeAdjacentInstancePanels(defaults, "editor", "co-writer", 100);
  assert.equal(resized.panels.editor.widthCssPx, 740);
  assert.equal(resized.panels["co-writer"].widthCssPx, 320);
  const clamped = ResizeAdjacentInstancePanels(defaults, "editor", "co-writer", 1000);
  assert.equal(clamped.panels.editor.widthCssPx, 760);
  assert.equal(clamped.panels["co-writer"].widthCssPx, 300);
  const collapsed = ToggleInstancePanel(defaults, "editor");
  assert.deepEqual(
    ResizeAdjacentInstancePanels(collapsed, "editor", "co-writer", 100),
    collapsed,
  );
});

test("Instance 화면은 네 패널 배치 조작과 Core 저장 명령을 제공한다", async () => {
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
  assert.match(styles, /\.panel\.is-collapsed/);
  assert.match(styles, /\.panel-resizer/);
  assert.match(script, /instance\.layout\.read/);
  assert.match(script, /instance\.layout\.update/);
  assert.match(script, /role", "separator"/);
  assert.match(script, /ArrowLeft/);
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
