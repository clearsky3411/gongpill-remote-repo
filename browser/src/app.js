import { GongpilBrowserNetworkRuntime } from "/network-runtime.js";

const runtime = new GongpilBrowserNetworkRuntime();
const state = {
  projects: [],
  activeProject: undefined,
  documents: [],
  activeDocument: undefined,
  dirty: false,
};

const elements = {
  networkStatus: document.querySelector("#networkStatus"),
  shutdownButton: document.querySelector("#shutdownButton"),
  projectForm: document.querySelector("#projectForm"),
  projectName: document.querySelector("#projectName"),
  projectList: document.querySelector("#projectList"),
  documentPanelTitle: document.querySelector("#documentPanelTitle"),
  documentForm: document.querySelector("#documentForm"),
  documentPath: document.querySelector("#documentPath"),
  documentList: document.querySelector("#documentList"),
  editorProject: document.querySelector("#editorProject"),
  editorTitle: document.querySelector("#editorTitle"),
  editorMeta: document.querySelector("#editorMeta"),
  editor: document.querySelector("#editor"),
  saveButton: document.querySelector("#saveButton"),
  saveStatus: document.querySelector("#saveStatus"),
  characterCount: document.querySelector("#characterCount"),
  toast: document.querySelector("#toast"),
};

function RequirePayload(result) {
  if (result.state !== "succeeded") {
    throw new Error(result.error?.userMessage ?? "요청을 처리하지 못했습니다.");
  }
  return result.payload ?? {};
}

async function LoadProjects() {
  const payload = RequirePayload(await runtime.Send("project.list", {}));
  state.projects = payload.projects ?? [];
  RenderProjects();
}

async function OpenProject(projectId) {
  if (state.dirty && !confirm("저장하지 않은 변경을 버리고 다른 프로젝트를 여시겠습니까?")) {
    return;
  }
  const payload = RequirePayload(await runtime.Send("project.open", { projectId }));
  state.activeProject = payload.project;
  state.documents = payload.documents ?? [];
  state.activeDocument = undefined;
  state.dirty = false;
  RenderProjects();
  RenderDocuments();
  RenderEditor();
}

async function OpenDocument(path) {
  if (state.dirty && !confirm("저장하지 않은 변경을 버리고 다른 문서를 여시겠습니까?")) {
    return;
  }
  const payload = RequirePayload(await runtime.Send("document.read", {
    projectId: state.activeProject.projectId,
    path,
  }));
  state.activeDocument = payload.document;
  state.dirty = false;
  RenderDocuments();
  RenderEditor();
}

async function SaveDocument() {
  if (state.activeProject === undefined || state.activeDocument === undefined) {
    return;
  }
  elements.saveButton.disabled = true;
  elements.saveStatus.textContent = "저장 중…";
  try {
    const payload = RequirePayload(await runtime.Send("document.save", {
      projectId: state.activeProject.projectId,
      path: state.activeDocument.path,
      expectedRevision: state.activeDocument.revision,
      content: elements.editor.value,
    }));
    state.activeDocument = payload.document;
    state.dirty = false;
    elements.saveStatus.textContent = "저장 완료";
    await RefreshDocuments();
    RenderEditor();
    ShowToast("문서를 안전하게 저장했습니다.");
  }
  catch (error) {
    elements.saveButton.disabled = false;
    elements.saveStatus.textContent = "저장 실패";
    ShowToast(error.message);
  }
}

async function RefreshDocuments() {
  if (state.activeProject === undefined) {
    return;
  }
  const payload = RequirePayload(await runtime.Send("document.list", {
    projectId: state.activeProject.projectId,
  }));
  state.documents = payload.documents ?? [];
  RenderDocuments();
}

function RenderProjects() {
  elements.projectList.replaceChildren();
  if (state.projects.length === 0) {
    elements.projectList.className = "item-list empty-state";
    elements.projectList.textContent = "아직 프로젝트가 없습니다. 위에서 첫 프로젝트를 만드세요.";
    return;
  }
  elements.projectList.className = "item-list";
  for (const project of state.projects) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `item-button${project.projectId === state.activeProject?.projectId ? " is-active" : ""}`;
    const name = document.createElement("strong");
    name.textContent = project.name;
    const date = document.createElement("span");
    date.textContent = new Date(project.updatedAt).toLocaleString("ko-KR");
    button.append(name, date);
    button.addEventListener("click", () => void RunAction(() => OpenProject(project.projectId)));
    elements.projectList.append(button);
  }
}

function RenderDocuments() {
  elements.documentPanelTitle.textContent = state.activeProject?.name ?? "문서";
  elements.documentForm.hidden = state.activeProject === undefined;
  elements.documentList.replaceChildren();
  if (state.activeProject === undefined) {
    elements.documentList.className = "item-list empty-state";
    elements.documentList.textContent = "프로젝트를 선택하세요.";
    return;
  }
  if (state.documents.length === 0) {
    elements.documentList.className = "item-list empty-state";
    elements.documentList.textContent = "문서가 없습니다. 새 문서를 추가하세요.";
    return;
  }
  elements.documentList.className = "item-list";
  for (const documentSummary of state.documents) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `item-button${documentSummary.path === state.activeDocument?.path ? " is-active" : ""}`;
    const name = document.createElement("strong");
    name.textContent = documentSummary.name;
    const path = document.createElement("span");
    path.textContent = documentSummary.path;
    button.append(name, path);
    button.addEventListener("click", () => void RunAction(() => OpenDocument(documentSummary.path)));
    elements.documentList.append(button);
  }
}

function RenderEditor() {
  const documentSnapshot = state.activeDocument;
  const hasDocument = documentSnapshot !== undefined;
  elements.editor.disabled = !hasDocument;
  elements.saveButton.disabled = !hasDocument || !state.dirty;
  elements.editorProject.textContent = state.activeProject?.name?.toUpperCase() ?? "EDITOR";
  elements.editorTitle.textContent = documentSnapshot?.name ?? "문서를 선택하세요";
  elements.editorMeta.textContent = hasDocument
    ? `${documentSnapshot.path} · revision ${documentSnapshot.revision.slice(0, 10)}`
    : "저장할 문서를 선택하면 편집기가 열립니다.";
  elements.editor.value = documentSnapshot?.content ?? "";
  elements.saveStatus.textContent = hasDocument ? (state.dirty ? "저장하지 않음" : "저장됨") : "대기 중";
  elements.characterCount.textContent = `${elements.editor.value.length.toLocaleString("ko-KR")}자`;
}

function ShowToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  clearTimeout(ShowToast.timeout);
  ShowToast.timeout = setTimeout(() => { elements.toast.hidden = true; }, 3500);
}
ShowToast.timeout = undefined;

async function RunAction(action) {
  try {
    await action();
  }
  catch (error) {
    ShowToast(error instanceof Error ? error.message : "작업을 완료하지 못했습니다.");
  }
}

elements.projectForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void RunAction(async () => {
    const payload = RequirePayload(await runtime.Send("project.create", {
      name: elements.projectName.value,
    }));
    elements.projectForm.reset();
    await LoadProjects();
    await OpenProject(payload.project.projectId);
    ShowToast("새 프로젝트를 만들었습니다.");
  });
});

elements.documentForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void RunAction(async () => {
    const payload = RequirePayload(await runtime.Send("document.create", {
      projectId: state.activeProject.projectId,
      path: elements.documentPath.value,
      content: "",
    }));
    elements.documentForm.reset();
    await RefreshDocuments();
    state.activeDocument = payload.document;
    state.dirty = false;
    RenderDocuments();
    RenderEditor();
    elements.editor.focus();
    ShowToast("새 문서를 만들었습니다.");
  });
});

elements.editor.addEventListener("input", () => {
  if (state.activeDocument === undefined) {
    return;
  }
  state.dirty = elements.editor.value !== state.activeDocument.content;
  elements.saveButton.disabled = !state.dirty;
  elements.saveStatus.textContent = state.dirty ? "저장하지 않음" : "저장됨";
  elements.characterCount.textContent = `${elements.editor.value.length.toLocaleString("ko-KR")}자`;
});

elements.saveButton.addEventListener("click", () => void SaveDocument());
elements.shutdownButton.addEventListener("click", () => {
  if (!confirm("공필 Core를 종료하시겠습니까?")) {
    return;
  }
  void RunAction(async () => {
    RequirePayload(await runtime.Send("system.shutdown.request", {}));
    runtime.Disconnect();
    document.body.innerHTML = "<main class='empty-state'><h1>공필이 종료됐습니다.</h1><p>이 창을 닫아도 됩니다.</p></main>";
  });
});

runtime.SubscribeStatus((status) => {
  const labels = {
    starting: "시작 중",
    connecting: "연결 중",
    ready: "연결됨",
    degraded: "확인 필요",
    reconnecting: "재연결 중",
    offline: "오프라인",
  };
  elements.networkStatus.dataset.state = status;
  elements.networkStatus.textContent = labels[status] ?? status;
});
runtime.Subscribe((event) => {
  if (event.eventName === "project.changed") {
    void RunAction(LoadProjects);
  }
  if (event.eventName === "document.changed" && event.payload.projectId === state.activeProject?.projectId) {
    void RunAction(RefreshDocuments);
  }
});

window.addEventListener("beforeunload", (event) => {
  if (state.dirty) {
    event.preventDefault();
  }
});

void RunAction(LoadProjects);
