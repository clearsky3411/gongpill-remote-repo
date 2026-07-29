import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CreateDefaultInstanceLayout,
  GongpilInstanceLayoutStore,
  GongpilInstanceLayoutStoreError,
} from "../../core/src/instance-layout-store.ts";

test("Instance 레이아웃 기본값은 네 작업 영역의 순서·접힘·너비를 명시한다", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "gongpil-instance-layout-default-"));
  try {
    const store = new GongpilInstanceLayoutStore(dataRoot);
    assert.deepEqual(await store.Read(), CreateDefaultInstanceLayout());
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
    const defaults = CreateDefaultInstanceLayout();
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
    const defaults = CreateDefaultInstanceLayout();
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
    const defaults = CreateDefaultInstanceLayout();
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
