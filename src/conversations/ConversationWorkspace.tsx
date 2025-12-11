import React from "react"
import { ConversationDataService } from "./ConversationDataService"
import { ConversationSidebar } from "./ConversationSidebar"
import { ConversationMessageService } from "./ConversationMessageService"
import { ConversationRouterProvider, useConversationRouter } from "./ConversationRouter"
import { ConversationWindow } from "./ConversationWindow"
import "./ConversationWindow.css"

export interface ConversationWorkspaceProps {
  conversationService: ConversationDataService
  messageService: ConversationMessageService
  initialConversationId?: string
  title?: string
  sidebarTitle?: string
}

function ConversationPanels({
  conversationService,
  sidebarTitle,
  title,
}: {
  conversationService: ConversationDataService
  sidebarTitle?: string
  title?: string
}) {
  const { activeConversationId, selectConversation } = useConversationRouter()
  return (
    <div className="cs-workspace" role="application" aria-label="Agent console">
      <ConversationSidebar
        service={conversationService}
        onSelectConversation={selectConversation}
        selectedConversationId={activeConversationId}
        title={sidebarTitle}
      />
      <ConversationWindow title={title} />
    </div>
  )
}

/**
 * Turn-key composition of the sidebar + conversation window + shared router.
 * A thin provider wraps everything so the sidebar drives the router, which in
 * turn hydrates the window with full message history. Inline docs cover the
 * data flow so future devs can extend transports (e.g., websockets) with
 * confidence.
 */
export const ConversationWorkspace: React.FC<ConversationWorkspaceProps> = ({
  conversationService,
  messageService,
  initialConversationId,
  title = "Conversation",
  sidebarTitle = "Inbox",
}) => {
  return (
    <ConversationRouterProvider service={messageService} initialConversationId={initialConversationId}>
      <ConversationPanels conversationService={conversationService} sidebarTitle={sidebarTitle} title={title} />
    </ConversationRouterProvider>
  )
}
