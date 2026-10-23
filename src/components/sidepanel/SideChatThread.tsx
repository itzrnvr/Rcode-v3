import { ConversationEmptyState } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";

import { MessageCircleIcon } from "../common/Icons";
import { useChat } from "../../state/useChat";
import { AgentConversation } from "../chat/AgentConversation";
import { AgentMessage } from "../chat/AgentMessage";
import { AgentPromptInput } from "../chat/AgentPromptInput";
import { useEffect } from "react";
import type { Message as RcodeMessage } from "../../types";

interface SideChatThreadProps {
  sessionId: string;
  title: string;
}

export const pendingAutosend = new Map<string, string>();

export function SideChatThread({ sessionId, title }: SideChatThreadProps) {
  const {
    deleteMessage,
    editMessage,
    error,
    isStreaming,
    liveSteps,
    messages,
    resend,
    sendMessage,
    setVersion,
    stopStream,
    streamingContent,
    streamingTargetId,
    turnUsage,
  } = useChat(sessionId);

  useEffect(() => {
    const pending = pendingAutosend.get(sessionId);
    if (pending) {
      pendingAutosend.delete(sessionId);
      sendMessage(pending);
    }
  }, [sessionId, sendMessage]);

  return (
    <div className="side-chat-thread">
      <div className="side-chat-header">
        <MessageCircleIcon size={14} className="shrink-0 text-[var(--color-foreground-subtlest)]" />
        <span className="side-chat-title">{title}</span>
        <span className="side-chat-label">side chat</span>
      </div>

      <AgentConversation>
        {messages.length === 0 && !isStreaming ? (
          <ConversationEmptyState
            description="Ask a follow-up without changing the main thread."
            title="No messages yet"
          />
        ) : null}

        {(() => {
          const retryTargetIndex = isStreaming && streamingTargetId
            ? messages.findIndex(message => message.id === streamingTargetId)
            : -1;
          const retryPlaceholder: RcodeMessage = {
            id: `retry-streaming-${streamingTargetId ?? "target"}`,
            sessionId,
            role: "assistant",
            content: streamingContent,
            createdAt: Date.now(),
          };
          const visibleMessages = !streamingTargetId
            ? messages
            : Object.assign([...messages], { [retryTargetIndex]: retryPlaceholder });

          return visibleMessages.map((message, index) => {
          const previousUser = message.role === "assistant"
            ? messages.slice(0, index).reverse().find(item => item.role === "user")
            : undefined;

          const isRetryPlaceholder =
            isStreaming && retryTargetIndex >= 0 && message.id === retryPlaceholder.id;

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
              onRetry={
                message.role === "assistant" && previousUser
                  ? () => resend(previousUser.id)
                  : undefined
              }
              onVersionChange={nextIndex => setVersion(message.id, nextIndex)}
              streaming={isRetryPlaceholder || isStreaming}
              streamingContent={streamingContent}
            />
          );
          });
        })()}

        {isStreaming && !streamingTargetId && (
          <AgentMessage
            liveSteps={liveSteps}
            liveUsage={turnUsage}
            message={{
              id: `streaming-${sessionId}`,
              sessionId,
              role: "assistant",
              content: streamingContent,
              createdAt: Date.now(),
            }}
            streaming
            streamingContent={streamingContent}
          />
        )}

        {isStreaming && !streamingTargetId && liveSteps.length === 0 && !streamingContent && (
          <Message from="assistant">
            <MessageContent>
              <Shimmer>Thinking…</Shimmer>
            </MessageContent>
          </Message>
        )}

        {error && (
          <Message from="assistant">
            <MessageContent>
              <MessageResponse>{`Error: ${error}`}</MessageResponse>
            </MessageContent>
          </Message>
        )}
      </AgentConversation>

      <AgentPromptInput
        key={`side-composer-${sessionId}`}
        disabled={isStreaming}
        onSend={sendMessage}
        onStop={stopStream}
        streaming={isStreaming}
      />
    </div>
  );
}
