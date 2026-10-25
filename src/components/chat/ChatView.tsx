import { useCallback, useEffect, useRef, useState } from "react";

import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";

import { api } from "../../api/client";
import { useApp } from "../../state/AppContext";
import { useChat } from "../../state/useChat";
import { pendingAutosend } from "../sidepanel/SideChatThread";
import type { Message as RcodeMessage, Session } from "../../types";

import { AgentConversation } from "./AgentConversation";
import { AgentMessage } from "./AgentMessage";
import { AgentPromptInput } from "./AgentPromptInput";
import { ContextMenu, type ContextMenuItem } from "../common/ContextMenu";
import {
  ActivityIcon,
  ArrowLeftIcon,
  BeakerIcon,
  ChevronDownIcon,
  CodeIcon,
  CompassIcon,
  FolderIcon,
  GitForkIcon,
} from "../common/Icons";

const QUICK_PROMPTS = [
  {
    title: "Explore an idea",
    prompt: "Help me explore an idea about distributed systems...",
  },
  {
    title: "Refactor code",
    prompt: "Review this code and suggest improvements:",
  },
  {
    title: "Debug an issue",
    prompt: "I'm getting an error. Here's the stack trace:",
  },
  {
    title: "Brainstorm",
    prompt: "Brainstorm 10 creative names for a project that...",
  },
];

export function ChatView() {
  const {
    bumpSessionList,
    bumpSideChats,
    currentSessionId,
    setCurrentSessionId,
    setHasSideChats,
    setSidePanelCollapsed,
    settings,
  } = useApp();

  const {
    deleteMessage,
    editMessage,
    error,
    isStreaming,
    liveSteps,
    messages,
    queuedMessages,
    refreshMessages,
    resend,
    sendMessage,
    sendTo,
    setVersion,
    stopStream,
    streamingContent,
    streamingTargetId,
    turnUsage,
  } = useChat(currentSessionId);

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches);
  const [headerOverflowOpen, setHeaderOverflowOpen] = useState(false);
  const headerOverflowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const m = window.matchMedia("(max-width: 768px)");
    const onChange = () => setIsMobile(m.matches);
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, []);
  useEffect(() => {
    if (!headerOverflowOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!headerOverflowRef.current?.contains(e.target as Node)) {
        setHeaderOverflowOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [headerOverflowOpen]);
  const [session, setSession] = useState<Session | null>(null);

  // During retry, the temporary streaming message takes the old response's
  // exact position. This prevents the model output from appearing as a new,
  // unrelated turn at the bottom of the transcript.
  const retryTargetIndex = isStreaming && streamingTargetId
    ? messages.findIndex(message => message.id === streamingTargetId)
    : -1;
  const retryPlaceholder: RcodeMessage = {
    id: `retry-streaming-${streamingTargetId ?? "target"}`,
    sessionId: currentSessionId ?? "",
    role: "assistant",
    content: streamingContent,
    createdAt: Date.now(),
  };
  const visibleMessages = retryTargetIndex === -1
    ? messages
    : Object.assign([...messages], { [retryTargetIndex]: retryPlaceholder });

  useEffect(() => {
    if (!currentSessionId) {
      setSession(null);
      return;
    }
    api.getSession(currentSessionId).then(nextSession => setSession(nextSession));
  }, [currentSessionId]);

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    const selection = window.getSelection()?.toString().trim();
    if (!selection) return;
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY });
  }, []);

  const createSideChat = useCallback(async () => {
    const selection = window.getSelection()?.toString().trim();
    if (!selection || !currentSessionId || !session) return;

    const result = await api.createSideChat({
      parentSessionId: currentSessionId,
      title: selection.slice(0, 40),
      model: settings.model,
      provider: settings.providerName,
    });

    bumpSideChats();
    setHasSideChats(true);
    setMenu(null);
    setSidePanelCollapsed(false);
    window.dispatchEvent(
      new CustomEvent("sidepanel:new-tab", {
        detail: { type: "side-conversation", sideChatId: result.session.id },
      })
    );
  }, [
    bumpSideChats,
    currentSessionId,
    session,
    setHasSideChats,
    setSidePanelCollapsed,
    settings.model,
    settings.providerName,
  ]);

  const menuItems: ContextMenuItem[] = [
    { label: "Create side chat from selection", onClick: createSideChat },
  ];
  const openTrajectoryViewer = () => {
    setSidePanelCollapsed(false);
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("sidepanel:new-tab", { detail: { type: "trajectory" } })
      );
    }, 0);
  };

  const handleSend = useCallback(
    async (text: string, meta?: { mode?: string; reasoningEffort?: string }) => {
      const trimmed = text.trim();

      if (trimmed.toLowerCase() === "/compact") {
        if (!currentSessionId) return;
        try {
          await (
            api as unknown as {
              compactChat: (id: string) => Promise<{ summary: string }>;
            }
          ).compactChat(currentSessionId);
          await refreshMessages();
        } catch (cause) {
          console.error("compact failed", cause);
        }
        return;
      }

      if (trimmed.toLowerCase().startsWith("/side")) {
        if (!currentSessionId) return sendMessage(text, meta);

        const rest = trimmed.slice(5).trim();
        const title = rest
          ? rest.slice(0, 40)
          : `Side: ${session?.title?.slice(0, 24) ?? "branch"}`;

        try {
          const result = await api.createSideChat({
            parentSessionId: currentSessionId,
            title,
            model: settings.model,
            provider: settings.providerName,
          });

          bumpSideChats();
          setHasSideChats(true);
          await setSidePanelCollapsed(false);
          window.dispatchEvent(
            new CustomEvent("sidepanel:new-tab", {
              detail: { type: "side-conversation", sideChatId: result.session.id },
            })
          );
          if (rest) pendingAutosend.set(result.session.id, rest);
        } catch (cause) {
          console.error("side branch failed", cause);
        }
        return;
      }

      return sendMessage(text, meta);
    },
    [
      bumpSideChats,
      currentSessionId,
      refreshMessages,
      sendMessage,
      session,
      setHasSideChats,
      setSidePanelCollapsed,
      settings.model,
      settings.providerName,
    ]
  );

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ cmd: string }>;
      if (custom.detail?.cmd) handleSend(custom.detail.cmd);
    };
    window.addEventListener("chat:slash", handler as EventListener);
    return () => window.removeEventListener("chat:slash", handler as EventListener);
  }, [handleSend]);

  const handleWelcomeSend = useCallback(
    async (text: string, meta?: { mode?: string; reasoningEffort?: string }) => {
      if (!text.trim()) return;
      const nextSession = await api.createSession({
        model: settings.model,
        provider: settings.providerName,
        title: text.slice(0, 40),
      });
      setCurrentSessionId(nextSession.id);
      bumpSessionList();
      await sendTo(nextSession.id, text, meta);
      bumpSessionList();
    },
    [
      bumpSessionList,
      sendTo,
      setCurrentSessionId,
      settings.model,
      settings.providerName,
    ]
  );

  const handleFork = useCallback(
    async (messageId: string) => {
      if (!currentSessionId) return;
      try {
        const fork = await (
          api as unknown as {
            forkSession: (sessionId: string, mid: string) => Promise<{ id: string }>;
          }
        ).forkSession(currentSessionId, messageId);
        bumpSessionList();
        setCurrentSessionId(fork.id);
      } catch (cause) {
        console.error("fork failed", cause);
      }
    },
    [bumpSessionList, currentSessionId, setCurrentSessionId]
  );

  /*
   * The prototype's empty state (OneUIDemo EmptyState): no hero icon — the
   * boxed robot/sparkle tile is the AI-app cliché and was removed there —
   * just the headline, one supporting line, and the real quick prompts as
   * quiet pills. The pills still create a session and send their prompt for
   * real; only the dress is from the prototype.
   */
  const emptyState = (
    <div className="rcode-empty">
      <div className="rcode-empty-title">What are we building?</div>
      <p className="rcode-empty-description">
        Pick up a session on the left, or start something new. Rcode runs
        locally against your workspace.
      </p>
      <div className="rcode-quick-prompts">
        <Suggestions>
          {QUICK_PROMPTS.map(prompt => (
            <Suggestion
              key={prompt.title}
              onClick={value => handleWelcomeSend(value)}
              suggestion={prompt.prompt}
            >
              {prompt.title}
            </Suggestion>
          ))}
        </Suggestions>
      </div>
    </div>
  );

  return (
    <div className="panel-chat">
      <div className="chat-header">
        {session && session.depth > 0 && (
          <button
            className="chat-back-btn"
            onClick={() => session.parentId && setCurrentSessionId(session.parentId)}
            title="Back to parent"
          >
            <ArrowLeftIcon size={16} />
          </button>
        )}
        <span className="chat-title">{session?.title ?? "New chat"}</span>
        {/*
         * Project, branch, trajectory and the overflow menu are removed for
         * v1 - the header carried four controls for one title, and the
         * desktop "More" button had no handler at all. Additive to restore.
         */}
        {session && session.depth > 0 && (
          <span className="chat-depth">depth {session.depth}</span>
        )}
      </div>

      <AgentConversation onContextMenu={handleContextMenu}>
        {messages.length === 0 && !isStreaming ? emptyState : null}

        {visibleMessages.map((message, index) => {
          const isRetryPlaceholder =
            isStreaming && retryTargetIndex >= 0 && message.id === retryPlaceholder.id;
          const previousUser = message.role === "assistant"
            ? messages.slice(0, index).reverse().find(item => item.role === "user")
            : undefined;

          return (
            <AgentMessage
              key={message.id}
              liveSteps={isRetryPlaceholder ? liveSteps : undefined}
              liveUsage={isRetryPlaceholder ? turnUsage : undefined}
              message={message}
              onDelete={() => deleteMessage(message.id)}
              onEdit={nextContent => {
                if (message.role === "user") {
                  editMessage(message.id, nextContent).then(() => resend(message.id));
                } else {
                  editMessage(message.id, nextContent);
                }
              }}
              onFork={() => handleFork(message.id)}
              onRetry={
                message.role === "assistant" && previousUser
                  ? () => resend(previousUser.id)
                  : undefined
              }
              onVersionChange={nextIndex => setVersion(message.id, nextIndex)}
              streaming={isRetryPlaceholder || isStreaming}
              streamingContent={isRetryPlaceholder ? streamingContent : streamingContent}
            />
          );
        })}

        {/*
          The placeholder and the live turn are the same slot, not two
          siblings. As two siblings they swapped places when the first token
          arrived - the shimmer unmounted and the trace mounted in a different
          node - which moved the answer up by a row.
        */}
        {isStreaming && retryTargetIndex === -1 && (
          liveSteps.length === 0 && !streamingContent ? (
            <Message from="assistant">
              <MessageContent>
                <Shimmer>Thinking…</Shimmer>
              </MessageContent>
            </Message>
          ) : (
            <AgentMessage
              liveSteps={liveSteps}
              liveUsage={turnUsage}
              message={{
                id: `streaming-${currentSessionId ?? "root"}`,
                sessionId: currentSessionId ?? "",
                role: "assistant",
                content: streamingContent,
                createdAt: Date.now(),
              }}
              streaming
              streamingContent={streamingContent}
            />
          )
        )}

        {error && (
          <Message from="assistant">
            <MessageContent>
              <MessageResponse>{`Error: ${error}`}</MessageResponse>
            </MessageContent>
          </Message>
        )}
      </AgentConversation>

      {/*
        Messages sent while a turn was running. They wait above the composer
        rather than in the transcript: putting them in the transcript would
        move the scroll position every time one was queued, and the list is
        supposed to hold still.
      */}
      {queuedMessages.length > 0 && (
        <div className="rcode-queued-messages">
          {queuedMessages.map(message => (
            <div key={message.id} className="rcode-queued-message">
              <span className="rcode-queued-message-text">{message.text}</span>
              <span className="rcode-queued-message-note">queued</span>
            </div>
          ))}
        </div>
      )}

      <AgentPromptInput
        key={`composer-${currentSessionId ?? "welcome"}`}
        onSend={currentSessionId ? handleSend : handleWelcomeSend}
        onStop={stopStream}
        streaming={isStreaming}
      />

      {menu && (
        <ContextMenu
          items={menuItems}
          onClose={() => setMenu(null)}
          x={menu.x}
          y={menu.y}
        />
      )}
    </div>
  );
}

function HeaderPills() {
  const { branch, branches, cwdName, loadBranches, checkout } = useGitInfo();
  const [open, setOpen] = useState(false);

  const toggle = async () => {
    if (!open) {
      try { await loadBranches(); } catch {}
    }
    setOpen(current => !current);
  };

  return (
    <span className="chat-header-pills">
      <span className="header-pill">
        <FolderIcon size={12} />
        {cwdName || "…"}
      </span>
      <button className="header-pill" onClick={toggle} title="Switch branch">
        <GitForkIcon size={12} />
        {branch || "…"}
        <ChevronDownIcon size={10} />
      </button>
      {open && (
        <span data-sp-menu="1" className="sp-menu">
          {branches.map(nextBranch => (
            <button
              key={nextBranch}
              onClick={async () => {
                setOpen(false);
                try { await checkout(nextBranch); } catch {}
              }}
            >
              <GitForkIcon size={11} />
              {nextBranch}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

function HeaderPillsOverflowMenu({ onOpenTrajectory }: { onOpenTrajectory: () => void }) {
  const { branch, branches, cwdName, loadBranches, checkout } = useGitInfo();
  const [open, setOpen] = useState(false);
  return (
    <div className="chat-header-overflow-list" role="none">
      <div className="header-pill header-pill-static">
        <FolderIcon size={12} />
        {cwdName || "…"}
      </div>
      <button
        type="button"
        className="chat-header-overflow-item"
        onClick={() => {
          if (!open) loadBranches();
          setOpen(o => !o);
        }}
        aria-expanded={open}
      >
        <GitForkIcon size={12} />
        <span>{branch || "…"}</span>
        <ChevronDownIcon size={10} />
      </button>
      {open && (
        <div className="chat-header-overflow-sub" role="none">
          {branches.map(b => (
            <button
              key={b}
              type="button"
              className={`chat-header-overflow-subitem ${b === branch ? "active" : ""}`}
              onClick={async () => {
                setOpen(false);
                try { await checkout(b); } catch {}
              }}
            >
              <GitForkIcon size={11} />
              {b}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className="chat-header-overflow-item"
        onClick={onOpenTrajectory}
      >
        <ActivityIcon size={12} />
        <span>Trajectory viewer</span>
      </button>
    </div>
  );
}

function useGitInfo() {
  const [branch, setBranch] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [cwdName, setCwdName] = useState("");

  const gitApi = api as unknown as {
    gitBranches: () => Promise<string[]>;
    gitCheckout: (branch: string) => Promise<{ ok: boolean }>;
    gitCwdName: () => Promise<string>;
    gitStatus: () => Promise<{ branch: string }>;
  };

  useEffect(() => {
    gitApi.gitCwdName().then(setCwdName).catch(() => {});
    gitApi.gitStatus().then(status => setBranch(status.branch)).catch(() => {});
  }, [gitApi]);

  const loadBranches = async () => {
    try { setBranches(await gitApi.gitBranches()); }
    catch {}
  };

  const checkout = async (next: string) => {
    try {
      await gitApi.gitCheckout(next);
      setBranch(next);
    } catch {}
  };

  return { branch, branches, cwdName, loadBranches, checkout };
}
