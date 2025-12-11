import React, { useCallback, useMemo, useRef } from "react"
import { ConversationDataService, sortConversations } from "./ConversationDataService"
import { useConversationFeed } from "./useConversationFeed"
import { ConversationSummary } from "./types"
import "./ConversationSidebar.css"

export interface ConversationSidebarProps {
  service: ConversationDataService
  selectedConversationId?: string
  onSelectConversation?: (conversationId: string) => void
  title?: string
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  return date.toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  })
}

function renderPreview(preview?: string): string {
  if (!preview) return "No recent messages yet"
  return preview.length > 80 ? `${preview.slice(0, 77)}...` : preview
}

/**
 * ConversationSidebar presents an infinitely-scrollable list of conversations
 * with strong keyboard/a11y support and low-friction loading/error states. It
 * keeps the visual layer thin by deferring caching/retry/cancellation to the
 * ConversationDataService + useConversationFeed hook.
 */
export const ConversationSidebar: React.FC<ConversationSidebarProps> = ({
  service,
  onSelectConversation,
  selectedConversationId,
  title = "Inbox",
}) => {
  const listRef = useRef<HTMLUListElement | null>(null)
  const { conversations, loading, error, hasMore, loadMore, retry } = useConversationFeed(
    service
  )

  const sorted = useMemo(() => sortConversations(conversations), [conversations])

  const handleScroll = useCallback(() => {
    const node = listRef.current
    if (!node || !hasMore || loading) return

    const distanceToBottom = node.scrollHeight - node.scrollTop - node.clientHeight
    if (distanceToBottom < 96) {
      loadMore()
    }
  }, [hasMore, loadMore, loading])

  const moveFocus = useCallback((delta: number) => {
    if (!listRef.current) return
    const buttons = Array.from(
      listRef.current.querySelectorAll<HTMLButtonElement>("button[role='option']")
    )
    if (buttons.length === 0) return
    const activeElement = document.activeElement as HTMLButtonElement | null
    const currentIndex = Math.max(0, buttons.indexOf(activeElement ?? buttons[0]))
    const nextIndex = currentIndex + delta

    if (nextIndex >= 0 && nextIndex < buttons.length) {
      buttons[nextIndex].focus()
    }
  }, [])

  const handleListKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLUListElement>) => {
      if (event.key === "ArrowDown") {
        moveFocus(1)
        event.preventDefault()
      }
      if (event.key === "ArrowUp") {
        moveFocus(-1)
        event.preventDefault()
      }
    },
    [moveFocus]
  )

  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const list = listRef.current
      if (!list) return
      if (!list.contains(document.activeElement)) return
      if (event.key === "ArrowDown") {
        moveFocus(1)
        event.preventDefault()
      }
      if (event.key === "ArrowUp") {
        moveFocus(-1)
        event.preventDefault()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [moveFocus])

  const renderItem = (conversation: ConversationSummary, index: number) => {
    const isSelected = conversation.id === selectedConversationId
    return (
      <li key={conversation.id} className="cs-sidebar-row">
        <button
          type="button"
          role="option"
          aria-selected={isSelected}
          className={`cs-sidebar-item ${isSelected ? "cs-sidebar-item--active" : ""}`}
          onClick={() => onSelectConversation?.(conversation.id)}
          onKeyDownCapture={(event) => {
            if (event.key === "ArrowDown") {
              moveFocus(1)
              event.preventDefault()
            }
            if (event.key === "ArrowUp") {
              moveFocus(-1)
              event.preventDefault()
            }
          }}
        >
          <div className="cs-sidebar-item__header">
            <span className="cs-sidebar-item__title">{conversation.title}</span>
            <span className="cs-sidebar-item__timestamp" aria-label="Last updated">
              {formatTimestamp(conversation.lastMessageAt)}
            </span>
          </div>
          <div className="cs-sidebar-item__body">
            <span className="cs-sidebar-item__preview">{renderPreview(conversation.lastMessagePreview)}</span>
            {conversation.unread ? <span className="cs-sidebar-item__unread" aria-label="Unread" /> : null}
          </div>
          {conversation.participantLabel ? (
            <span className="cs-sidebar-item__participant">{conversation.participantLabel}</span>
          ) : null}
        </button>
      </li>
    )
  }

  return (
    <aside className="cs-sidebar" aria-label="Conversation list">
      <div className="cs-sidebar__header">
        <h2 className="cs-sidebar__title">{title}</h2>
        {loading ? <span className="cs-sidebar__spinner" aria-live="polite">Loading…</span> : null}
      </div>
      {error ? (
        <div className="cs-sidebar__error" role="alert">
          <p>We could not load conversations. Please retry.</p>
          <button type="button" onClick={retry} className="cs-sidebar__retry">
            Retry
          </button>
        </div>
      ) : null}
      <ul
        ref={listRef}
        className="cs-sidebar__list"
        role="listbox"
        aria-label="Conversations"
        tabIndex={0}
        onScroll={handleScroll}
        onKeyDown={handleListKeyDown}
        onFocus={(event) => {
          if (event.target === event.currentTarget) {
            moveFocus(0)
          }
        }}
      >
        {sorted.map((conversation, index) => renderItem(conversation, index))}
        {!loading && sorted.length === 0 && !error ? (
          <li className="cs-sidebar__empty">No conversations yet.</li>
        ) : null}
        {loading ? <li className="cs-sidebar__loading">Loading conversations…</li> : null}
      </ul>
      {hasMore && !loading ? (
        <button type="button" className="cs-sidebar__load-more" onClick={loadMore}>
          Load more
        </button>
      ) : null}
    </aside>
  )
}
