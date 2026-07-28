/* ---------- constants ---------- */

const PERSONAS = [
  { id: "companion", label: "Empathetic Companion", desc: "Warm, curious, asks before it writes." },
  { id: "journalist", label: "Reflective Journalist", desc: "Grounded, detail-first, lets facts carry weight." },
  { id: "poetic", label: "Poetic Storyteller", desc: "Image-driven, lyrical, finds the metaphor in it." },
  { id: "editor", label: "Straightforward Editor", desc: "Direct notes on structure and shape." },
];

const PREVIEW_QUESTIONS = [
  "Before we get into writing this — where were you when it happened? I want the actual room, not the summary.",
  "That's a start. What's the detail you keep coming back to, even though it doesn't seem important?",
  "Okay. And what did you want to say in that moment, that you didn't?",
];

/* ---------- state ---------- */

const state = {
  preview: sessionStorage.getItem("inkling_preview") === "1",
  user: null,
  settings: { persona: "companion", creativity: 0.7, writingGoal: "story" },
  threads: [],
  activeThreadId: null,
  activeMessages: [],
  previewTurn: 0,
};

/* ---------- dom refs ---------- */

const el = (id) => document.getElementById(id);
const conversationInner = el("conversation-inner");
const emptyState = el("empty-state");
const threadList = el("thread-list");
const threadTitleLabel = el("thread-title-label");
const composerInput = el("composer-input");
const sendBtn = el("send-btn");
const userAvatar = el("user-avatar");
const personaChip = el("persona-chip");

/* ---------- api helper (falls back to local simulation in preview mode) ---------- */

async function api(path, options = {}) {
  if (state.preview) return null; // caller handles preview branching
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (res.status === 401) {
    window.location.href = "index.html";
    throw new Error("unauthenticated");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "Request failed"), { data });
  return data;
}

/* ---------- init ---------- */

async function init() {
  if (state.preview) {
    state.user = { name: "Guest Writer", email: null };
    renderUser();
    renderPersonaChip();
    renderThreadList();
    buildPersonaGrid();
    buildGoalGrid();
    el("creativity-range").value = state.settings.creativity;
    setKeyStatus("warn", "Preview mode — connect the backend to talk to the real agent.");
    showEmpty();
    wireEvents();
    return;
  }

  try {
    const me = await api("/auth/me");
    state.user = me.user;
    renderUser();

    const settingsRes = await api("/api/settings");
    state.settings = settingsRes.settings;
    renderPersonaChip();
    buildPersonaGrid();
    buildGoalGrid();
    el("creativity-range").value = state.settings.creativity;
    setKeyStatus("ok", "Agent connected.");

    const threadsRes = await api("/api/chat/threads");
    state.threads = threadsRes.threads;
    renderThreadList();
    showEmpty();
  } catch (err) {
    console.error(err);
  }

  wireEvents();
}

function renderUser() {
  const initials = (state.user?.name || "G").trim().charAt(0).toUpperCase();
  if (state.user?.avatar) {
    userAvatar.innerHTML = `<img src="${state.user.avatar}" alt="" />`;
    el("settings-avatar").innerHTML = `<img src="${state.user.avatar}" alt="" />`;
  } else {
    userAvatar.textContent = initials;
    el("settings-avatar").textContent = initials;
  }
  el("settings-name").textContent = state.user?.name || "Guest Writer";
  el("settings-email").textContent = state.user?.email || "";
}

function renderPersonaChip() {
  const p = PERSONAS.find((p) => p.id === state.settings.persona);
  personaChip.textContent = p ? p.label.replace("Empathetic ", "").replace("Reflective ", "").replace("Straightforward ", "") : "Companion";
}

/* ---------- threads ---------- */

function renderThreadList() {
  threadList.innerHTML = "";
  if (!state.threads.length) {
    threadList.innerHTML = `<div class="thread-empty">Your entries will show up here once you start writing.</div>`;
    return;
  }
  state.threads.forEach((t) => {
    const btn = document.createElement("button");
    btn.className = "thread-item" + (t.id === state.activeThreadId ? " active" : "");
    btn.innerHTML = `<span class="t-title">${escapeHtml(t.title)}</span><span class="t-preview">${escapeHtml(t.preview || "")}</span>`;
    btn.addEventListener("click", () => openThread(t.id));
    threadList.appendChild(btn);
  });
}

async function newEntry() {
  if (state.preview) {
    state.activeThreadId = "preview";
    state.activeMessages = [];
    state.previewTurn = 0;
    state.threads.unshift({ id: "preview", title: "Untitled entry", updatedAt: new Date().toISOString(), preview: "" });
    renderThreadList();
    renderMessages();
    threadTitleLabel.textContent = "Untitled entry";
    return;
  }
  try {
    const { thread } = await api("/api/chat/threads", { method: "POST", body: JSON.stringify({}) });
    state.threads.unshift({ id: thread.id, title: thread.title, updatedAt: thread.updatedAt, preview: "" });
    openThread(thread.id);
  } catch (err) {
    console.error(err);
  }
}

async function openThread(id) {
  state.activeThreadId = id;
  renderThreadList();

  if (state.preview) {
    renderMessages();
    return;
  }

  try {
    const { thread } = await api(`/api/chat/threads/${id}`);
    state.activeMessages = thread.messages;
    threadTitleLabel.textContent = thread.title;
    renderMessages();
  } catch (err) {
    console.error(err);
  }
}

function showEmpty() {
  emptyState.style.display = state.activeThreadId ? "none" : "block";
}

/* ---------- messages ---------- */

function renderMessages() {
  conversationInner.innerHTML = "";
  emptyState.style.display = state.activeMessages.length ? "none" : "block";
  state.activeMessages.forEach((m) => appendMessageEl(m.role, m.content));
  scrollToBottom();
}

function appendMessageEl(role, content) {
  const row = document.createElement("div");
  row.className = `msg ${role}`;
  const avatar =
    role === "assistant"
      ? `<div class="msg-avatar"><span class="pulse-dot"></span></div>`
      : "";
  row.innerHTML = `${avatar}<div class="bubble"></div>`;
  row.querySelector(".bubble").textContent = content;
  conversationInner.appendChild(row);
  return row;
}

function scrollToBottom() {
  const c = el("conversation");
  c.scrollTop = c.scrollHeight;
}

function autoGrow() {
  composerInput.style.height = "auto";
  composerInput.style.height = Math.min(composerInput.scrollHeight, 200) + "px";
}

async function sendMessage() {
  const content = composerInput.value.trim();
  if (!content) return;

  if (!state.activeThreadId) await newEntry();

  composerInput.value = "";
  autoGrow();
  sendBtn.disabled = true;
  emptyState.style.display = "none";

  state.activeMessages.push({ role: "user", content });
  appendMessageEl("user", content);
  scrollToBottom();

  const statusRow = document.createElement("div");
  statusRow.className = "status-row";
  statusRow.innerHTML = `<span class="pulse-dot"></span><span class="status-text">listening…</span>`;
  conversationInner.appendChild(statusRow);
  scrollToBottom();

  const statusText = statusRow.querySelector(".status-text");
  const stages = ["listening…", "reflecting…", "writing…"];
  let stageIndex = 0;
  const stageTimer = setInterval(() => {
    stageIndex = (stageIndex + 1) % stages.length;
    statusText.textContent = stages[stageIndex];
  }, 900);

  try {
    let replyText;
    if (state.preview) {
      await wait(1600);
      replyText =
        PREVIEW_QUESTIONS[Math.min(state.previewTurn, PREVIEW_QUESTIONS.length - 1)];
      state.previewTurn += 1;
    } else {
      const { message } = await api(`/api/chat/threads/${state.activeThreadId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content }),
      });
      replyText = message.content;
    }

    clearInterval(stageTimer);
    statusRow.remove();
    state.activeMessages.push({ role: "assistant", content: replyText });
    appendMessageEl("assistant", replyText);
    scrollToBottom();

    if (!state.preview) {
      const threadsRes = await api("/api/chat/threads");
      state.threads = threadsRes.threads;
      const active = state.threads.find((t) => t.id === state.activeThreadId);
      if (active) threadTitleLabel.textContent = active.title;
      renderThreadList();
    }
  } catch (err) {
    clearInterval(stageTimer);
    statusRow.remove();
    appendMessageEl("assistant", err.message || "Something went wrong — please try again.");
    scrollToBottom();
  } finally {
    sendBtn.disabled = false;
  }
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

/* ---------- research ---------- */

function openResearchModal() {
  el("research-topic-input").value = "";
  showResearchStep("topic");
  el("research-overlay").classList.add("show");
  el("research-modal").classList.add("show");
}

function closeResearchModal() {
  el("research-overlay").classList.remove("show");
  el("research-modal").classList.remove("show");
}

function showResearchStep(step) {
  ["topic", "loading", "options"].forEach((s) => {
    el(`research-step-${s}`).style.display = s === step ? "block" : "none";
  });
}

async function runResearch() {
  const topic = el("research-topic-input").value.trim();
  if (!topic) return;
  showResearchStep("loading");

  const loadingText = el("research-loading-text");
  const stages = ["researching…", "reading around…", "shaping angles…"];
  let i = 0;
  const timer = setInterval(() => {
    i = (i + 1) % stages.length;
    loadingText.textContent = stages[i];
  }, 1100);

  try {
    let options;
    if (state.preview) {
      await wait(1800);
      options = [
        {
          title: "The detail nobody noticed",
          angle: "Focus on one small, overlooked detail and build the piece outward from it.",
          facts: ["Preview mode — connect the backend for real research."],
        },
        {
          title: "A wider lens",
          angle: "Place this topic in a larger context — what does it represent beyond itself?",
          facts: ["Preview mode — no live research performed."],
        },
        {
          title: "A personal thread",
          angle: "Anchor the piece in a specific, personal moment connected to this topic.",
          facts: ["Preview mode — no live research performed."],
        },
      ];
    } else {
      const res = await api("/api/chat/research", { method: "POST", body: JSON.stringify({ topic }) });
      options = res.options;
    }
    clearInterval(timer);
    renderResearchOptions(topic, options);
    showResearchStep("options");
  } catch (err) {
    clearInterval(timer);
    console.error(err);
    showResearchStep("topic");
    alert(err.message || "Couldn't research that topic just now — try again, or skip and start writing directly.");
  }
}

function renderResearchOptions(topic, options) {
  const wrap = el("research-options");
  wrap.innerHTML = "";
  (options || []).forEach((opt) => {
    const btn = document.createElement("button");
    btn.className = "persona-card";
    btn.innerHTML = `<div class="p-name"></div><div class="p-desc"></div>`;
    btn.querySelector(".p-name").textContent = opt.title || "Untitled angle";
    btn.querySelector(".p-desc").textContent = opt.angle || "";
    btn.addEventListener("click", () => startEntryFromResearch(topic, opt));
    wrap.appendChild(btn);
  });
}

async function startEntryFromResearch(topic, option) {
  closeResearchModal();
  const factsList = (option.facts || []).map((f) => `- ${f}`).join("\n");
  const seedText = `Topic: ${topic}\n\nAngle: ${option.angle}${
    factsList ? `\n\nWhat I found:\n${factsList}` : ""
  }\n\nLet's start from here — tell me what actually happened, in your own words.`;

  if (state.preview) {
    state.activeThreadId = "preview";
    state.activeMessages = [{ role: "assistant", content: seedText }];
    state.previewTurn = 0;
    state.threads.unshift({ id: "preview", title: topic.slice(0, 48), updatedAt: new Date().toISOString(), preview: "" });
    renderThreadList();
    renderMessages();
    threadTitleLabel.textContent = topic.slice(0, 48);
    return;
  }

  try {
    const { thread } = await api("/api/chat/threads", {
      method: "POST",
      body: JSON.stringify({ title: topic, seedMessage: seedText }),
    });
    state.threads.unshift({ id: thread.id, title: thread.title, updatedAt: thread.updatedAt, preview: "" });
    openThread(thread.id);
  } catch (err) {
    console.error(err);
  }
}

/* ---------- settings panel ---------- */

function buildPersonaGrid() {
  const grid = el("persona-grid");
  grid.innerHTML = "";
  PERSONAS.forEach((p) => {
    const btn = document.createElement("button");
    btn.className = "persona-card" + (p.id === state.settings.persona ? " active" : "");
    btn.innerHTML = `<div class="p-name">${p.label}</div><div class="p-desc">${p.desc}</div>`;
    btn.addEventListener("click", () => updateSettings({ persona: p.id }));
    grid.appendChild(btn);
  });
}

function buildGoalGrid() {
  document.querySelectorAll(".goal-chip").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.goal === state.settings.writingGoal);
    chip.addEventListener("click", () => updateSettings({ writingGoal: chip.dataset.goal }));
  });
}

async function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  buildPersonaGrid();
  buildGoalGrid();
  renderPersonaChip();
  if (state.preview) return;
  try {
    await api("/api/settings", { method: "PUT", body: JSON.stringify(patch) });
  } catch (err) {
    console.error(err);
  }
}

function setKeyStatus(kind, text) {
  const row = el("key-status");
  row.querySelector(".dot").className = `dot ${kind}`;
  row.querySelector("span:last-child").textContent = text;
}

function openSettings() {
  el("overlay").classList.add("show");
  el("settings-panel").classList.add("show");
}
function closeSettings() {
  el("overlay").classList.remove("show");
  el("settings-panel").classList.remove("show");
}

function exportEntry() {
  const title = state.threads.find((t) => t.id === state.activeThreadId)?.title || "inkling-entry";
  const text = state.activeMessages.map((m) => `${m.role === "user" ? "You" : "Safayer"}: ${m.content}`).join("\n\n");
  const blob = new Blob([text], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${title.replace(/[^\w\-]+/g, "_").slice(0, 40) || "inkling-entry"}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function deleteEntry() {
  if (!state.activeThreadId) return;
  if (!confirm("Delete this entry? This can't be undone.")) return;

  if (!state.preview) {
    try {
      await api(`/api/chat/threads/${state.activeThreadId}`, { method: "DELETE" });
    } catch (err) {
      console.error(err);
      return;
    }
  }
  state.threads = state.threads.filter((t) => t.id !== state.activeThreadId);
  state.activeThreadId = null;
  state.activeMessages = [];
  threadTitleLabel.textContent = "";
  renderThreadList();
  renderMessages();
}

async function logout() {
  if (state.preview) {
    sessionStorage.removeItem("inkling_preview");
    window.location.href = "index.html";
    return;
  }
  try {
    await api("/auth/logout", { method: "POST" });
  } catch (err) {
    console.error(err);
  }
  window.location.href = "index.html";
}

/* ---------- wiring ---------- */

function wireEvents() {
  el("new-entry-btn").addEventListener("click", openResearchModal);
  el("research-go-btn").addEventListener("click", runResearch);
  el("research-skip-btn").addEventListener("click", () => {
    closeResearchModal();
    newEntry();
  });
  el("research-back-btn").addEventListener("click", () => showResearchStep("topic"));
  el("research-overlay").addEventListener("click", closeResearchModal);
  sendBtn.addEventListener("click", sendMessage);
  composerInput.addEventListener("input", autoGrow);
  composerInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  el("settings-btn").addEventListener("click", openSettings);
  el("close-settings").addEventListener("click", closeSettings);
  el("overlay").addEventListener("click", closeSettings);

  el("creativity-range").addEventListener("change", (e) => {
    updateSettings({ creativity: parseFloat(e.target.value) });
  });

  el("export-btn").addEventListener("click", exportEntry);
  el("clear-btn").addEventListener("click", deleteEntry);
  el("logout-btn").addEventListener("click", logout);
}

init();

