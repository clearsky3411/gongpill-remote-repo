import { GongpilBrowserNetworkRuntime } from "/network-runtime.js";

const runtime = new GongpilBrowserNetworkRuntime();
const state = {
  projects: [],
  activeProject: undefined,
  documents: [],
  activeDocument: undefined,
  dirty: false,
  chatMessages: [],
  proposals: [],
  chatConfigured: false,
  providerStatus: undefined,
  usage: undefined,
  personaWorkspace: undefined,
  chunks: [],
  selectedChunkIds: new Set(),
  selectedChunkPaths: new Map(),
  chatSending: false,
  streamingText: "",
};

const elements = {
  networkStatus: document.querySelector("#networkStatus"),
  usageButton: document.querySelector("#usageButton"),
  logsButton: document.querySelector("#logsButton"),
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
  aiStatus: document.querySelector("#aiStatus"),
  personaSelect: document.querySelector("#personaSelect"),
  personaVersionSelect: document.querySelector("#personaVersionSelect"),
  profileSelect: document.querySelector("#profileSelect"),
  personaVersionForm: document.querySelector("#personaVersionForm"),
  personaNameInput: document.querySelector("#personaNameInput"),
  personaInstructionsInput: document.querySelector("#personaInstructionsInput"),
  personaWorkStyleInput: document.querySelector("#personaWorkStyleInput"),
  personaStyleInput: document.querySelector("#personaStyleInput"),
  personaForbiddenInput: document.querySelector("#personaForbiddenInput"),
  personaPrioritiesInput: document.querySelector("#personaPrioritiesInput"),
  profileForm: document.querySelector("#profileForm"),
  profileNameInput: document.querySelector("#profileNameInput"),
  profileInstructionsInput: document.querySelector("#profileInstructionsInput"),
  profileBudgetInput: document.querySelector("#profileBudgetInput"),
  chunkSearchForm: document.querySelector("#chunkSearchForm"),
  chunkSearchInput: document.querySelector("#chunkSearchInput"),
  chunkList: document.querySelector("#chunkList"),
  contextSelectionSummary: document.querySelector("#contextSelectionSummary"),
  selectVisibleChunksButton: document.querySelector("#selectVisibleChunksButton"),
  clearChunkSelectionButton: document.querySelector("#clearChunkSelectionButton"),
  chatMessages: document.querySelector("#chatMessages"),
  chatForm: document.querySelector("#chatForm"),
  chatInput: document.querySelector("#chatInput"),
  chatSendButton: document.querySelector("#chatSendButton"),
  observabilityDialog: document.querySelector("#observabilityDialog"),
  dialogEyebrow: document.querySelector("#dialogEyebrow"),
  dialogTitle: document.querySelector("#dialogTitle"),
  dialogContent: document.querySelector("#dialogContent"),
  dialogCloseButton: document.querySelector("#dialogCloseButton"),
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
  state.personaWorkspace = undefined;
  state.chunks = [];
  state.selectedChunkIds.clear();
  state.selectedChunkPaths.clear();
  state.dirty = false;
  RenderProjects();
  RenderDocuments();
  RenderEditor();
  await LoadPersonaWorkspace();
  await LoadChatSession();
  await LoadChunks();
}

async function LoadChatSession() {
  if (state.activeProject === undefined) {
    state.chatMessages = [];
    state.proposals = [];
    state.chatConfigured = false;
    state.providerStatus = undefined;
    state.usage = undefined;
    RenderChat();
    return;
  }
  const payload = RequirePayload(await runtime.Send("chat.session.read", {
    projectId: state.activeProject.projectId,
  }));
  state.chatMessages = payload.session?.messages ?? [];
  state.proposals = payload.session?.proposals ?? [];
  state.chatConfigured = payload.configured === true;
  state.providerStatus = payload.provider;
  state.usage = payload.usage;
  state.streamingText = "";
  RenderChat();
}

async function LoadPersonaWorkspace() {
  if (state.activeProject === undefined) {
    state.personaWorkspace = undefined;
    RenderPersonaWorkspace();
    return;
  }
  const payload = RequirePayload(await runtime.Send("persona.workspace.read", {
    projectId: state.activeProject.projectId,
  }));
  state.personaWorkspace = payload.workspace;
  RenderPersonaWorkspace();
}

async function UpdatePersonaSelection(selection) {
  if (state.activeProject === undefined) {
    return;
  }
  const payload = RequirePayload(await runtime.Send("persona.selection.update", {
    projectId: state.activeProject.projectId,
    ...selection,
  }));
  state.personaWorkspace = payload.workspace;
  RenderPersonaWorkspace();
  ShowToast("공동 집필 페르소나·프로필을 전환했습니다.");
}

async function SavePersonaVersion(mode) {
  if (state.activeProject === undefined || state.personaWorkspace === undefined) {
    return;
  }
  const createNewPersona = mode === "persona";
  const payload = RequirePayload(await runtime.Send("persona.version.create", {
    projectId: state.activeProject.projectId,
    personaId: createNewPersona ? undefined : state.personaWorkspace.selection.personaId,
    name: elements.personaNameInput.value,
    systemInstructions: elements.personaInstructionsInput.value,
    workStyle: elements.personaWorkStyleInput.value,
    styleGuide: elements.personaStyleInput.value,
    forbiddenExpressions: SplitMultiline(elements.personaForbiddenInput.value),
    referencePriorities: SplitMultiline(elements.personaPrioritiesInput.value),
  }));
  state.personaWorkspace = payload.workspace;
  RenderPersonaWorkspace();
  ShowToast(createNewPersona ? "새 페르소나를 저장했습니다." : "페르소나 새 버전을 저장했습니다.");
}

async function SaveWorkProfile(mode) {
  if (state.activeProject === undefined || state.personaWorkspace === undefined) {
    return;
  }
  const createNewProfile = mode === "new";
  const payload = RequirePayload(await runtime.Send("persona.profile.save", {
    projectId: state.activeProject.projectId,
    profileId: createNewProfile ? undefined : state.personaWorkspace.selection.profileId,
    name: elements.profileNameInput.value,
    instructions: elements.profileInstructionsInput.value,
    contextTokenBudget: Number(elements.profileBudgetInput.value),
  }));
  state.personaWorkspace = payload.workspace;
  RenderPersonaWorkspace();
  ShowToast(createNewProfile ? "새 작업 프로필을 저장했습니다." : "작업 프로필을 저장했습니다.");
}

function RenderPersonaWorkspace() {
  const workspace = state.personaWorkspace;
  const disabled = workspace === undefined;
  const persona = workspace?.personas.find((candidate) => candidate.personaId === workspace.selection.personaId);
  const version = persona?.versions.find((candidate) => candidate.versionId === workspace.selection.versionId);
  const profile = workspace?.profiles.find((candidate) => candidate.profileId === workspace.selection.profileId);
  PopulateSelect(
    elements.personaSelect,
    workspace?.personas.map((candidate) => ({ value: candidate.personaId, label: candidate.name })) ?? [],
    workspace?.selection.personaId,
  );
  PopulateSelect(
    elements.personaVersionSelect,
    persona?.versions.map((candidate) => ({ value: candidate.versionId, label: `v${candidate.version} · ${candidate.name}` })) ?? [],
    workspace?.selection.versionId,
  );
  PopulateSelect(
    elements.profileSelect,
    workspace?.profiles.map((candidate) => ({ value: candidate.profileId, label: `${candidate.name} · ${candidate.contextTokenBudget.toLocaleString("ko-KR")} tok` })) ?? [],
    workspace?.selection.profileId,
  );
  for (const control of [
    elements.personaSelect,
    elements.personaVersionSelect,
    elements.profileSelect,
    ...elements.personaVersionForm.elements,
    ...elements.profileForm.elements,
  ]) {
    control.disabled = disabled;
  }
  elements.personaNameInput.value = version?.name ?? "";
  elements.personaInstructionsInput.value = version?.systemInstructions ?? "";
  elements.personaWorkStyleInput.value = version?.workStyle ?? "";
  elements.personaStyleInput.value = version?.styleGuide ?? "";
  elements.personaForbiddenInput.value = version?.forbiddenExpressions.join("\n") ?? "";
  elements.personaPrioritiesInput.value = version?.referencePriorities.join("\n") ?? "";
  elements.profileNameInput.value = profile?.name ?? "";
  elements.profileInstructionsInput.value = profile?.instructions ?? "";
  elements.profileBudgetInput.value = String(profile?.contextTokenBudget ?? 32_000);
}

function PopulateSelect(select, options, selectedValue) {
  select.replaceChildren();
  for (const item of options) {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label;
    option.selected = item.value === selectedValue;
    select.append(option);
  }
}

function SplitMultiline(value) {
  return [...new Set(value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean))];
}

async function SendChatMessage() {
  if (state.activeProject === undefined || state.chatSending) {
    return;
  }
  const message = elements.chatInput.value.trim();
  if (message.length === 0) {
    return;
  }
  if (state.dirty) {
    await SaveDocument();
    if (state.dirty) {
      throw new Error("문서를 저장한 뒤 AI 요청을 다시 보내세요.");
    }
  }
  state.chatSending = true;
  state.streamingText = "";
  state.chatMessages.push({ role: "user", content: message, messageId: `pending-${Date.now()}` });
  elements.chatInput.value = "";
  RenderChat();
  try {
    RequirePayload(await runtime.Send("chat.message.send", {
      projectId: state.activeProject.projectId,
      message,
      documentPath: state.activeDocument?.path,
      chunkIds: [...state.selectedChunkIds],
    }));
    await LoadChatSession();
  }
  finally {
    state.chatSending = false;
    state.streamingText = "";
    RenderChat();
  }
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
  await LoadChunks(path);
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
    await LoadChunks(state.activeDocument.path);
    RenderEditor();
    ShowToast("문서를 안전하게 저장했습니다.");
  }
  catch (error) {
    elements.saveButton.disabled = false;
    elements.saveStatus.textContent = "저장 실패";
    ShowToast(error.message);
  }
}

async function LoadChunks(documentPath = state.activeDocument?.path) {
  if (state.activeProject === undefined) {
    state.chunks = [];
    RenderContextSelection();
    return;
  }
  const payload = RequirePayload(await runtime.Send("chunk.list", {
    projectId: state.activeProject.projectId,
    documentPath,
  }));
  state.chunks = payload.chunks ?? [];
  PruneChunkSelection(documentPath);
  RenderContextSelection();
}

async function SearchChunks() {
  if (state.activeProject === undefined) {
    return;
  }
  const query = elements.chunkSearchInput.value.trim();
  if (query.length === 0) {
    await LoadChunks();
    return;
  }
  const payload = RequirePayload(await runtime.Send("chunk.search", {
    projectId: state.activeProject.projectId,
    query,
    limit: 100,
  }));
  state.chunks = (payload.results ?? []).map((result) => result.chunk);
  RenderContextSelection();
}

function RenderContextSelection() {
  elements.contextSelectionSummary.textContent = `선택 ${state.selectedChunkIds.size.toLocaleString("ko-KR")}개`;
  elements.selectVisibleChunksButton.disabled = state.chunks.length === 0;
  elements.clearChunkSelectionButton.disabled = state.selectedChunkIds.size === 0;
  elements.chunkSearchInput.disabled = state.activeProject === undefined;
  elements.chunkList.replaceChildren();
  if (state.chunks.length === 0) {
    elements.chunkList.className = "chunk-list empty-state";
    elements.chunkList.textContent = state.activeProject === undefined
      ? "프로젝트를 선택하세요."
      : "표시할 청크가 없습니다.";
    return;
  }
  elements.chunkList.className = "chunk-list";
  for (const chunk of state.chunks) {
    const label = document.createElement("label");
    label.className = "chunk-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selectedChunkIds.has(chunk.chunkId);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        state.selectedChunkIds.add(chunk.chunkId);
        state.selectedChunkPaths.set(chunk.chunkId, chunk.path);
      }
      else {
        state.selectedChunkIds.delete(chunk.chunkId);
        state.selectedChunkPaths.delete(chunk.chunkId);
      }
      RenderContextSelection();
    });
    const details = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = `${chunk.path} · ${chunk.title}`;
    const coordinate = document.createElement("small");
    coordinate.textContent = `L${chunk.coordinate.lineStart}-${chunk.coordinate.lineEnd} · ${chunk.coordinate.display}`;
    const preview = document.createElement("span");
    preview.className = "chunk-preview";
    preview.textContent = chunk.preview || "(빈 청크)";
    details.append(title, coordinate, preview);
    label.append(checkbox, details);
    elements.chunkList.append(label);
  }
}

function PruneChunkSelection(documentPath) {
  if (documentPath === undefined) {
    return;
  }
  const currentIds = new Set(state.chunks.map((chunk) => chunk.chunkId));
  for (const [chunkId, selectedPath] of state.selectedChunkPaths) {
    if (selectedPath === documentPath && !currentIds.has(chunkId)) {
      state.selectedChunkIds.delete(chunkId);
      state.selectedChunkPaths.delete(chunkId);
    }
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

function RenderChat() {
  const hasProject = state.activeProject !== undefined;
  const isCodex = state.providerStatus?.provider === "codex";
  elements.aiStatus.textContent = state.chatConfigured
    ? (isCodex ? "Codex Pro 준비됨" : "API 준비됨 · 별도 과금")
    : (isCodex ? "Codex 로그인 필요" : "API 설정 필요");
  elements.aiStatus.dataset.ready = String(state.chatConfigured);
  elements.chatInput.disabled = !hasProject || !state.chatConfigured || state.chatSending;
  elements.chatSendButton.disabled = elements.chatInput.disabled;
  elements.chatSendButton.textContent = state.chatSending ? "작성 중…" : "AI에게 보내기";
  elements.chatMessages.replaceChildren();
  if (!hasProject) {
    elements.chatMessages.className = "chat-messages empty-state";
    elements.chatMessages.textContent = "프로젝트를 선택하면 AI와 함께 작성할 수 있습니다.";
    return;
  }
  if (!state.chatConfigured) {
    elements.chatMessages.className = "chat-messages empty-state";
    elements.chatMessages.textContent = state.providerStatus?.message
      ?? (isCodex
        ? "AI 사용 정보에서 Codex 로그인을 시작하세요."
        : "공필 설정에서 OPENAI_API_KEY가 든 .env.local 파일을 선택하세요.");
    return;
  }
  elements.chatMessages.className = "chat-messages";
  for (const message of state.chatMessages) {
    elements.chatMessages.append(CreateChatMessage(message));
  }
  if (state.streamingText.length > 0) {
    elements.chatMessages.append(CreateChatMessage({ role: "assistant", content: state.streamingText }));
  }
  for (const proposal of state.proposals) {
    elements.chatMessages.append(CreateProposalCard(proposal));
  }
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

async function LoadProviderStatus() {
  const payload = RequirePayload(await runtime.Send("ai.provider.status", {}));
  state.providerStatus = payload.status;
  state.chatConfigured = payload.status?.configured === true;
  RenderChat();
}

async function ShowUsage() {
  const payload = RequirePayload(await runtime.Send("ai.usage.read", {}));
  state.providerStatus = payload.status;
  state.usage = payload.latest;
  elements.dialogEyebrow.textContent = "AI PROVIDER";
  elements.dialogTitle.textContent = "AI 사용 정보";
  elements.dialogContent.replaceChildren();
  const status = payload.status ?? {};
  const providerName = status.provider === "codex" ? "Codex Pro / ChatGPT" : "OpenAI API";
  elements.dialogContent.append(CreateInfoGrid([
    ["연결 방식", providerName],
    ["상태", status.configured ? "사용 가능" : "설정 필요"],
    ["모델", status.model ?? "확인 불가"],
    ["인증", status.authMode ?? (status.provider === "openai-api" ? "API 키" : "로그인 필요")],
    ["플랜", status.planType ?? (status.provider === "codex" ? "ChatGPT 구독" : "API 별도 과금")],
  ]));
  if (status.message) {
    const message = document.createElement("p");
    message.className = "dialog-notice";
    message.textContent = status.message;
    elements.dialogContent.append(message);
  }
  if (status.provider === "codex" && !status.configured) {
    const loginButton = document.createElement("button");
    loginButton.type = "button";
    loginButton.textContent = "ChatGPT로 Codex 로그인";
    loginButton.addEventListener("click", () => void RunAction(StartCodexLogin));
    elements.dialogContent.append(loginButton);
  }
  elements.dialogContent.append(CreateUsageSection(payload.latest, status.provider));
  if (status.rateLimits) {
    elements.dialogContent.append(CreateJsonDetails("구독 사용 한도 원본", status.rateLimits));
  }
  if (status.accountUsage) {
    elements.dialogContent.append(CreateJsonDetails("계정 사용량 원본", status.accountUsage));
  }
  elements.observabilityDialog.showModal();
}

async function StartCodexLogin() {
  const payload = RequirePayload(await runtime.Send("ai.provider.login.start", {}));
  if (typeof payload.authUrl === "string") {
    window.open(payload.authUrl, "_blank", "noopener,noreferrer");
    ShowToast("브라우저에서 로그인한 뒤 AI 사용 정보를 다시 여세요.");
  }
  else {
    ShowToast("Codex 로그인 요청을 시작했습니다.");
  }
}

async function ShowLogs() {
  const payload = RequirePayload(await runtime.Send("diagnostics.logs.read", { limit: 300 }));
  elements.dialogEyebrow.textContent = "DEVELOPER";
  elements.dialogTitle.textContent = "개발 로그";
  elements.dialogContent.replaceChildren();
  const description = document.createElement("p");
  description.className = "dialog-notice";
  description.textContent = "키·인증 URL·문서 내용·문서 경로는 이 로그에 기록하지 않습니다.";
  elements.dialogContent.append(description);
  const list = document.createElement("div");
  list.className = "log-list";
  for (const entry of payload.entries ?? []) {
    const row = document.createElement("article");
    row.className = "log-entry";
    row.dataset.level = entry.level;
    const heading = document.createElement("strong");
    heading.textContent = `${new Date(entry.timestamp).toLocaleString("ko-KR")} · ${entry.source} · ${entry.code}`;
    const message = document.createElement("span");
    message.textContent = entry.message;
    row.append(heading, message);
    if (entry.details) {
      const details = document.createElement("code");
      details.textContent = JSON.stringify(entry.details);
      row.append(details);
    }
    list.append(row);
  }
  if (list.childElementCount === 0) {
    list.textContent = "기록된 로그가 없습니다.";
  }
  elements.dialogContent.append(list);
  elements.observabilityDialog.showModal();
}

function CreateUsageSection(usage, provider) {
  const section = document.createElement("section");
  section.className = "usage-section";
  const title = document.createElement("h3");
  title.textContent = "최근 요청 토큰";
  section.append(title);
  if (!usage) {
    const empty = document.createElement("p");
    empty.textContent = "아직 이 실행에서 완료된 AI 요청이 없습니다.";
    section.append(empty);
    return section;
  }
  section.append(CreateInfoGrid([
    ["입력", FormatTokens(usage.inputTokens)],
    ["캐시 입력", FormatTokens(usage.cachedInputTokens)],
    ["출력", FormatTokens(usage.outputTokens)],
    ["추론 출력", FormatTokens(usage.reasoningOutputTokens)],
  ]));
  const cost = document.createElement("p");
  cost.className = "cost-summary";
  if (provider === "codex") {
    cost.textContent = "ChatGPT 구독 한도 사용 · API 달러 비용 없음";
  }
  else if (typeof usage.estimatedCostUsd === "number") {
    cost.textContent = `OpenAI API 예상 비용: $${usage.estimatedCostUsd.toFixed(6)} (표준 토큰 단가 기준)`;
  }
  else {
    cost.textContent = "OpenAI API 별도 과금 · 이 모델의 가격표를 찾지 못해 비용 추정 불가";
  }
  section.append(cost);
  return section;
}

function CreateInfoGrid(rows) {
  const grid = document.createElement("dl");
  grid.className = "info-grid";
  for (const [label, value] of rows) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = String(value);
    grid.append(term, description);
  }
  return grid;
}

function CreateJsonDetails(label, value) {
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = label;
  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify(value, null, 2);
  details.append(summary, pre);
  return details;
}

function FormatTokens(value) {
  return `${Number(value ?? 0).toLocaleString("ko-KR")} tokens`;
}

function CreateChatMessage(message) {
  const article = document.createElement("article");
  article.className = "chat-message";
  article.dataset.role = message.role;
  const label = document.createElement("span");
  label.className = "chat-role";
  label.textContent = message.role === "user" ? "나" : "공필 AI";
  const text = document.createElement("span");
  text.textContent = message.content;
  article.append(label, text);
  if (message.contextSnapshot) {
    article.append(RenderContextSnapshot(message.contextSnapshot));
  }
  return article;
}

function RenderContextSnapshot(snapshot) {
  const details = document.createElement("details");
  details.className = "context-snapshot";
  const summary = document.createElement("summary");
  summary.textContent = [
    `사용 출처 ${snapshot.includedSourceCount}/${snapshot.requestedSourceCount}`,
    `${snapshot.persona.name} v${snapshot.persona.version}`,
    snapshot.profile.name,
    `약 ${snapshot.estimatedInputTokens.toLocaleString("ko-KR")} tokens`,
  ].join(" · ");
  details.append(summary);
  for (const warningText of snapshot.warnings ?? []) {
    const warning = document.createElement("p");
    warning.className = "context-warning";
    warning.textContent = warningText;
    details.append(warning);
  }
  for (const source of snapshot.sources ?? []) {
    const sourceDetails = document.createElement("details");
    sourceDetails.className = "source-snapshot";
    const sourceSummary = document.createElement("summary");
    const selectionLabel = source.selectionKind === "explicit" ? "명시 선택" : "현재 문서";
    sourceSummary.textContent = `${selectionLabel} · ${source.path} · L${source.lineStart}-${source.lineEnd} · bytes ${source.byteStart}-${source.byteEnd} · rev ${source.revision.slice(0, 10)}`;
    const content = document.createElement("pre");
    content.textContent = source.content;
    sourceDetails.append(sourceSummary, content);
    details.append(sourceDetails);
  }
  return details;
}

function CreateProposalCard(proposal) {
  const article = document.createElement("article");
  article.className = "proposal-card";
  const title = document.createElement("h3");
  title.textContent = proposal.action === "create" ? "새 문서 제안" : "문서 수정 제안";
  const summary = document.createElement("p");
  summary.textContent = `${proposal.path} · ${proposal.summary}`;
  const details = document.createElement("details");
  const detailsSummary = document.createElement("summary");
  detailsSummary.textContent = "변경 전후 확인";
  const before = document.createElement("pre");
  before.className = "proposal-diff";
  before.textContent = `변경 전\n${proposal.beforeContent || "(새 문서)"}`;
  const after = document.createElement("pre");
  after.className = "proposal-diff";
  after.textContent = `변경 후\n${proposal.proposedContent}`;
  details.append(detailsSummary, before, after);
  article.append(title, summary, details);
  if (proposal.status !== "pending") {
    const status = document.createElement("p");
    status.className = "proposal-status";
    status.textContent = proposal.status === "applied" ? "적용됨" : "거절됨";
    article.append(status);
    return article;
  }
  const actions = document.createElement("div");
  actions.className = "proposal-actions";
  const applyButton = document.createElement("button");
  applyButton.type = "button";
  applyButton.textContent = "적용";
  applyButton.addEventListener("click", () => void RunAction(() => ResolveProposal(proposal, "apply")));
  const rejectButton = document.createElement("button");
  rejectButton.type = "button";
  rejectButton.className = "reject-button";
  rejectButton.textContent = "거절";
  rejectButton.addEventListener("click", () => void RunAction(() => ResolveProposal(proposal, "reject")));
  actions.append(applyButton, rejectButton);
  article.append(actions);
  return article;
}

async function ResolveProposal(proposal, action) {
  const payload = RequirePayload(await runtime.Send(`proposal.${action}`, {
    projectId: state.activeProject.projectId,
    proposalId: proposal.proposalId,
  }));
  await RefreshDocuments();
  await LoadChatSession();
  if (action === "apply" && payload.document !== undefined) {
    await OpenDocument(payload.document.path);
  }
  ShowToast(action === "apply" ? "AI 변경안을 문서에 적용했습니다." : "AI 변경안을 거절했습니다.");
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
elements.usageButton.addEventListener("click", () => void RunAction(ShowUsage));
elements.logsButton.addEventListener("click", () => void RunAction(ShowLogs));
elements.dialogCloseButton.addEventListener("click", () => elements.observabilityDialog.close());
elements.personaSelect.addEventListener("change", () => {
  const persona = state.personaWorkspace?.personas.find((candidate) => candidate.personaId === elements.personaSelect.value);
  const versionId = persona?.versions.at(-1)?.versionId;
  if (versionId) {
    void RunAction(() => UpdatePersonaSelection({ personaId: persona.personaId, versionId }));
  }
});
elements.personaVersionSelect.addEventListener("change", () => {
  void RunAction(() => UpdatePersonaSelection({ versionId: elements.personaVersionSelect.value }));
});
elements.profileSelect.addEventListener("change", () => {
  void RunAction(() => UpdatePersonaSelection({ profileId: elements.profileSelect.value }));
});
elements.personaVersionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const mode = event.submitter?.value;
  void RunAction(() => SavePersonaVersion(mode));
});
elements.profileForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const mode = event.submitter?.value;
  void RunAction(() => SaveWorkProfile(mode));
});
elements.chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void RunAction(SendChatMessage);
});
elements.chunkSearchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void RunAction(SearchChunks);
});
elements.selectVisibleChunksButton.addEventListener("click", () => {
  for (const chunk of state.chunks) {
    state.selectedChunkIds.add(chunk.chunkId);
    state.selectedChunkPaths.set(chunk.chunkId, chunk.path);
  }
  RenderContextSelection();
});
elements.clearChunkSelectionButton.addEventListener("click", () => {
  state.selectedChunkIds.clear();
  state.selectedChunkPaths.clear();
  RenderContextSelection();
});
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
    void RunAction(() => LoadChunks(state.activeDocument?.path));
  }
  if (event.eventName === "chat.message.delta" && event.payload.projectId === state.activeProject?.projectId) {
    state.streamingText += event.payload.delta ?? "";
    RenderChat();
  }
  if (["chat.message.completed", "proposal.created", "proposal.applied", "proposal.rejected"].includes(event.eventName)
    && event.payload.projectId === state.activeProject?.projectId) {
    void RunAction(LoadChatSession);
  }
});

window.addEventListener("beforeunload", (event) => {
  if (state.dirty) {
    event.preventDefault();
  }
});

void RunAction(async () => {
  await Promise.all([LoadProjects(), LoadProviderStatus()]);
  RenderPersonaWorkspace();
  RenderContextSelection();
});
