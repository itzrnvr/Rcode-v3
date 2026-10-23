import { Message, MessageAction, MessageActions, MessageBranch, MessageBranchContent, MessageBranchNext, MessageBranchPage, MessageBranchPrevious, MessageBranchSelector, MessageContent, MessageResponse, MessageToolbar } from "@/components/ai-elements/message";

import { parseLegacyTurn } from "@/lib/agentTurn";
import type { AgentTurn, LiveStep, Message as RcodeMessage, TurnUsage } from "../../types";
import { AgentTrace } from "./AgentTrace";
import {
  CheckIcon,
  CopyIcon,
  GitForkIcon,
  PenIcon,
  RefreshIcon,
  TrashIcon,
} from "../common/Icons";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface AgentMessageProps {
  message: RcodeMessage;
  liveSteps?: LiveStep[];
  liveUsage?: TurnUsage | null;
  streaming?: boolean;
  streamingContent?: string;
  onEdit?: (content: string) => void;
  onDelete?: () => void;
  onRetry?: () => void;
  onFork?: () => void;
  onVersionChange?: (index: number) => void;
}

function messageTurn(
  message: RcodeMessage,
  liveSteps?: LiveStep[],
  liveUsage?: TurnUsage | null,
  streamingContent?: string
): AgentTurn {
  if (message.turn) return message.turn;

  const legacy = parseLegacyTurn(message.content);
  if (!liveSteps?.length) return legacy;

  return {
    ...legacy,
    usage: liveUsage ?? legacy.usage,
    events: liveSteps,
    finalContent: streamingContent ?? legacy.finalContent,
  };
}

export function AgentMessage({
  liveSteps,
  liveUsage,
  message,
  onEdit,
  onDelete,
  onFork,
  onRetry,
  onVersionChange,
  streaming = false,
  streamingContent,
}: AgentMessageProps) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.content);
  const turn = messageTurn(message, liveSteps, liveUsage, streamingContent);
  const versions = message.turnVersions?.length ? message.turnVersions : [turn];
  const activeVersion = message.versionIndex ?? 0;

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {}
  }, [message.content]);

  const startEditing = useCallback(() => {
    setEditValue(message.content);
    setEditing(true);
  }, [message.content]);

  const cancelEditing = useCallback(() => {
    setEditValue(message.content);
    setEditing(false);
  }, [message.content]);

  const saveEditing = useCallback(() => {
    const nextContent = editValue.trim();
    if (!nextContent || nextContent === message.content) {
      setEditing(false);
      return;
    }

    onEdit?.(nextContent);
    setEditing(false);
  }, [editValue, message.content, onEdit]);

  const content =
    message.role === "user" ? (
      editing ? (
        <MessageContent className="w-full max-w-full">
          <Textarea
            autoFocus
            className="w-full"
            onChange={event => setEditValue(event.target.value)}
            rows={3}
            value={editValue}
          />
          <div className="flex justify-end gap-2">
            <Button onClick={cancelEditing} size="sm" variant="outline">
              Cancel
            </Button>
            <Button disabled={!editValue.trim()} onClick={saveEditing} size="sm">
              Save & resend
            </Button>
          </div>
        </MessageContent>
      ) : (
        <MessageContent className="rcode-bubble-user">
          <MessageResponse>{message.content}</MessageResponse>
        </MessageContent>
      )
    ) : versions.length > 1 ? (
      <MessageBranch
        defaultBranch={activeVersion}
        key={`branch-${activeVersion}`}
        onBranchChange={onVersionChange}
      >
        <MessageBranchContent>
          {versions.map((version, index) => (
            <MessageContent key={`version-${index}`}>
              <AgentTrace streaming={streaming && index === activeVersion} turn={version} />
            </MessageContent>
          ))}
        </MessageBranchContent>
        <MessageToolbar>
          <MessageActions>
            <MessageBranchSelector>
              <MessageBranchPrevious />
              <MessageBranchPage />
              <MessageBranchNext />
            </MessageBranchSelector>
          </MessageActions>
        </MessageToolbar>
      </MessageBranch>
    ) : (
      <MessageContent>
        {editing ? (
          <>
            <Textarea
              autoFocus
              onChange={event => setEditValue(event.target.value)}
              rows={6}
              value={editValue}
            />
            <div className="flex justify-end gap-2">
              <Button onClick={cancelEditing} size="sm" variant="outline">
                Cancel
              </Button>
              <Button disabled={!editValue.trim()} onClick={saveEditing} size="sm">
                Save
              </Button>
            </div>
          </>
        ) : (
          <AgentTrace streaming={streaming} turn={turn} />
        )}
      </MessageContent>
    );

  return (
    <Message
      className="rcode-message"
      from={message.role === "user" ? "user" : "assistant"}
    >
      {content}
      <MessageToolbar
        className={`rcode-message-toolbar ${message.role === "user" ? "rcode-message-toolbar-user" : "rcode-message-toolbar-assistant"}`}
      >
        <MessageActions>
          <MessageAction onClick={copy} tooltip="Copy">
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          </MessageAction>
          {onEdit && (
            <MessageAction onClick={startEditing} tooltip="Edit">
              <PenIcon size={14} />
            </MessageAction>
          )}
          {onRetry && !streaming && (
            <MessageAction onClick={onRetry} tooltip="Retry">
              <RefreshIcon size={14} />
            </MessageAction>
          )}
          {onFork && !streaming && (
            <MessageAction onClick={onFork} tooltip="Fork">
              <GitForkIcon size={14} />
            </MessageAction>
          )}
          {onDelete && (
            <MessageAction onClick={onDelete} tooltip="Delete">
              <TrashIcon size={14} />
            </MessageAction>
          )}
        </MessageActions>
      </MessageToolbar>
    </Message>
  );
}
