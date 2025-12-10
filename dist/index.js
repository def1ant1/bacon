"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  CustomerSupportChatWidget: () => CustomerSupportChatWidget
});
module.exports = __toCommonJS(index_exports);

// src/CustomerSupportChatWidget.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var SESSION_STORAGE_KEY = "cs_chat_session_id_v1";
function createSessionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `session_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
function getOrCreateSessionId() {
  try {
    const existing = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;
    const newId = createSessionId();
    window.localStorage.setItem(SESSION_STORAGE_KEY, newId);
    return newId;
  } catch {
    return createSessionId();
  }
}
var CustomerSupportChatWidget = ({
  apiUrl,
  title = "Support",
  userIdentifier,
  primaryColor = "#2563eb",
  // Tailwind-ish blue-600
  defaultOpen = false,
  uploadUrl,
  pollIntervalMs = 3e3,
  welcomeMessage
}) => {
  const [isOpen, setIsOpen] = (0, import_react.useState)(defaultOpen);
  const [sessionId, setSessionId] = (0, import_react.useState)(null);
  const [messages, setMessages] = (0, import_react.useState)([]);
  const [inputText, setInputText] = (0, import_react.useState)("");
  const [isLoading, setIsLoading] = (0, import_react.useState)(false);
  const [error, setError] = (0, import_react.useState)(null);
  const messagesEndRef = (0, import_react.useRef)(null);
  const fileInputRef = (0, import_react.useRef)(null);
  (0, import_react.useEffect)(() => {
    const id = getOrCreateSessionId();
    setSessionId(id);
  }, []);
  (0, import_react.useEffect)(() => {
    if (!welcomeMessage) return;
    if (!sessionId) return;
    if (messages.length > 0) return;
    addMessage("bot", welcomeMessage);
  }, [welcomeMessage, sessionId, messages.length]);
  (0, import_react.useEffect)(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);
  (0, import_react.useEffect)(() => {
    if (!sessionId) return;
    if (!pollIntervalMs || pollIntervalMs <= 0) return;
    const messagesUrl = apiUrl.endsWith("/chat") ? apiUrl : apiUrl.replace(/\/$/, "") + "/chat";
    let timer = null;
    const load = async () => {
      try {
        const res = await fetch(
          `${messagesUrl}?sessionId=${encodeURIComponent(sessionId)}`
        );
        if (!res.ok) return;
        const list = await res.json();
        setMessages(Array.isArray(list) ? list : []);
      } catch {
      }
    };
    load();
    timer = setInterval(load, pollIntervalMs);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [sessionId, apiUrl, pollIntervalMs]);
  const addMessage = (sender, text) => {
    const newMessage = {
      id: `${sender}_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      sender,
      text,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    setMessages((prev) => [...prev, newMessage]);
  };
  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!inputText.trim() || !sessionId || isLoading) return;
    const trimmed = inputText.trim();
    addMessage("user", trimmed);
    setInputText("");
    setIsLoading(true);
    setError(null);
    try {
      const payload = {
        sessionId,
        message: trimmed,
        userIdentifier
      };
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(
          `Chat API responded with status ${response.status}: ${response.statusText}`
        );
      }
      const data = await response.json();
      addMessage("bot", data.reply || "I\u2019m sorry, I didn\u2019t receive a response.");
    } catch (err) {
      console.error("Chat send error:", err);
      setError(
        "I ran into a problem reaching our servers. Please try again in a moment."
      );
      addMessage(
        "bot",
        "I\u2019m having trouble reaching the support system right now. Please try again shortly or contact us via another channel."
      );
    } finally {
      setIsLoading(false);
    }
  };
  const handleFileSelected = async (file) => {
    var _a, _b;
    if (!file || !sessionId) return;
    setIsLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("sessionId", sessionId);
      if (userIdentifier) {
        for (const [k, v] of Object.entries(userIdentifier)) {
          form.append(`user_${k}`, String(v));
        }
      }
      form.append("file", file, file.name);
      let target = uploadUrl;
      if (!target) {
        target = apiUrl.endsWith("/chat") ? apiUrl.replace(/\/chat$/, "/upload") : apiUrl.replace(/\/$/, "") + "/upload";
      }
      const resp = await fetch(target, { method: "POST", body: form });
      if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
      let fileUrl;
      try {
        const data = await resp.json();
        fileUrl = (_b = (_a = data == null ? void 0 : data.files) == null ? void 0 : _a[0]) == null ? void 0 : _b.url;
      } catch {
      }
      const label = `Uploaded file: ${file.name}`;
      if (fileUrl) {
        const message = {
          id: `user_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          sender: "user",
          text: label,
          createdAt: (/* @__PURE__ */ new Date()).toISOString(),
          fileUrl,
          fileName: file.name
        };
        setMessages((prev) => [...prev, message]);
      } else {
        addMessage("user", label);
      }
    } catch (e) {
      console.error("upload error", e);
      setError("We couldn't upload your file. Please try again.");
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };
  const renderSubtitle = () => {
    if (!userIdentifier)
      return "Ask us anything about your account or our services.";
    if (userIdentifier.email) return `Signed in as ${userIdentifier.email}`;
    if (userIdentifier.phone) return `Signed in with ${userIdentifier.phone}`;
    return "Ask us anything about your account or our services.";
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "div",
    {
      className: "cs-chat-root",
      style: { ["--cs-primary"]: primaryColor },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            className: "cs-chat-launcher",
            onClick: () => setIsOpen((prev) => !prev),
            "aria-label": isOpen ? "Close support chat" : "Open support chat",
            children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "cs-chat-launcher-icon", "aria-hidden": "true", children: "\u{1F4AC}" })
          }
        ),
        isOpen && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "cs-chat-panel", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "cs-chat-header", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "cs-chat-header-main", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "cs-chat-title", children: title }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "cs-chat-subtitle", children: renderSubtitle() })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "button",
              {
                type: "button",
                className: "cs-chat-header-close",
                onClick: () => setIsOpen(false),
                "aria-label": "Close chat",
                children: "\u2715"
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "cs-chat-body", children: [
            error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "cs-chat-error", children: error }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "cs-chat-messages", children: [
              messages.map((msg) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "div",
                {
                  className: `cs-chat-message cs-chat-message--${msg.sender}`,
                  children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "cs-chat-message-bubble", children: msg.fileUrl ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { href: msg.fileUrl, target: "_blank", rel: "noreferrer", children: msg.text || msg.fileName }) : msg.text })
                },
                msg.id
              )),
              isLoading && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "cs-chat-message cs-chat-message--bot", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "cs-chat-message-bubble cs-chat-typing-indicator", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "cs-dot" }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "cs-dot" }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "cs-dot" })
              ] }) }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { ref: messagesEndRef })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", { className: "cs-chat-input-row", onSubmit: handleSubmit, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "input",
              {
                ref: fileInputRef,
                type: "file",
                className: "cs-chat-file-input",
                "aria-label": "Attach file",
                onChange: (e) => {
                  var _a;
                  return handleFileSelected(((_a = e.target.files) == null ? void 0 : _a[0]) || null);
                },
                style: { display: "none" }
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "button",
              {
                type: "button",
                className: "cs-chat-attach-button",
                onClick: () => {
                  var _a;
                  return (_a = fileInputRef.current) == null ? void 0 : _a.click();
                },
                disabled: isLoading || !sessionId,
                "aria-label": "Attach a file",
                title: "Attach a file",
                children: "\u{1F4CE}"
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "input",
              {
                type: "text",
                className: "cs-chat-input",
                placeholder: "Type your message...",
                value: inputText,
                onChange: (e) => setInputText(e.target.value),
                disabled: isLoading || !sessionId
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "button",
              {
                type: "submit",
                className: "cs-chat-send-button",
                disabled: isLoading || !sessionId || !inputText.trim(),
                children: "Send"
              }
            )
          ] })
        ] })
      ]
    }
  );
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CustomerSupportChatWidget
});
//# sourceMappingURL=index.js.map