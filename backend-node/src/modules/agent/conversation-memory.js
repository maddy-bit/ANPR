/**
 * Conversation Memory & Multi-Turn State Manager
 * Tracks active investigation context (activePlate, activeCase, history) per session.
 *
 * Session isolation: every session is scoped to an ACTOR. The controller derives
 * the actor from authenticated credentials when present (Basic-auth username);
 * unauthenticated callers share the single 'anonymous' namespace. This prevents
 * one authenticated user from reading or continuing another user's conversation
 * by supplying the same conversationId. Cross-actor reads return null (404).
 */

const crypto = require('crypto');

const sessions = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

const ANONYMOUS_ACTOR = 'anonymous';

/**
 * Derives the actor identity for a request. Prefers authenticated users;
 * callers without credentials fall into the shared anonymous namespace.
 */
function resolveActor(req) {
  return (req && req.user && req.user.username) || ANONYMOUS_ACTOR;
}

function scopedKey(actor, conversationId) {
  return `${actor}::${conversationId}`;
}

function getOrCreateSession(actor, conversationId) {
  const id = conversationId || crypto.randomUUID();
  const key = scopedKey(actor || ANONYMOUS_ACTOR, id);
  let session = sessions.get(key);

  if (!session || Date.now() - session.updatedAt > SESSION_TTL_MS) {
    session = {
      id,
      actor: actor || ANONYMOUS_ACTOR,
      activePlate: null,
      activeCaseId: null,
      history: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    sessions.set(key, session);
  }

  session.updatedAt = Date.now();
  return session;
}

function updateSession(actor, id, updates = {}) {
  const session = getOrCreateSession(actor, id);
  if (updates.activePlate) session.activePlate = updates.activePlate;
  if (updates.activeCaseId) session.activeCaseId = updates.activeCaseId;
  if (updates.message) session.history.push(updates.message);
  session.updatedAt = Date.now();
  return session;
}

/**
 * Reads a session only when it belongs to the given actor. A session created
 * by another actor is indistinguishable from a nonexistent one (both null).
 */
function getSession(actor, id) {
  return sessions.get(scopedKey(actor || ANONYMOUS_ACTOR, id)) || null;
}

module.exports = {
  getOrCreateSession,
  updateSession,
  getSession,
  resolveActor,
  ANONYMOUS_ACTOR,
};
