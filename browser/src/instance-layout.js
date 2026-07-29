export const GONGPIL_INSTANCE_PANEL_IDS = ["projects", "documents", "editor", "co-writer"];

const PANEL_WIDTH_RANGES = Object.freeze({
  projects: Object.freeze([160, 480]),
  documents: Object.freeze([180, 560]),
  editor: Object.freeze([360, 1600]),
  "co-writer": Object.freeze([300, 1000]),
});

export function CreateDefaultInstanceLayout() {
  return {
    schemaVersion: 1,
    panelOrder: [...GONGPIL_INSTANCE_PANEL_IDS],
    panels: {
      projects: { collapsed: false, widthCssPx: 210 },
      documents: { collapsed: false, widthCssPx: 240 },
      editor: { collapsed: false, widthCssPx: 640 },
      "co-writer": { collapsed: false, widthCssPx: 420 },
    },
    updatedAt: new Date(0).toISOString(),
  };
}

export function CloneInstanceLayout(layout) {
  return {
    ...layout,
    panelOrder: [...layout.panelOrder],
    panels: Object.fromEntries(GONGPIL_INSTANCE_PANEL_IDS.map((panelId) => [
      panelId,
      { ...layout.panels[panelId] },
    ])),
  };
}

export function ToggleInstancePanel(layout, panelId) {
  RequirePanelId(panelId);
  const nextLayout = CloneInstanceLayout(layout);
  nextLayout.panels[panelId].collapsed = !nextLayout.panels[panelId].collapsed;
  return nextLayout;
}

export function MoveInstancePanel(layout, panelId, direction) {
  RequirePanelId(panelId);
  if (direction !== -1 && direction !== 1) {
    throw new Error("작업 영역 이동 방향은 -1 또는 1이어야 합니다.");
  }
  const nextLayout = CloneInstanceLayout(layout);
  const currentIndex = nextLayout.panelOrder.indexOf(panelId);
  const targetIndex = currentIndex + direction;
  if (targetIndex < 0 || targetIndex >= nextLayout.panelOrder.length) {
    return nextLayout;
  }
  [nextLayout.panelOrder[currentIndex], nextLayout.panelOrder[targetIndex]] = [
    nextLayout.panelOrder[targetIndex],
    nextLayout.panelOrder[currentIndex],
  ];
  return nextLayout;
}

export function ResizeAdjacentInstancePanels(layout, leftPanelId, rightPanelId, deltaCssPx) {
  RequirePanelId(leftPanelId);
  RequirePanelId(rightPanelId);
  if (!Number.isFinite(deltaCssPx)) {
    throw new Error("작업 영역 크기 변경값이 올바르지 않습니다.");
  }
  const nextLayout = CloneInstanceLayout(layout);
  const leftPanel = nextLayout.panels[leftPanelId];
  const rightPanel = nextLayout.panels[rightPanelId];
  if (leftPanel.collapsed || rightPanel.collapsed) {
    return nextLayout;
  }
  const [leftMinimum, leftMaximum] = PANEL_WIDTH_RANGES[leftPanelId];
  const [rightMinimum, rightMaximum] = PANEL_WIDTH_RANGES[rightPanelId];
  const minimumDelta = Math.max(leftMinimum - leftPanel.widthCssPx, rightPanel.widthCssPx - rightMaximum);
  const maximumDelta = Math.min(leftMaximum - leftPanel.widthCssPx, rightPanel.widthCssPx - rightMinimum);
  const safeDelta = Math.round(Math.min(maximumDelta, Math.max(minimumDelta, deltaCssPx)));
  leftPanel.widthCssPx += safeDelta;
  rightPanel.widthCssPx -= safeDelta;
  return nextLayout;
}

export function InstancePanelWidthRange(panelId) {
  RequirePanelId(panelId);
  return [...PANEL_WIDTH_RANGES[panelId]];
}

function RequirePanelId(panelId) {
  if (!GONGPIL_INSTANCE_PANEL_IDS.includes(panelId)) {
    throw new Error(`알 수 없는 작업 영역 ID입니다: ${panelId}`);
  }
}
