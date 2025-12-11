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
  AbortSendError: () => AbortSendError,
  ConversationDataService: () => ConversationDataService,
  ConversationSidebar: () => ConversationSidebar,
  CustomerSupportChatWidget: () => CustomerSupportChatWidget,
  PluginProvider: () => PluginProvider,
  PluginRunner: () => PluginRunner,
  PollingTransport: () => PollingTransport,
  WebSocketTransport: () => WebSocketTransport,
  cloneSafe: () => cloneSafe,
  computeBackoff: () => computeBackoff,
  createAuthTokenRefresherPlugin: () => createAuthTokenRefresherPlugin,
  createLoggingPlugin: () => createLoggingPlugin,
  createTracingPlugin: () => createTracingPlugin,
  sortConversations: () => sortConversations,
  useConversationFeed: () => useConversationFeed,
  usePluginRunner: () => usePluginRunner
});
module.exports = __toCommonJS(index_exports);

// src/CustomerSupportChatWidget.tsx
var import_react2 = require("react");

// src/transports/Transport.ts
function computeBackoff(attempt, baseMs, maxMs) {
  const capped = Math.min(maxMs, baseMs * Math.pow(2, attempt));
  const jitter = Math.random() * 0.25 * capped;
  return Math.round(capped * 0.75 + jitter);
}

// src/transports/PollingTransport.ts
var PollingTransport = class {
  constructor(options) {
    this.options = options;
    this.name = "polling";
    this.state = "idle";
    this.handlers = {};
    this.timer = null;
    this.stopped = false;
    this.attempt = 0;
  }
  setEventHandlers(handlers) {
    this.handlers = handlers;
  }
  async connect() {
    var _a, _b;
    if (this.state === "open" || this.state === "connecting") return;
    this.stopped = false;
    this.state = "connecting";
    (_b = (_a = this.handlers).onTelemetry) == null ? void 0 : _b.call(_a, {
      name: "polling_connect",
      at: Date.now(),
      detail: { apiUrl: this.options.apiUrl }
    });
    this.schedulePoll(0);
  }
  async disconnect(reason) {
    var _a, _b;
    this.stopped = true;
    this.state = "closed";
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    (_b = (_a = this.handlers).onClose) == null ? void 0 : _b.call(_a, reason);
  }
  async send(payload) {
    var _a, _b, _c, _d;
    const headers = {
      "Content-Type": "application/json",
      ...this.options.headers
    };
    if (this.options.authToken) {
      headers["Authorization"] = `Bearer ${this.options.authToken}`;
    }
    const response = await fetch(this.options.apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const error = new Error(
        `Chat API responded with status ${response.status}: ${response.statusText}`
      );
      (_b = (_a = this.handlers).onError) == null ? void 0 : _b.call(_a, error);
      throw error;
    }
    const data = await response.json();
    (_d = (_c = this.handlers).onTelemetry) == null ? void 0 : _d.call(_c, { name: "polling_send", at: Date.now() });
    return data;
  }
  async sendFile(file, metadata) {
    var _a, _b, _c, _d, _e, _f;
    const form = new FormData();
    form.append("sessionId", this.options.sessionId);
    if (metadata) {
      for (const [k, v] of Object.entries(metadata)) {
        form.append(k, v);
      }
    }
    form.append("file", file, file.name);
    const uploadUrl = this.options.uploadUrl || this.options.apiUrl.replace(/\/chat$/, "/upload");
    const response = await fetch(uploadUrl, { method: "POST", body: form });
    if (!response.ok) {
      const error = new Error(`Upload failed: ${response.status}`);
      (_b = (_a = this.handlers).onError) == null ? void 0 : _b.call(_a, error);
      throw error;
    }
    try {
      const parsed = await response.json();
      const url = (_d = (_c = parsed == null ? void 0 : parsed.files) == null ? void 0 : _c[0]) == null ? void 0 : _d.url;
      if (url) {
        return {
          id: `user_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          sender: "user",
          text: `Uploaded file: ${file.name}`,
          createdAt: (/* @__PURE__ */ new Date()).toISOString(),
          fileUrl: url,
          fileName: file.name
        };
      }
    } catch (e) {
      (_f = (_e = this.handlers).onTelemetry) == null ? void 0 : _f.call(_e, {
        name: "polling_upload_parse_failure",
        at: Date.now(),
        detail: { error: e.message }
      });
    }
    return void 0;
  }
  schedulePoll(delay) {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.poll();
    }, delay);
  }
  async poll() {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n;
    if (this.stopped) return;
    const interval = (_a = this.options.pollIntervalMs) != null ? _a : 3e3;
    const abort = new AbortController();
    const timeout = (_b = this.options.longPollTimeoutMs) != null ? _b : interval;
    const timer = setTimeout(() => abort.abort(), timeout);
    const messagesUrl = this.options.apiUrl.endsWith("/chat") ? this.options.apiUrl : this.options.apiUrl.replace(/\/$/, "") + "/chat";
    try {
      const res = await fetch(
        `${messagesUrl}?sessionId=${encodeURIComponent(this.options.sessionId)}`,
        {
          signal: abort.signal,
          headers: this.buildHeaders()
        }
      );
      clearTimeout(timer);
      if (!res.ok) throw new Error(`Polling failed: ${res.status}`);
      const list = await res.json();
      this.state = "open";
      this.attempt = 0;
      (_d = (_c = this.handlers).onOpen) == null ? void 0 : _d.call(_c);
      (_f = (_e = this.handlers).onMessage) == null ? void 0 : _f.call(_e, Array.isArray(list) ? list : []);
      (_h = (_g = this.handlers).onTelemetry) == null ? void 0 : _h.call(_g, { name: "polling_tick", at: Date.now() });
      this.schedulePoll(interval);
    } catch (err) {
      clearTimeout(timer);
      this.state = "error";
      const detail = err instanceof Error ? err.message : String(err);
      (_j = (_i = this.handlers).onError) == null ? void 0 : _j.call(_i, err);
      (_l = (_k = this.handlers).onTelemetry) == null ? void 0 : _l.call(_k, {
        name: "polling_retry_scheduled",
        at: Date.now(),
        detail: { attempt: this.attempt + 1, error: detail }
      });
      const delay = computeBackoff(
        this.attempt++,
        (_m = this.options.backoffBaseMs) != null ? _m : 1e3,
        (_n = this.options.backoffMaxMs) != null ? _n : 3e4
      );
      this.schedulePoll(delay);
    }
  }
  buildHeaders() {
    const headers = { ...this.options.headers || {} };
    if (this.options.authToken) {
      headers["Authorization"] = `Bearer ${this.options.authToken}`;
    }
    return headers;
  }
};

// src/transports/WebSocketTransport.ts
var WebSocketTransport = class {
  constructor(options) {
    this.options = options;
    this.name = "websocket";
    this.state = "idle";
    this.handlers = {};
    this.socket = null;
    this.reconnectAttempt = 0;
    this.heartbeatTimer = null;
    this.closedByUser = false;
    this.messageQueue = [];
  }
  setEventHandlers(handlers) {
    this.handlers = handlers;
  }
  async connect() {
    var _a, _b;
    if (this.state === "open" || this.state === "connecting") return;
    this.closedByUser = false;
    this.state = "connecting";
    const url = this.computeUrl();
    const wsImpl = this.resolveImpl();
    if (!wsImpl) {
      throw new Error("WebSocket is not available in this environment");
    }
    (_b = (_a = this.handlers).onTelemetry) == null ? void 0 : _b.call(_a, { name: "ws_connect", at: Date.now(), detail: { url } });
    this.socket = new wsImpl(url);
    this.bindNativeSocket(this.socket);
  }
  async disconnect(reason) {
    var _a, _b;
    this.closedByUser = true;
    this.state = "closed";
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (!this.socket) return;
    if ("close" in this.socket) {
      this.socket.close();
    }
    if ("disconnect" in this.socket) {
      this.socket.disconnect();
    }
    (_b = (_a = this.handlers).onClose) == null ? void 0 : _b.call(_a, reason);
  }
  async send(payload) {
    const envelope = JSON.stringify({
      type: "message",
      sessionId: this.options.sessionId,
      userIdentifier: this.options.userIdentifier,
      payload
    });
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(envelope);
      return;
    }
    if (this.socket && "emit" in this.socket) {
      this.socket.emit("message", envelope);
      return;
    }
    this.messageQueue.push(envelope);
  }
  async sendFile(file, metadata) {
    const envelope = {
      type: "file",
      sessionId: this.options.sessionId,
      metadata,
      name: file.name,
      size: file.size
    };
    const payload = JSON.stringify(envelope);
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(payload);
      this.socket.send(file);
    } else if (this.socket && "emit" in this.socket) {
      this.socket.emit("file", { ...envelope, file });
    } else {
      this.messageQueue.push(payload);
    }
    return void 0;
  }
  computeUrl() {
    if (this.options.webSocketUrl) return this.options.webSocketUrl;
    const parsed = new URL(this.options.apiUrl, typeof window !== "undefined" ? window.location.href : void 0);
    parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
    parsed.pathname = parsed.pathname.replace(/\/$/, "") + "/ws";
    return parsed.toString();
  }
  resolveImpl() {
    if (this.options.socketIoFactory) {
      const factory = this.options.socketIoFactory;
      const shim = class {
        constructor(url) {
          this.client = factory("");
          this.readyState = WebSocket.CONNECTING;
          this.client = factory(url, { transports: ["websocket"], withCredentials: true });
        }
        close() {
          this.client.disconnect();
        }
        send(payload) {
          this.client.emit("message", payload);
        }
        addEventListener(event, cb) {
          this.client.on(event, cb);
        }
        removeEventListener(event, cb) {
          this.client.off(event, cb);
        }
        // The widget never relies on other members.
      };
      return shim;
    }
    if (this.options.webSocketImpl) return this.options.webSocketImpl;
    if (typeof WebSocket !== "undefined") return WebSocket;
    return null;
  }
  bindNativeSocket(socket) {
    socket.addEventListener("open", () => {
      var _a, _b;
      this.state = "open";
      this.reconnectAttempt = 0;
      (_b = (_a = this.handlers).onOpen) == null ? void 0 : _b.call(_a);
      this.flushQueue();
      this.startHeartbeat(socket);
    });
    socket.addEventListener("message", (event) => {
      var _a, _b, _c, _d, _e, _f, _g, _h;
      try {
        const parsed = JSON.parse(event.data);
        if (Array.isArray(parsed)) {
          (_b = (_a = this.handlers).onMessage) == null ? void 0 : _b.call(_a, parsed);
        } else if (parsed == null ? void 0 : parsed.reply) {
          (_d = (_c = this.handlers).onMessage) == null ? void 0 : _d.call(_c, [
            {
              id: `bot_${Date.now()}`,
              sender: "bot",
              text: parsed.reply,
              createdAt: (/* @__PURE__ */ new Date()).toISOString()
            }
          ]);
        } else {
          (_f = (_e = this.handlers).onMessage) == null ? void 0 : _f.call(_e, parsed);
        }
      } catch (err) {
        (_h = (_g = this.handlers).onError) == null ? void 0 : _h.call(_g, err);
      }
    });
    socket.addEventListener("close", () => {
      var _a, _b;
      this.state = "closed";
      (_b = (_a = this.handlers).onClose) == null ? void 0 : _b.call(_a);
      this.stopHeartbeat();
      if (!this.closedByUser) {
        this.scheduleReconnect();
      }
    });
    socket.addEventListener("error", (event) => {
      var _a, _b;
      this.state = "error";
      (_b = (_a = this.handlers).onError) == null ? void 0 : _b.call(
        _a,
        event instanceof ErrorEvent ? new Error(event.message) : new Error("WebSocket error")
      );
      this.scheduleReconnect();
    });
  }
  startHeartbeat(socket) {
    var _a;
    const interval = (_a = this.options.heartbeatMs) != null ? _a : 3e4;
    if (interval <= 0) return;
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "ping", ts: Date.now() }));
      }
    }, interval);
  }
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
  scheduleReconnect() {
    var _a, _b, _c, _d;
    if (this.closedByUser) return;
    const delay = computeBackoff(
      this.reconnectAttempt++,
      (_a = this.options.backoffBaseMs) != null ? _a : 500,
      (_b = this.options.backoffMaxMs) != null ? _b : 15e3
    );
    (_d = (_c = this.handlers).onTelemetry) == null ? void 0 : _d.call(_c, {
      name: "ws_reconnect_scheduled",
      at: Date.now(),
      detail: { attempt: this.reconnectAttempt, delay }
    });
    setTimeout(() => {
      if (!this.closedByUser) {
        void this.connect();
      }
    }, delay);
  }
  flushQueue() {
    if (!this.socket) return;
    const ws = this.socket;
    while (this.messageQueue.length && ws.readyState === WebSocket.OPEN) {
      const next = this.messageQueue.shift();
      if (next) ws.send(next);
    }
  }
};

// src/plugins/BaconPlugin.ts
function cloneSafe(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
var MAX_RETRIES = 2;
var AbortSendError = class extends Error {
  constructor() {
    super("send_aborted_by_plugin");
  }
};
var PluginRunner = class {
  constructor(plugins, ctx) {
    this.plugins = plugins;
    this.ctx = ctx;
  }
  updateContext(partial) {
    this.ctx = { ...this.ctx, ...partial };
  }
  async init() {
    await this.run("onInit");
  }
  async notifyMount() {
    await this.run("onWidgetMount");
  }
  async notifyUnmount() {
    await this.run("onWidgetUnmount");
  }
  async notifyOpen(isOpen) {
    await this.run(isOpen ? "onWidgetOpen" : "onWidgetClose");
  }
  async notifyConnection(meta) {
    await this.run("onConnectionEvent", meta);
  }
  async notifyTelemetry(event) {
    await this.run("onTelemetry", cloneSafe(event));
  }
  async processMessages(incoming) {
    let current = cloneSafe(incoming);
    for (const plugin of this.plugins) {
      if (!plugin.onMessages) continue;
      try {
        const next = await plugin.onMessages(cloneSafe(current), this.ctx);
        if (next == null ? void 0 : next.messages) current = cloneSafe(next.messages);
      } catch (err) {
        console.warn(`[plugin:${plugin.name}] onMessages failed`, err);
      }
    }
    return current;
  }
  /**
   * Executes the send pipeline with plugin hooks and retry semantics. The
   * caller provides the actual network send implementation so this runner stays
   * transport-agnostic.
   */
  async send(payload, dispatcher) {
    let currentPayload = cloneSafe(payload);
    let retries = 0;
    const applyBeforeSend = async () => {
      let working = currentPayload;
      for (const plugin of this.plugins) {
        if (!plugin.onBeforeSend) continue;
        try {
          const result = await plugin.onBeforeSend(cloneSafe(working), this.ctx);
          if (result == null ? void 0 : result.abort) throw new AbortSendError();
          if (result == null ? void 0 : result.payload) working = cloneSafe(result.payload);
          if ((result == null ? void 0 : result.response) !== void 0) return { shortCircuit: result.response };
        } catch (err) {
          if (err instanceof AbortSendError) throw err;
          console.warn(`[plugin:${plugin.name}] onBeforeSend failed`, err);
        }
      }
      currentPayload = working;
      return { shortCircuit: void 0 };
    };
    while (retries <= MAX_RETRIES) {
      let before;
      try {
        before = await applyBeforeSend();
      } catch (err) {
        if (err instanceof AbortSendError) {
          await this.run("onAfterSend", currentPayload, void 0);
          return;
        }
        throw err;
      }
      if (before.shortCircuit !== void 0) {
        await this.run("onAfterSend", currentPayload, before.shortCircuit);
        return before.shortCircuit;
      }
      try {
        const response = await dispatcher(currentPayload);
        await this.run("onAfterSend", currentPayload, response);
        return response;
      } catch (err) {
        if (err instanceof AbortSendError) throw err;
        const retryDirective = await this.handleSendError(err, currentPayload);
        if (retryDirective.retry && retries < MAX_RETRIES) {
          retries += 1;
          if (retryDirective.payload) currentPayload = cloneSafe(retryDirective.payload);
          if (retryDirective.waitMs && retryDirective.waitMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, retryDirective.waitMs));
          }
          continue;
        }
        throw err;
      }
    }
    throw new Error("Max retries exceeded");
  }
  async handleSendError(error, payload) {
    let directive = {};
    for (const plugin of this.plugins) {
      if (!plugin.onSendError) continue;
      try {
        const next = await plugin.onSendError(error, cloneSafe(payload), this.ctx);
        if (next == null ? void 0 : next.retry) directive = { ...directive, ...next };
      } catch (err) {
        console.warn(`[plugin:${plugin.name}] onSendError failed`, err);
      }
    }
    return directive;
  }
  async run(hook, ...args) {
    for (const plugin of this.plugins) {
      const fn = plugin[hook];
      if (!fn) continue;
      try {
        await fn.apply(plugin, [...args, this.ctx]);
      } catch (err) {
        console.warn(`[plugin:${plugin.name}] ${String(hook)} failed`, err);
      }
    }
  }
};

// src/plugins/PluginProvider.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var PluginRunnerContext = (0, import_react.createContext)(null);
var PluginProvider = ({
  plugins = [],
  context,
  runner: runnerProp,
  children
}) => {
  const computed = (0, import_react.useMemo)(
    () => runnerProp != null ? runnerProp : new PluginRunner(plugins, context),
    [runnerProp, plugins, context]
  );
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PluginRunnerContext.Provider, { value: computed, children });
};
function usePluginRunner() {
  return (0, import_react.useContext)(PluginRunnerContext);
}

// src/messages/registry.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var MessageComponentRegistry = class {
  constructor() {
    this.renderers = /* @__PURE__ */ new Map();
  }
  register(type, renderer) {
    this.renderers.set(type, renderer);
  }
  render(message, helpers = {}) {
    const renderer = message.type ? this.renderers.get(message.type) : void 0;
    if (renderer) return renderer(message, helpers);
    return this.renderFallback(message);
  }
  renderFallback(message) {
    if (message.fileUrl) {
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("a", { href: message.fileUrl, target: "_blank", rel: "noreferrer", children: message.text || message.fileName });
    }
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: message.text });
  }
};
var QuickReplies = (message, helpers) => {
  var _a;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "cs-quick-replies", role: "group", "aria-label": "Suggested replies", children: [
    message.text && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "cs-chat-message-text", children: message.text }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "cs-quick-replies-list", children: (((_a = message.payload) == null ? void 0 : _a.actions) || []).map((action) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      "button",
      {
        className: "cs-quick-reply",
        type: "button",
        onClick: () => {
          var _a2;
          return (_a2 = helpers.onQuickReply) == null ? void 0 : _a2.call(helpers, action.value);
        },
        children: action.label
      },
      `${message.id}_${action.value}`
    )) })
  ] });
};
var CardRenderer = (message) => {
  const payload = message.payload || {};
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("article", { className: "cs-card", "aria-label": payload.title || message.text, children: [
    payload.imageUrl && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "cs-card-media", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("img", { src: payload.imageUrl, alt: payload.title || "Card image" }) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "cs-card-content", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h4", { children: payload.title || message.text }),
      payload.body && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: payload.body }),
      payload.actions && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "cs-card-actions", children: payload.actions.map((action) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("a", { href: action.url || "#", className: "cs-card-link", children: action.label }, action.value)) })
    ] })
  ] });
};
var ProductRenderer = (message) => {
  const payload = message.payload || {};
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("article", { className: "cs-card", "aria-label": payload.title || "Product", children: [
    payload.imageUrl && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "cs-card-media", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("img", { src: payload.imageUrl, alt: payload.title || "Product image" }) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "cs-card-content", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h4", { children: payload.title || message.text }),
      payload.body && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: payload.body }),
      payload.actions && payload.actions.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "cs-card-actions", children: payload.actions.map((action) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("a", { href: action.url || "#", className: "cs-card-link", children: action.label }, action.value)) })
    ] })
  ] });
};
var SurveyRenderer = (message, helpers) => {
  const payload = message.payload || {};
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "cs-survey", role: "form", "aria-label": payload.title || "Survey", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "cs-survey-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: payload.title || message.text }),
      payload.body && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: payload.body })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "cs-survey-actions", role: "group", "aria-label": "Survey responses", children: (payload.actions || []).map((action) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      "button",
      {
        type: "button",
        className: "cs-quick-reply",
        onClick: () => {
          var _a;
          return (_a = helpers.onQuickReply) == null ? void 0 : _a.call(helpers, action.value);
        },
        children: action.label
      },
      action.value
    )) })
  ] });
};
var defaultMessageRegistry = new MessageComponentRegistry();
defaultMessageRegistry.register("quick_replies", QuickReplies);
defaultMessageRegistry.register("card", CardRenderer);
defaultMessageRegistry.register("product", ProductRenderer);
defaultMessageRegistry.register("survey", SurveyRenderer);
defaultMessageRegistry.register("text", (msg) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: msg.text }));

// src/CustomerSupportChatWidget.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
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
  welcomeMessage,
  transport = "polling",
  transportOptions,
  plugins = [],
  messageRegistry
}) => {
  const [isOpen, setIsOpen] = (0, import_react2.useState)(defaultOpen);
  const [sessionId, setSessionId] = (0, import_react2.useState)(null);
  const [messages, setMessages] = (0, import_react2.useState)([]);
  const [inputText, setInputText] = (0, import_react2.useState)("");
  const [isLoading, setIsLoading] = (0, import_react2.useState)(false);
  const [error, setError] = (0, import_react2.useState)(null);
  const [transportInstance, setTransportInstance] = (0, import_react2.useState)(null);
  const [connectionState, setConnectionState] = (0, import_react2.useState)("idle");
  const transportOverrides = (0, import_react2.useMemo)(
    () => transportOptions || {},
    [transportOptions]
  );
  const registry = (0, import_react2.useMemo)(
    () => messageRegistry || defaultMessageRegistry,
    [messageRegistry]
  );
  const messagesEndRef = (0, import_react2.useRef)(null);
  const fileInputRef = (0, import_react2.useRef)(null);
  const pluginRunner = (0, import_react2.useMemo)(
    () => new PluginRunner(plugins, {
      apiUrl,
      sessionId: sessionId != null ? sessionId : null,
      transportKind: typeof transport === "string" ? transport : "custom",
      userIdentifier,
      isOpen
    }),
    [plugins]
  );
  const pluginContext = (0, import_react2.useMemo)(
    () => ({
      apiUrl,
      sessionId,
      transportKind: typeof transport === "string" ? transport : "custom",
      userIdentifier,
      isOpen
    }),
    [apiUrl, sessionId, transport, userIdentifier, isOpen]
  );
  (0, import_react2.useEffect)(() => {
    pluginRunner.updateContext({
      apiUrl,
      sessionId,
      transportKind: typeof transport === "string" ? transport : "custom",
      userIdentifier,
      isOpen
    });
  }, [pluginRunner, apiUrl, sessionId, transport, userIdentifier, isOpen]);
  (0, import_react2.useEffect)(() => {
    void pluginRunner.init();
    void pluginRunner.notifyMount();
    return () => {
      void pluginRunner.notifyUnmount();
    };
  }, [pluginRunner]);
  (0, import_react2.useEffect)(() => {
    void pluginRunner.notifyOpen(isOpen);
  }, [pluginRunner, isOpen]);
  (0, import_react2.useEffect)(() => {
    const id = getOrCreateSessionId();
    setSessionId(id);
  }, []);
  (0, import_react2.useEffect)(() => {
    if (!welcomeMessage) return;
    if (!sessionId) return;
    if (messages.length > 0) return;
    addMessage("bot", welcomeMessage);
  }, [welcomeMessage, sessionId, messages.length]);
  (0, import_react2.useEffect)(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);
  (0, import_react2.useEffect)(() => {
    if (!sessionId) return;
    const baseOptions = {
      apiUrl,
      sessionId,
      userIdentifier,
      uploadUrl,
      authToken: transportOverrides == null ? void 0 : transportOverrides.authToken,
      headers: transportOverrides == null ? void 0 : transportOverrides.headers,
      log: transportOverrides == null ? void 0 : transportOverrides.log
    };
    const buildTransport = () => {
      var _a;
      if (typeof transport === "function") {
        return transport(baseOptions);
      }
      if (transport === "websocket") {
        try {
          return new WebSocketTransport({
            ...baseOptions,
            ...transportOverrides
          });
        } catch (err) {
          console.warn("WebSocket unavailable, falling back to polling", err);
        }
      }
      return new PollingTransport({
        ...baseOptions,
        ...transportOverrides,
        pollIntervalMs: (_a = transportOverrides == null ? void 0 : transportOverrides.pollIntervalMs) != null ? _a : pollIntervalMs
      });
    };
    const instance = buildTransport();
    instance.setEventHandlers({
      onOpen: () => {
        setConnectionState("open");
        void pluginRunner.notifyConnection({ state: "open" });
      },
      onClose: (reason) => {
        setConnectionState("closed");
        void pluginRunner.notifyConnection({ state: "closed", reason });
        if (reason) setError(`Connection closed: ${reason}`);
      },
      onError: (err) => {
        setConnectionState("error");
        void pluginRunner.notifyConnection({ state: "error", reason: err.message });
        setError(err.message);
      },
      onMessage: async (incoming) => {
        const list = Array.isArray(incoming) ? incoming : [incoming];
        const processed = await pluginRunner.processMessages(list);
        setMessages((prev) => {
          if (Array.isArray(incoming)) return processed;
          return [...prev, ...processed];
        });
      },
      onTelemetry: (event) => {
        var _a;
        (_a = transportOverrides == null ? void 0 : transportOverrides.log) == null ? void 0 : _a.call(transportOverrides, "transport_event", event);
        void pluginRunner.notifyTelemetry(event);
      }
    });
    void instance.connect();
    void pluginRunner.notifyConnection({ state: "connecting" });
    setTransportInstance(instance);
    return () => {
      void instance.disconnect("component_unmounted");
    };
  }, [sessionId, apiUrl, userIdentifier, uploadUrl, pollIntervalMs, transport, transportOverrides]);
  const addMessage = (sender, text, extra) => {
    const newMessage = {
      id: `${sender}_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      sender,
      text,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      ...extra
    };
    setMessages((prev) => [...prev, newMessage]);
  };
  const sendText = async (raw) => {
    if (!raw.trim() || !sessionId || isLoading) return;
    const trimmed = raw.trim();
    addMessage("user", trimmed, { type: "text" });
    setInputText("");
    setIsLoading(true);
    setError(null);
    try {
      const payload = {
        sessionId,
        message: trimmed,
        userIdentifier
      };
      const data = await pluginRunner.send(payload, dispatchPayload);
      if (data == null ? void 0 : data.reply) {
        addMessage("bot", data.reply || "I\u2019m sorry, I didn\u2019t receive a response.", { type: "text" });
      }
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
  const dispatchPayload = async (payload) => {
    if (transportInstance) {
      return transportInstance.send(payload);
    }
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error(`Chat API responded with status ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  };
  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!inputText.trim() || !sessionId || isLoading) return;
    const pending = inputText;
    await sendText(pending);
  };
  const handleFileSelected = async (file) => {
    var _a, _b;
    if (!file || !sessionId) return;
    setIsLoading(true);
    setError(null);
    try {
      if (transportInstance == null ? void 0 : transportInstance.sendFile) {
        const response = await transportInstance.sendFile(file, {
          ...userIdentifier || {}
        });
        if (response) {
          setMessages((prev) => [...prev, response]);
          return;
        }
      }
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
  const handleQuickReply = async (value) => {
    await sendText(value);
  };
  const renderSubtitle = () => {
    if (!userIdentifier)
      return "Ask us anything about your account or our services.";
    if (userIdentifier.email) return `Signed in as ${userIdentifier.email}`;
    if (userIdentifier.phone) return `Signed in with ${userIdentifier.phone}`;
    return "Ask us anything about your account or our services.";
  };
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(PluginProvider, { plugins, context: pluginContext, runner: pluginRunner, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
    "div",
    {
      className: "cs-chat-root",
      style: { ["--cs-primary"]: primaryColor },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "button",
          {
            type: "button",
            className: "cs-chat-launcher",
            onClick: () => setIsOpen((prev) => !prev),
            "aria-label": isOpen ? "Close support chat" : "Open support chat",
            children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "cs-chat-launcher-icon", "aria-hidden": "true", children: "\u{1F4AC}" })
          }
        ),
        isOpen && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "cs-chat-panel", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "cs-chat-header", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "cs-chat-header-main", children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "cs-chat-title", children: title }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "cs-chat-subtitle", children: renderSubtitle() })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "cs-chat-body", children: [
            error && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "cs-chat-error", children: error }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "cs-chat-messages", children: [
              messages.map((msg) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "div",
                {
                  className: `cs-chat-message cs-chat-message--${msg.sender}`,
                  children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "cs-chat-message-bubble", children: registry.render(msg, { onQuickReply: handleQuickReply }) })
                },
                msg.id
              )),
              isLoading && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "cs-chat-message cs-chat-message--bot", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "cs-chat-message-bubble cs-chat-typing-indicator", children: [
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "cs-dot" }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "cs-dot" }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "cs-dot" })
              ] }) }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { ref: messagesEndRef })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("form", { className: "cs-chat-input-row", onSubmit: handleSubmit, children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
  ) });
};

// src/plugins/examples.ts
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function createLoggingPlugin(options = {}) {
  var _a;
  const logger = (_a = options.log) != null ? _a : ((event, detail) => console.info(`[bacon:${event}]`, detail));
  return {
    name: "logging",
    onInit: (ctx) => logger("init", { ctx }),
    onWidgetOpen: () => logger("ui_open"),
    onWidgetClose: () => logger("ui_close"),
    onConnectionEvent: (meta) => logger("connection", meta),
    onBeforeSend: (payload) => {
      logger("before_send", { payload });
    },
    onAfterSend: (_payload, response) => logger("after_send", { response }),
    onMessages: (messages) => {
      logger("messages", { count: messages.length });
    },
    onTelemetry: (event) => logger("transport_telemetry", event),
    onSendError: (error) => {
      logger("send_error", { error: error instanceof Error ? error.message : String(error) });
    }
  };
}
function createTracingPlugin(options = {}) {
  var _a;
  const makeTraceId = (_a = options.traceIdFactory) != null ? _a : (() => {
    var _a2, _b;
    return (_b = (_a2 = crypto.randomUUID) == null ? void 0 : _a2.call(crypto)) != null ? _b : `trace_${Date.now()}`;
  });
  return {
    name: "tracing",
    onBeforeSend: (payload, ctx) => {
      var _a2;
      const traceId = makeTraceId();
      const enriched = cloneSafe(payload);
      enriched.metadata = { ...(_a2 = enriched.metadata) != null ? _a2 : {}, traceId, sentAt: nowIso() };
      return { payload: enriched };
    },
    onAfterSend: (_payload, _response, ctx) => {
      console.debug(`[trace] completed send for ${ctx.sessionId}`);
    },
    onMessages: (messages) => {
      return { messages: messages.map((m) => ({ ...m, metadata: { ...m.metadata } })) };
    }
  };
}
function createAuthTokenRefresherPlugin(options) {
  var _a;
  const shouldRefresh = (_a = options.shouldRefresh) != null ? _a : ((error) => {
    var _a2;
    return (_a2 = error == null ? void 0 : error.message) == null ? void 0 : _a2.includes("401");
  });
  let cachedToken = null;
  const injectToken = async (payload) => {
    var _a2;
    if (!cachedToken) {
      cachedToken = await options.fetchToken();
    }
    const next = cloneSafe(payload);
    next.metadata = { ...(_a2 = next.metadata) != null ? _a2 : {}, authToken: cachedToken };
    return { payload: next };
  };
  return {
    name: "auth_token_refresher",
    onBeforeSend: (payload) => injectToken(payload),
    onSendError: async (error, payload) => {
      var _a2;
      if (!shouldRefresh(error)) return {};
      cachedToken = await options.fetchToken();
      const next = cloneSafe(payload);
      next.metadata = { ...(_a2 = next.metadata) != null ? _a2 : {}, authToken: cachedToken, refreshedAt: nowIso() };
      return { retry: true, payload: next, waitMs: 50 };
    }
  };
}

// src/conversations/ConversationDataService.ts
var ConversationDataService = class {
  constructor(options) {
    this.cache = /* @__PURE__ */ new Map();
    this.inflight = /* @__PURE__ */ new Map();
    var _a, _b;
    this.baseUrl = options.baseUrl;
    this.pageSize = options.pageSize;
    this.maxRetries = (_a = options.maxRetries) != null ? _a : 3;
    this.retryBackoffMs = (_b = options.retryBackoffMs) != null ? _b : 300;
  }
  /**
   * Returns a cached page when available. We cache each cursor separately to
   * avoid pagination gaps when multiple UI elements request different slices.
   */
  getCachedPage(cursor = "start") {
    var _a;
    return (_a = this.cache.get(cursor)) == null ? void 0 : _a.page;
  }
  /**
   * Attempts to cancel any inflight request for the provided cursor. This is
   * especially helpful when the UI unmounts or when rapid scrolling triggers
   * superseded fetches.
   */
  cancel(cursor = "start") {
    const inflight = this.inflight.get(cursor);
    if (inflight) {
      inflight.controller.abort();
      this.inflight.delete(cursor);
    }
  }
  /**
   * Clears all cached pages. Useful when a user changes workspaces/tenants and
   * stale data must be flushed without reloading the page.
   */
  reset() {
    this.cache.clear();
    this.inflight.forEach(({ controller }) => controller.abort());
    this.inflight.clear();
  }
  /**
   * Fetches a single page of conversations with retries and caching. Requests
   * for the same cursor are deduplicated so concurrent callers share the same
   * network response. Consumers receive a fresh object to avoid accidental
   * mutation of cache entries.
   */
  async fetchPage(cursor = "start", signal) {
    const existing = this.cache.get(cursor);
    if (existing) {
      return { ...existing.page, conversations: [...existing.page.conversations] };
    }
    const inflight = this.inflight.get(cursor);
    if (inflight) {
      if (signal) {
        signal.addEventListener("abort", () => inflight.controller.abort(), { once: true });
      }
      return inflight.promise;
    }
    const controller = new AbortController();
    const mergedSignal = signal ? this.mergeSignals(signal, controller.signal) : controller.signal;
    const promise = this.fetchWithRetry(cursor, mergedSignal).then((page) => {
      this.cache.set(cursor, { page, fetchedAt: Date.now() });
      this.inflight.delete(cursor);
      return { ...page, conversations: [...page.conversations] };
    }).catch((err) => {
      this.inflight.delete(cursor);
      throw err;
    });
    this.inflight.set(cursor, { controller, promise });
    return promise;
  }
  /**
   * Internal helper to compose multiple AbortSignals without requiring
   * AbortSignal.any (which is still experimental in some browsers). We also add
   * generous documentation so future refactors preserve cancellation behavior.
   */
  mergeSignals(a, b) {
    if (a.aborted) return a;
    if (b.aborted) return b;
    const controller = new AbortController();
    const abort = () => controller.abort();
    a.addEventListener("abort", abort, { once: true });
    b.addEventListener("abort", abort, { once: true });
    return controller.signal;
  }
  async fetchWithRetry(cursor, signal) {
    var _a;
    let attempt = 0;
    let lastError;
    while (attempt <= this.maxRetries) {
      try {
        const url = new URL(this.baseUrl, window.location.origin);
        if (cursor !== "start") {
          url.searchParams.set("cursor", cursor);
        }
        if (this.pageSize) {
          url.searchParams.set("limit", String(this.pageSize));
        }
        const response = await fetch(url.toString(), { signal });
        if (!response.ok) {
          if (response.status >= 500 || response.status === 429) {
            throw new RetryableError(`Server returned ${response.status}`);
          }
          throw new Error(`Failed to load conversations (${response.status})`);
        }
        const payload = await response.json();
        const conversations = (_a = payload.conversations) != null ? _a : [];
        return { conversations, nextCursor: payload.nextCursor };
      } catch (err) {
        if (signal.aborted) {
          throw new Error("Conversation request cancelled");
        }
        lastError = err;
        const isRetryable = err instanceof RetryableError || err instanceof TypeError && attempt < this.maxRetries;
        if (!isRetryable || attempt === this.maxRetries) {
          throw err;
        }
        const backoff = this.retryBackoffMs * 2 ** attempt;
        await this.delay(backoff, signal);
        attempt += 1;
      }
    }
    throw lastError != null ? lastError : new Error("Unknown conversation fetch failure");
  }
  delay(ms, signal) {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        window.clearTimeout(timeout);
        reject(new Error("Conversation request cancelled"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
};
var RetryableError = class extends Error {
};
function sortConversations(conversations) {
  return [...conversations].sort((a, b) => a.lastMessageAt > b.lastMessageAt ? -1 : 1);
}

// src/conversations/ConversationSidebar.tsx
var import_react4 = require("react");

// src/conversations/useConversationFeed.ts
var import_react3 = require("react");
function useConversationFeed(service, initialCursor = "start") {
  const [state, setState] = (0, import_react3.useState)({
    pages: [],
    loading: false,
    hasMore: true
  });
  const cursorRef = (0, import_react3.useRef)(initialCursor);
  const abortRef = (0, import_react3.useRef)(null);
  const conversations = (0, import_react3.useMemo)(
    () => state.pages.flatMap((page) => page.conversations),
    [state.pages]
  );
  const loadPage = (0, import_react3.useCallback)(
    async (cursor) => {
      if (state.loading) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setState((prev) => ({ ...prev, loading: true, error: void 0 }));
      try {
        const page = await service.fetchPage(cursor, controller.signal);
        setState((prev) => {
          const pages = cursor === initialCursor ? [page] : [...prev.pages, page];
          return {
            pages,
            loading: false,
            error: void 0,
            hasMore: Boolean(page.nextCursor)
          };
        });
        cursorRef.current = page.nextCursor;
      } catch (err) {
        if (err.message.includes("cancelled")) {
          return;
        }
        setState((prev) => ({ ...prev, loading: false, error: err }));
      }
    },
    [initialCursor, service, state.loading]
  );
  (0, import_react3.useEffect)(() => {
    loadPage(initialCursor);
    return () => {
      var _a;
      (_a = abortRef.current) == null ? void 0 : _a.abort();
      service.cancel(cursorRef.current);
    };
  }, [initialCursor, loadPage, service]);
  const loadMore = (0, import_react3.useCallback)(() => {
    if (!state.hasMore || state.loading) return;
    loadPage(cursorRef.current);
  }, [loadPage, state.hasMore, state.loading]);
  const retry = (0, import_react3.useCallback)(() => {
    var _a;
    loadPage((_a = cursorRef.current) != null ? _a : initialCursor);
  }, [initialCursor, loadPage]);
  return {
    conversations,
    pages: state.pages,
    loading: state.loading,
    error: state.error,
    hasMore: state.hasMore,
    loadMore,
    retry
  };
}

// src/conversations/ConversationSidebar.tsx
var import_jsx_runtime4 = require("react/jsx-runtime");
function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString(void 0, {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric"
  });
}
function renderPreview(preview) {
  if (!preview) return "No recent messages yet";
  return preview.length > 80 ? `${preview.slice(0, 77)}...` : preview;
}
var ConversationSidebar = ({
  service,
  onSelectConversation,
  selectedConversationId,
  title = "Inbox"
}) => {
  const listRef = (0, import_react4.useRef)(null);
  const { conversations, loading, error, hasMore, loadMore, retry } = useConversationFeed(
    service
  );
  const sorted = (0, import_react4.useMemo)(() => sortConversations(conversations), [conversations]);
  const handleScroll = (0, import_react4.useCallback)(() => {
    const node = listRef.current;
    if (!node || !hasMore || loading) return;
    const distanceToBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    if (distanceToBottom < 96) {
      loadMore();
    }
  }, [hasMore, loadMore, loading]);
  const handleKeyDown = (0, import_react4.useCallback)(
    (event, index) => {
      if (!listRef.current) return;
      const elements = listRef.current.querySelectorAll("button[role='option']");
      const targetIndex = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1 : index;
      if (targetIndex < 0 || targetIndex >= elements.length) return;
      elements[targetIndex].focus();
      event.preventDefault();
    },
    []
  );
  const renderItem = (conversation, index) => {
    const isSelected = conversation.id === selectedConversationId;
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("li", { className: "cs-sidebar-row", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
      "button",
      {
        type: "button",
        role: "option",
        "aria-selected": isSelected,
        className: `cs-sidebar-item ${isSelected ? "cs-sidebar-item--active" : ""}`,
        onClick: () => onSelectConversation == null ? void 0 : onSelectConversation(conversation.id),
        onKeyDown: (event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            handleKeyDown(event, index);
          }
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "cs-sidebar-item__header", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "cs-sidebar-item__title", children: conversation.title }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "cs-sidebar-item__timestamp", "aria-label": "Last updated", children: formatTimestamp(conversation.lastMessageAt) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "cs-sidebar-item__body", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "cs-sidebar-item__preview", children: renderPreview(conversation.lastMessagePreview) }),
            conversation.unread ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "cs-sidebar-item__unread", "aria-label": "Unread" }) : null
          ] }),
          conversation.participantLabel ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "cs-sidebar-item__participant", children: conversation.participantLabel }) : null
        ]
      }
    ) }, conversation.id);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("aside", { className: "cs-sidebar", "aria-label": "Conversation list", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "cs-sidebar__header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h2", { className: "cs-sidebar__title", children: title }),
      loading ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "cs-sidebar__spinner", "aria-live": "polite", children: "Loading\u2026" }) : null
    ] }),
    error ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "cs-sidebar__error", role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: "We could not load conversations. Please retry." }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", onClick: retry, className: "cs-sidebar__retry", children: "Retry" })
    ] }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
      "ul",
      {
        ref: listRef,
        className: "cs-sidebar__list",
        role: "listbox",
        "aria-label": "Conversations",
        tabIndex: 0,
        onScroll: handleScroll,
        children: [
          sorted.map((conversation, index) => renderItem(conversation, index)),
          !loading && sorted.length === 0 && !error ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("li", { className: "cs-sidebar__empty", children: "No conversations yet." }) : null,
          loading ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("li", { className: "cs-sidebar__loading", children: "Loading conversations\u2026" }) : null
        ]
      }
    ),
    hasMore && !loading ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "cs-sidebar__load-more", onClick: loadMore, children: "Load more" }) : null
  ] });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AbortSendError,
  ConversationDataService,
  ConversationSidebar,
  CustomerSupportChatWidget,
  PluginProvider,
  PluginRunner,
  PollingTransport,
  WebSocketTransport,
  cloneSafe,
  computeBackoff,
  createAuthTokenRefresherPlugin,
  createLoggingPlugin,
  createTracingPlugin,
  sortConversations,
  useConversationFeed,
  usePluginRunner
});
//# sourceMappingURL=index.js.map