import type { Context, Config } from "@netlify/functions";
import { getUserIdFromRequest } from "./lib/session.mts";
import { store } from "./lib/store.mts";
import { generateReply, listPersonas, researchTopic } from "./lib/aiAgent.mts";

function json(data: unknown, init: { status?: number } = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: { "content-type": "application/json" },
  });
}

export default async (req: Request, _context: Context) => {
  const uid = getUserIdFromRequest(req);
  if (!uid) return json({ error: "Not signed in." }, { status: 401 });

  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean); // e.g. ["api","chat","threads",":id","messages"]

  // ---- /api/settings ----
  if (segments[1] === "settings") {
    if (req.method === "GET") {
      const settings = await store.getSettings(uid);
      return json({ settings, personas: listPersonas() });
    }
    if (req.method === "PUT") {
      const body = await req.json().catch(() => ({}));
      const patch: Record<string, unknown> = {};
      if (body.persona) patch.persona = body.persona;
      if (typeof body.creativity === "number") patch.creativity = Math.min(1, Math.max(0, body.creativity));
      if (body.writingGoal) patch.writingGoal = body.writingGoal;
      const settings = await store.updateSettings(uid, patch);
      return json({ settings });
    }
  }

  // ---- POST /api/chat/research ----
  if (segments[1] === "chat" && segments[2] === "research" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const topic = (body.topic || "").trim();
    if (!topic) return json({ error: "Topic can't be empty." }, { status: 400 });

    try {
      const options = await researchTopic(topic);
      return json({ options });
    } catch (err: any) {
      if (err.code === "NO_API_KEY") {
        return json(
          { error: "This site doesn't have an Anthropic API key configured yet." },
          { status: 503 }
        );
      }
      console.error(err);
      return json({ error: "Couldn't research that topic just now. Try again in a moment." }, { status: 502 });
    }
  }

  // ---- /api/chat/threads ----
  if (segments[1] === "chat" && segments[2] === "threads") {
    const threadId = segments[3];
    const subresource = segments[4];

    // GET /api/chat/threads
    if (!threadId && req.method === "GET") {
      const threads = await store.listThreads(uid);
      return json({ threads });
    }

    // POST /api/chat/threads
    if (!threadId && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const thread = await store.createThread(uid, body.title);
      if (body.seedMessage) {
        const seed = { role: "assistant", content: body.seedMessage, at: new Date().toISOString() };
        const updated = await store.addMessage(uid, thread.id, seed);
        return json({ thread: updated });
      }
      return json({ thread });
    }

    // GET /api/chat/threads/:id
    if (threadId && !subresource && req.method === "GET") {
      const thread = await store.getThread(uid, threadId);
      if (!thread) return json({ error: "Entry not found." }, { status: 404 });
      return json({ thread });
    }

    // DELETE /api/chat/threads/:id
    if (threadId && !subresource && req.method === "DELETE") {
      const ok = await store.deleteThread(uid, threadId);
      if (!ok) return json({ error: "Entry not found." }, { status: 404 });
      return json({ ok: true });
    }

    // POST /api/chat/threads/:id/messages
    if (threadId && subresource === "messages" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const content = (body.content || "").trim();
      if (!content) return json({ error: "Message can't be empty." }, { status: 400 });

      const thread = await store.getThread(uid, threadId);
      if (!thread) return json({ error: "Entry not found." }, { status: 404 });

      const userMessage = { role: "user", content, at: new Date().toISOString() };
      await store.addMessage(uid, threadId, userMessage);

      const settings = await store.getSettings(uid);

      try {
        const replyText = await generateReply({
          persona: settings.persona,
          writingGoal: settings.writingGoal,
          creativity: settings.creativity,
          messages: [...thread.messages, userMessage],
        });

        const agentMessage = { role: "assistant", content: replyText, at: new Date().toISOString() };
        const updatedThread = await store.addMessage(uid, threadId, agentMessage);

        return json({ message: agentMessage, thread: updatedThread });
      } catch (err: any) {
        if (err.code === "NO_API_KEY") {
          return json(
            { error: "This site doesn't have an Anthropic API key configured yet. Add ANTHROPIC_API_KEY in Site settings → Environment variables." },
            { status: 503 }
          );
        }
        console.error(err);
        return json({ error: "The writing agent couldn't respond just now. Try again in a moment." }, { status: 502 });
      }
    }
  }

  return json({ error: "Not found" }, { status: 404 });
};

export const config: Config = {
  path: "/api/*",
};    
