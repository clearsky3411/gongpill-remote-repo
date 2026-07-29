export const GONGPIL_PART_WINDOW_IDS = ["projects", "documents", "editor", "co-writer"];
export const GONGPIL_CO_WRITER_PART_SECTION_IDS = ["context", "chat", "request"];

const PART_WINDOW_WIDTH_RANGES = Object.freeze({
  projects: Object.freeze([160, 480]),
  documents: Object.freeze([180, 560]),
  editor: Object.freeze([360, 1600]),
  "co-writer": Object.freeze([300, 1000]),
});

const PART_SECTION_HEIGHT_RANGES = Object.freeze({
  context: Object.freeze([160, 800]),
  chat: Object.freeze([240, 1200]),
  request: Object.freeze([140, 480]),
});

export function CreateDefaultInstanceLayout() {
  return {
    schemaVersion: 2,
    partWindowOrder: [...GONGPIL_PART_WINDOW_IDS],
    partWindows: {
      projects: { minimized: false, widthCssPx: 210 },
      documents: { minimized: false, widthCssPx: 240 },
      editor: { minimized: false, widthCssPx: 640 },
      "co-writer": { minimized: false, widthCssPx: 420 },
    },
    coWriter: {
      partSectionOrder: [...GONGPIL_CO_WRITER_PART_SECTION_IDS],
      partSections: {
        context: { collapsed: true, heightCssPx: 280 },
        chat: { collapsed: false, heightCssPx: 420 },
        request: { collapsed: false, heightCssPx: 240 },
      },
    },
    updatedAt: new Date(0).toISOString(),
  };
}

export function CloneInstanceLayout(layout) {
  return {
    ...layout,
    partWindowOrder: [...layout.partWindowOrder],
    partWindows: Object.fromEntries(GONGPIL_PART_WINDOW_IDS.map((partWindowId) => [
      partWindowId,
      { ...layout.partWindows[partWindowId] },
    ])),
    coWriter: {
      partSectionOrder: [...layout.coWriter.partSectionOrder],
      partSections: Object.fromEntries(GONGPIL_CO_WRITER_PART_SECTION_IDS.map((partSectionId) => [
        partSectionId,
        { ...layout.coWriter.partSections[partSectionId] },
      ])),
    },
  };
}

export function ToggleInstancePartWindow(layout, partWindowId) {
  RequirePartWindowId(partWindowId);
  const nextLayout = CloneInstanceLayout(layout);
  nextLayout.partWindows[partWindowId].minimized = !nextLayout.partWindows[partWindowId].minimized;
  return nextLayout;
}

export function MoveInstancePartWindow(layout, partWindowId, direction) {
  if (direction !== -1 && direction !== 1) {
    throw new Error("Part Window 이동 방향은 -1 또는 1이어야 합니다.");
  }
  const currentIndex = layout.partWindowOrder.indexOf(RequirePartWindowId(partWindowId));
  return MoveInstancePartWindowToIndex(layout, partWindowId, currentIndex + direction);
}

export function MoveInstancePartWindowToIndex(layout, partWindowId, targetIndex) {
  RequirePartWindowId(partWindowId);
  const nextLayout = CloneInstanceLayout(layout);
  return MoveIdentifierToIndex(nextLayout, nextLayout.partWindowOrder, partWindowId, targetIndex);
}

export function ResizeAdjacentInstancePartWindows(layout, leftPartWindowId, rightPartWindowId, deltaCssPx) {
  RequirePartWindowId(leftPartWindowId);
  RequirePartWindowId(rightPartWindowId);
  const nextLayout = CloneInstanceLayout(layout);
  const leftPartWindow = nextLayout.partWindows[leftPartWindowId];
  const rightPartWindow = nextLayout.partWindows[rightPartWindowId];
  if (leftPartWindow.minimized || rightPartWindow.minimized) {
    return nextLayout;
  }
  ResizeAdjacentSizes(
    leftPartWindow,
    rightPartWindow,
    "widthCssPx",
    PART_WINDOW_WIDTH_RANGES[leftPartWindowId],
    PART_WINDOW_WIDTH_RANGES[rightPartWindowId],
    deltaCssPx,
    "Part Window 크기 변경값이 올바르지 않습니다.",
  );
  return nextLayout;
}

export function ToggleCoWriterPartSection(layout, partSectionId) {
  RequirePartSectionId(partSectionId);
  const nextLayout = CloneInstanceLayout(layout);
  const partSection = nextLayout.coWriter.partSections[partSectionId];
  partSection.collapsed = !partSection.collapsed;
  return nextLayout;
}

export function MoveCoWriterPartSection(layout, partSectionId, direction) {
  if (direction !== -1 && direction !== 1) {
    throw new Error("Part Section 이동 방향은 -1 또는 1이어야 합니다.");
  }
  const currentIndex = layout.coWriter.partSectionOrder.indexOf(RequirePartSectionId(partSectionId));
  return MoveCoWriterPartSectionToIndex(layout, partSectionId, currentIndex + direction);
}

export function MoveCoWriterPartSectionToIndex(layout, partSectionId, targetIndex) {
  RequirePartSectionId(partSectionId);
  const nextLayout = CloneInstanceLayout(layout);
  return MoveIdentifierToIndex(nextLayout, nextLayout.coWriter.partSectionOrder, partSectionId, targetIndex);
}

export function ResizeAdjacentCoWriterPartSections(layout, upperPartSectionId, lowerPartSectionId, deltaCssPx) {
  RequirePartSectionId(upperPartSectionId);
  RequirePartSectionId(lowerPartSectionId);
  const nextLayout = CloneInstanceLayout(layout);
  const upperPartSection = nextLayout.coWriter.partSections[upperPartSectionId];
  const lowerPartSection = nextLayout.coWriter.partSections[lowerPartSectionId];
  if (upperPartSection.collapsed || lowerPartSection.collapsed) {
    return nextLayout;
  }
  ResizeAdjacentSizes(
    upperPartSection,
    lowerPartSection,
    "heightCssPx",
    PART_SECTION_HEIGHT_RANGES[upperPartSectionId],
    PART_SECTION_HEIGHT_RANGES[lowerPartSectionId],
    deltaCssPx,
    "Part Section 크기 변경값이 올바르지 않습니다.",
  );
  return nextLayout;
}

export function InstancePartWindowWidthRange(partWindowId) {
  return [...PART_WINDOW_WIDTH_RANGES[RequirePartWindowId(partWindowId)]];
}

export function CoWriterPartSectionHeightRange(partSectionId) {
  return [...PART_SECTION_HEIGHT_RANGES[RequirePartSectionId(partSectionId)]];
}

function MoveIdentifierToIndex(layout, order, identifier, targetIndex) {
  if (!Number.isInteger(targetIndex)) {
    throw new Error("이동할 위치가 올바르지 않습니다.");
  }
  const currentIndex = order.indexOf(identifier);
  const safeTargetIndex = Math.max(0, Math.min(order.length - 1, targetIndex));
  if (currentIndex === safeTargetIndex) {
    return layout;
  }
  order.splice(currentIndex, 1);
  order.splice(safeTargetIndex, 0, identifier);
  return layout;
}

function ResizeAdjacentSizes(
  first,
  second,
  propertyName,
  firstRange,
  secondRange,
  deltaCssPx,
  invalidMessage,
) {
  if (!Number.isFinite(deltaCssPx)) {
    throw new Error(invalidMessage);
  }
  const minimumDelta = Math.max(
    firstRange[0] - first[propertyName],
    second[propertyName] - secondRange[1],
  );
  const maximumDelta = Math.min(
    firstRange[1] - first[propertyName],
    second[propertyName] - secondRange[0],
  );
  const safeDelta = Math.round(Math.min(maximumDelta, Math.max(minimumDelta, deltaCssPx)));
  first[propertyName] += safeDelta;
  second[propertyName] -= safeDelta;
}

function RequirePartWindowId(partWindowId) {
  if (!GONGPIL_PART_WINDOW_IDS.includes(partWindowId)) {
    throw new Error(`알 수 없는 Part Window ID입니다: ${partWindowId}`);
  }
  return partWindowId;
}

function RequirePartSectionId(partSectionId) {
  if (!GONGPIL_CO_WRITER_PART_SECTION_IDS.includes(partSectionId)) {
    throw new Error(`알 수 없는 공동 집필 Part Section ID입니다: ${partSectionId}`);
  }
  return partSectionId;
}
