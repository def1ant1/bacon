import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ConversationMessage, ConversationMessageService } from "./ConversationMessageService"

interface HistoryState {
  messages: ConversationMessage[]
  loading: boolean
  error?: Error
  lastSeenId?: string
  sending?: boolean
  hasFetched?: boolean
}

const emptyState: HistoryState = { messages: [], loading: false }

interface ConversationRouterContextShape {
  activeConversationId?: string
  /** map of cached histories keyed by conversation id */
  histories: Record<string, HistoryState>
  /** selects a conversation and triggers hydration if stale */
  selectConversation: (conversationId: string) => void
  /** sends a new message to the active conversation */
  sendMessage: (text: string) => Promise<void>
  /** push-driven append (e.g., websocket) */
  receiveMessage: (message: ConversationMessage) => void
  /** refreshes history for the active or provided conversation */
  refresh: (conversationId?: string) => Promise<void>
  /** marks a message as seen to keep unread badges honest */
  markSeen: (conversationId: string, messageId?: string) => void
}

const ConversationRouterContext = React.createContext<ConversationRouterContextShape | undefined>(undefined)

export interface ConversationRouterProviderProps {
  service: ConversationMessageService
  initialConversationId?: string
  children: React.ReactNode
}

/**
 * Central store responsible for syncing the sidebar selection with the active
 * chat thread. It intentionally caches per-conversation history so reselecting
 * does not thrash the network or the DOM. All state transitions are annotated
 * to document the data flow and error handling patterns expected in the agent
 * console surfaces.
 */
export const ConversationRouterProvider: React.FC<ConversationRouterProviderProps> = ({
  service,
  initialConversationId,
  children,
}) => {
  const [activeConversationId, setActiveConversationId] = useState<string | undefined>(initialConversationId)
  const [histories, setHistories] = useState<Record<string, HistoryState>>({})
  const requestTokens = useRef(new Map<string, number>())
  const seenTimers = useRef(new Map<string, number>())

  const setHistory = useCallback((conversationId: string, updater: (prev: HistoryState) => HistoryState) => {
    setHistories((prev) => ({
      ...prev,
      [conversationId]: updater(prev[conversationId] ?? emptyState),
    }))
  }, [])

  const loadHistory = useCallback(
    async (conversationId: string) => {
      const token = (requestTokens.current.get(conversationId) ?? 0) + 1
      requestTokens.current.set(conversationId, token)
      setHistory(conversationId, (prev) => ({ ...prev, loading: true, error: undefined }))
      try {
        const messages = await service.loadHistory(conversationId)
        if (requestTokens.current.get(conversationId) !== token) return
        setHistory(conversationId, () => ({
          messages,
          loading: false,
          error: undefined,
          hasFetched: true,
          lastSeenId: messages[messages.length - 1]?.id,
        }))
      } catch (err) {
        if (requestTokens.current.get(conversationId) !== token) return
        setHistory(conversationId, (prev) => ({ ...prev, loading: false, error: err as Error }))
      }
    },
    [service, setHistory]
  )

  const refresh = useCallback(
    async (conversationId?: string) => {
      const id = conversationId ?? activeConversationId
      if (!id) return
      await loadHistory(id)
    },
    [activeConversationId, loadHistory]
  )

  const selectConversation = useCallback(
    (conversationId: string) => {
      setActiveConversationId(conversationId)
      const current = histories[conversationId]
      if (!current || current.error || !current.hasFetched) {
        // Kick off hydration in the background; UI will show loading state.
        loadHistory(conversationId)
      }
    },
    [histories, loadHistory]
  )

  const sendMessage = useCallback(
    async (text: string) => {
      if (!activeConversationId) {
        throw new Error("no_active_conversation_selected")
      }
      setHistory(activeConversationId, (prev) => ({ ...prev, sending: true, error: undefined }))
      try {
        const message = await service.sendMessage(activeConversationId, text)
        setHistory(activeConversationId, (prev) => ({
          ...prev,
          sending: false,
          messages: [...(prev.messages || []), message],
          hasFetched: true,
          lastSeenId: message.id,
        }))
      } catch (err) {
        setHistory(activeConversationId, (prev) => ({ ...prev, sending: false, error: err as Error }))
      }
    },
    [activeConversationId, service, setHistory]
  )

  const receiveMessage = useCallback(
    (message: ConversationMessage) => {
      setHistory(message.conversationId, (prev) => {
        const exists = prev.messages?.some((m) => m.id === message.id)
        const messages = exists ? prev.messages : [...(prev.messages || []), message]
        return {
          ...prev,
          messages,
          hasFetched: true,
        }
      })
    },
    [setHistory]
  )

  const markSeen = useCallback(
    (conversationId: string, messageId?: string) => {
      if (!conversationId) return
      window.clearTimeout(seenTimers.current.get(conversationId))
      // Debounce seen state updates to avoid flapping when users scroll quickly.
      const timer = window.setTimeout(() => {
        setHistory(conversationId, (prev) => ({ ...prev, lastSeenId: messageId ?? prev.lastSeenId }))
      }, 150)
      seenTimers.current.set(conversationId, timer)
    },
    [setHistory]
  )

  const value = useMemo<ConversationRouterContextShape>(
    () => ({
      activeConversationId,
      histories,
      selectConversation,
      sendMessage,
      receiveMessage,
      refresh,
      markSeen,
    }),
    [activeConversationId, histories, markSeen, receiveMessage, refresh, selectConversation, sendMessage]
  )

  useEffect(() => {
    if (initialConversationId) {
      selectConversation(initialConversationId)
    }
  }, [initialConversationId, selectConversation])

  useEffect(() => {
    return () => {
      seenTimers.current.forEach((timer) => window.clearTimeout(timer))
    }
  }, [])

  return <ConversationRouterContext.Provider value={value}>{children}</ConversationRouterContext.Provider>
}

export function useConversationRouter(): ConversationRouterContextShape {
  const ctx = React.useContext(ConversationRouterContext)
  if (!ctx) {
    throw new Error("useConversationRouter must be used within ConversationRouterProvider")
  }
  return ctx
}
