import React from 'react';

/**
 * Represents who sent a given chat message.
 */
type SenderType = "user" | "bot";
/**
 * A single chat message in the widget.
 */
interface ChatMessage {
    id: string;
    sender: SenderType;
    text: string;
    createdAt: string;
    fileUrl?: string;
    fileName?: string;
}
/**
 * Shape of the backend chat API request.
 * Adjust this to match your backend contract.
 */
interface ChatApiRequest {
    sessionId: string;
    message: string;
    /**
     * Optional identifier to help backend look up CRM records.
     * Example: { email: "user@example.com" }.
     */
    userIdentifier?: Record<string, string>;
}
/**
 * Shape of the backend chat API response.
 * Adjust this to match your backend contract.
 */
interface ChatApiResponse {
    reply: string;
}
/**
 * Props for the CustomerSupportChatWidget component.
 */
interface CustomerSupportChatWidgetProps {
    /**
     * Base URL for the chat backend.
     * Example: "/api/chat" or "https://api.yourdomain.com/chat".
     */
    apiUrl: string;
    uploadUrl?: string;
    /**
     * Optional brand or client name to show in header.
     * Example: "ClientCo Support".
     */
    title?: string;
    /**
     * Optional object with known user identifiers (e.g., logged-in user).
     * This will be sent to the backend so it can search/review the CRM.
     * Example: { email: "user@example.com", phone: "+15551234567" }.
     */
    userIdentifier?: Record<string, string>;
    /**
     * Primary accent color for the widget (CSS color value).
     * Used for header background and launcher button.
     */
    primaryColor?: string;
    /**
     * Optional flag to start with the chat panel open.
     */
    defaultOpen?: boolean;
    /**
     * Optional welcome/intro message that appears when a session is first created
     * and no other history exists. Useful for surfacing admin-configured greetings
     * so users always see the expected onboarding copy.
     */
    welcomeMessage?: string;
    /**
     * Optional polling interval (ms) to sync messages from the server.
     * Defaults to 3000ms. Set to 0 to disable.
     */
    pollIntervalMs?: number;
}
/**
 * Main customer support chat widget component.
 */
declare const CustomerSupportChatWidget: React.FC<CustomerSupportChatWidgetProps>;

export { type ChatApiRequest, type ChatApiResponse, type ChatMessage, CustomerSupportChatWidget, type CustomerSupportChatWidgetProps, type SenderType };
