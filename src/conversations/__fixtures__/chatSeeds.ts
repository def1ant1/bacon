import { ConversationMessage } from "../ConversationMessageService"
import { ConversationPage, ConversationSummary } from "../types"

// Centralized, deterministic fixture data keeps chat-flow tests repeatable and
// portable across unit/integration suites. Timestamps stay fixed so snapshot
// and sequencing assertions never flake when they cross timezones or CI
// machines.
const baseTimestamp = "2024-01-01T00:00:00.000Z"

export const seedConversations: ConversationSummary[] = [
  {
    id: "c-seed-1",
    title: "Premium",
    lastMessageAt: baseTimestamp,
  },
  {
    id: "c-seed-2",
    title: "Standard",
    lastMessageAt: baseTimestamp,
  },
]

export const seedMessages: Record<string, ConversationMessage[]> = {
  "c-seed-1": [
    {
      id: "m-seed-1",
      conversationId: "c-seed-1",
      sender: "user",
      text: "Hi team",
      createdAt: baseTimestamp,
    },
  ],
  "c-seed-2": [
    {
      id: "m-seed-2",
      conversationId: "c-seed-2",
      sender: "agent",
      text: "Following up",
      createdAt: baseTimestamp,
    },
  ],
}

/**
 * Helper to build a paginated response with predictable cursors so infinite
 * scroll tests can assert order without needing to fabricate network delays.
 */
export function createSeedPage(nextCursor?: string): ConversationPage {
  return {
    conversations: seedConversations,
    nextCursor,
  }
}

/**
 * Reusable message histories that mimic the live service contract. Keeping a
 * single source of truth avoids divergence between UI and e2e chat suites.
 */
export function createSeedHistories(): Record<string, ConversationMessage[]> {
  return JSON.parse(JSON.stringify(seedMessages))
}
