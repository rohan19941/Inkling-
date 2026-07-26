import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

const DEFAULT_SETTINGS = {
  persona: "companion",
  creativity: 0.7,
  writingGoal: "story",
};

function db() {
  return getStore("inkling-db");
}

async function getUser(id) {
  return (await db().get(`user:${id}`, { type: "json" })) || null;
}

async function saveUser(user) {
  await db().setJSON(`user:${user.id}`, user);
  return user;
}

async function listThreadIds(userId) {
  return (await db().get(`threads-by-user:${userId}`, { type: "json" })) || [];
}

async function saveThreadIds(userId, ids) {
  await db().setJSON(`threads-by-user:${userId}`, ids);
}

export const store = {
  async upsertUser(profile) {
    const existing = await getUser(profile.id);
    const user = {
      id: profile.id,
      name: profile.name,
      email: profile.email,
      avatar: profile.avatar || null,
      settings: existing?.settings || { ...DEFAULT_SETTINGS },
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    return saveUser(user);
  },

  async getUser(id) {
    return getUser(id);
  },

  async getSettings(userId) {
    const user = await getUser(userId);
    return user?.settings || { ...DEFAULT_SETTINGS };
  },

  async updateSettings(userId, patch) {
    const user = await getUser(userId);
    if (!user) return null;
    user.settings = { ...user.settings, ...patch };
    await saveUser(user);
    return user.settings;
  },

  async listThreads(userId) {
    const ids = await listThreadIds(userId);
    const threads = await Promise.all(ids.map((id) => db().get(`thread:${id}`, { type: "json" })));
    return threads
      .filter(Boolean)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map((t) => ({
        id: t.id,
        title: t.title,
        updatedAt: t.updatedAt,
        preview: t.messages[t.messages.length - 1]?.content?.slice(0, 90) || "",
      }));
  },

  async createThread(userId, title) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const thread = { id, userId, title: title || "Untitled entry", messages: [], createdAt: now, updatedAt: now };
    await db().setJSON(`thread:${id}`, thread);
    const ids = await listThreadIds(userId);
    ids.unshift(id);
    await saveThreadIds(userId, ids);
    return thread;
  },

  async getThread(userId, threadId) {
    const thread = await db().get(`thread:${threadId}`, { type: "json" });
    if (!thread || thread.userId !== userId) return null;
    return thread;
  },

  async addMessage(userId, threadId, message) {
    const thread = await this.getThread(userId, threadId);
    if (!thread) return null;
    thread.messages.push(message);
    thread.updatedAt = new Date().toISOString();
    if (thread.title === "Untitled entry" && message.role === "user") {
      thread.title = message.content.slice(0, 48) + (message.content.length > 48 ? "…" : "");
    }
    await db().setJSON(`thread:${threadId}`, thread);
    return thread;
  },

  async deleteThread(userId, threadId) {
    const thread = await this.getThread(userId, threadId);
    if (!thread) return false;
    await db().delete(`thread:${threadId}`);
    const ids = (await listThreadIds(userId)).filter((id) => id !== threadId);
    await saveThreadIds(userId, ids);
    return true;
  },
};
