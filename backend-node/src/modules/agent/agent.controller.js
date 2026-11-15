/**
 * Agent Controller
 */

const agentService = require('./agent.service');
const memory = require('./conversation-memory');
const toolRegistry = require('./tool-registry');

async function chat(req, res, next) {
  try {
    const { message, conversationId, caseId, activeCaseId, activePlate } = req.body;
    const actor = memory.resolveActor(req);
    const response = await agentService.processUserMessage({
      message,
      conversationId,
      caseId: caseId || activeCaseId || null,
      activePlate: activePlate || null,
      actor,
    });
    return res.json(response);
  } catch (err) {
    return next(err);
  }
}

async function getConversation(req, res, next) {
  try {
    // Cross-actor reads are rejected by scoping: another user's session is
    // indistinguishable from a nonexistent one.
    const session = memory.getSession(memory.resolveActor(req), req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Conversation session not found or expired' });
    }
    return res.json(session);
  } catch (err) {
    return next(err);
  }
}

async function listTools(req, res, next) {
  try {
    const toolNames = toolRegistry.getToolNames();
    return res.json({ tools: toolNames });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  chat,
  getConversation,
  listTools,
};
