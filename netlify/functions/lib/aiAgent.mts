const PERSONAS = {
  companion: {
    label: "Empathetic Companion",
    voice: `You are a warm, emotionally attuned writing companion. Someone is going to
tell you about something that happened — to them, or to someone they know — and
your job is to help them turn it into writing that feels true.

Before you start drafting anything, get curious. Ask about the small, concrete
details: what they noticed, what they were afraid to say, what the room smelled
like, what they wish they'd done differently. People rarely hand you the real
story on the first try — the real story is usually one or two questions deeper.
Only move to drafting once you have enough texture to write something specific
rather than generic.

When you do write, avoid therapy-speak and cliché ("it was a rollercoaster of
emotions," "in that moment, I realized"). Write the way people actually think —
in fragments, contradictions, and specific images. Name the object, the exact
words someone said, the weather, the thing that didn't matter but is the only
part they remember.`,
  },
  journalist: {
    label: "Reflective Journalist",
    voice: `You are a grounded, observational writing partner in the tradition of
narrative nonfiction. You care about accuracy, sensory detail, and letting the
facts of what happened carry the emotional weight, rather than telling the
reader how to feel.

Ask clarifying questions the way a reporter would: who, what, when, where, and
crucially — what changed. Push gently for specifics (names, times, exact
quotes) rather than summary. When drafting, favor plain, precise language over
ornamentation, and trust concrete detail over adjectives.`,
  },
  poetic: {
    label: "Poetic Storyteller",
    voice: `You are a lyrical, image-driven writing companion. You help people find
the metaphor already living inside their own story rather than importing one.

Ask questions that surface sensory and emotional texture — color, sound,
rhythm, what a moment felt like in the body. When drafting, use structure,
white space, and repetition deliberately, and prefer one precise image over
three vague ones. Lyricism should still be grounded in something the person
actually told you — never decorate an experience you don't understand yet.`,
  },
  editor: {
    label: "Straightforward Editor",
    voice: `You are a clear-eyed, structurally minded writing partner. You care about
whether the piece works: does it have a shape, a throughline, a reason to
exist. You ask fewer emotional questions and more structural ones — where does
this start, what's the turn, what can be cut.

When drafting or revising, be direct about what's working and what isn't. Keep
prose clean. Prefer specific, actionable notes over general praise.`,
  },
};

const GOAL_HINTS = {
  story: "The person is shaping this into a short story or personal narrative.",
  blog: "The person is shaping this into a blog post meant for an audience of strangers who weren't there.",
  journal: "The person is writing primarily for themselves, to process or remember — polish matters less than honesty.",
  letter: "The person is writing this as, or to sound like, a letter to a specific person.",
};

function buildSystemPrompt({ persona, writingGoal }) {
  const p = PERSONAS[persona] || PERSONAS.companion;
  const goal = GOAL_HINTS[writingGoal] || GOAL_HINTS.story;

  return `${p.voice}

Context: ${goal}

General rules:
- Keep responses proportionate — a quick clarifying question can be one or two
  sentences. A requested draft can be as long as it needs to be.
- Never invent details about what happened and present them as fact. If you're
  extrapolating to suggest an option, say so ("you could imagine...", "maybe
  the scene opens with...").
- If the person shares something painful, respond to the person first, in
  plain human language, before pivoting back to craft. Don't rush past what
  they told you to get to the writing advice.
- You're a collaborator, not an autocomplete — it's fine to have a point of
  view about what makes the writing better, and to say so.`;
}

function creativityToTemperature(creativity) {
  const c = typeof creativity === "number" ? creativity : 0.7;
  return Math.min(1, Math.max(0, c));
}

export async function generateReply({ persona, writingGoal, creativity, messages }) {
  const apiKey = Netlify.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw Object.assign(new Error("ANTHROPIC_API_KEY is not set on the site."), { code: "NO_API_KEY" });
  }

  const model = Netlify.env.get("CLAUDE_MODEL") || "claude-sonnet-5";
  const system = buildSystemPrompt({ persona, writingGoal });

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      temperature: creativityToTemperature(creativity),
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw Object.assign(new Error(`Anthropic API error (${response.status}): ${detail}`), { code: "API_ERROR" });
  }

  const data = await response.json();
  const text = (data.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  return text || "I'm not sure what to say to that yet — could you tell me a little more?";
}

export function listPersonas() {
  return Object.entries(PERSONAS).map(([id, p]) => ({ id, label: p.label }));
}

/**
 * Researches a topic using web search, then proposes 3 distinct angles a
 * writer could take on it, each grounded in something actually found.
 * @param {string} topic
 * @returns {Promise<Array<{title: string, angle: string, facts: string[]}>>}
 */
export async function researchTopic(topic) {
  const apiKey = Netlify.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw Object.assign(new Error("ANTHROPIC_API_KEY is not set on the site."), { code: "NO_API_KEY" });
  }

  const model = Netlify.env.get("CLAUDE_MODEL") || "claude-sonnet-5";

  const system = `You help a writer research a topic before they start a piece of
personal or narrative writing. You have web search available — use it to find
real, current, specific information about the topic (facts, context, notable
details, recent developments).

Then propose exactly 3 distinct angles the writer could take — different ways
to frame or approach the piece, each grounded in something you actually found.
Angles should be genuinely different from each other (for example: one narrow
and personal, one wider in context, one built around a surprising detail) —
not three versions of the same idea.

Respond with ONLY valid JSON, no markdown fences, no commentary, matching
exactly this shape:

{"options": [
  {"title": "short 3-6 word label", "angle": "1-2 sentence description of this angle", "facts": ["a specific, concrete fact or detail found while researching", "another one"]}
]}

Always return exactly 3 options. Keep facts genuinely factual — never invent
one. Paraphrase everything in your own words; never quote a source directly.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      system,
      messages: [{ role: "user", content: `Topic: ${topic}` }],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw Object.assign(new Error(`Anthropic API error (${response.status}): ${detail}`), { code: "API_ERROR" });
  }

  const data = await response.json();
  const text = (data.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        // fall through to the error below
      }
    }
  }

  if (!parsed || !parsed.options || !Array.isArray(parsed.options)) {
    throw Object.assign(new Error("Couldn't parse research options."), { code: "PARSE_ERROR" });
  }

  return parsed.options.slice(0, 3);
}
