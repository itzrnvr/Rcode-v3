import {
  PromptInput,
  type PromptInputMessage,
  PromptInputActionAddAttachments,
  PromptInputActionAddScreenshot,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { api } from "../../api/client";
import { useApp } from "../../state/AppContext";
import { useProviders } from "../../state/useProviders";
import {
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EyeIcon,
  LockIcon,
  MicIcon,
  PlusIcon,
  ShieldCheckIcon,
  GaugeIcon,
  StarIcon,
} from "../common/Icons";
import { useCallback, useEffect, useMemo, useState } from "react";

type AgentMode = "plan" | "full-access" | "restricted";

type ModelOption = ReturnType<typeof useProviders>["allModels"][number];

/* Favourites are stored as one setting: a JSON array of "<provider>:<id>" keys
 * in list order. Storage is user data, so every malformed shape it can arrive
 * in — missing, empty, not JSON, not an array, non-string entries — degrades to
 * an empty list instead of crashing the picker. */
function parsePinnedModels(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const keys = parsed.filter(
      (entry): entry is string => typeof entry === "string" && entry.trim() !== ""
    );
    return Array.from(new Set(keys)).slice(0, 200);
  } catch {
    return [];
  }
}

const modelKey = (model: ModelOption) => `${model.provider}:${model.id}`;

/*
 * Each mode carries what it actually does. On its own "Plan" is a word you have
 * to already understand, and picking between three bare labels means picking on
 * a globe/compass/lock icon. The line under the label is the choice.
 */
const MODES: Array<{
  value: AgentMode;
  label: string;
  hint: string;
  Icon: React.FC<{ size?: number; className?: string }>;
}> = [
  {
    value: "full-access",
    label: "Full access",
    hint: "Read, edit and run commands without asking.",
    Icon: ShieldCheckIcon,
  },
  {
    value: "plan",
    label: "Plan",
    hint: "Read-only. Proposes a plan and waits for you to approve it.",
    Icon: EyeIcon,
  },
  {
    value: "restricted",
    label: "Restricted",
    hint: "Only the paths you allow. Everything else is refused.",
    Icon: LockIcon,
  },
];

const EFFORTS = ["low", "medium", "high", "max"] as const;

/*
 * One model row, shared by the Pinned section and the provider sections. The
 * star is a button inside the row: stopPropagation on click keeps the pin
 * toggle from reaching CommandItem's select handler, the keydown guard keeps
 * cmdk's root Enter handler (which preventDefaults every Enter it sees) from
 * swallowing the button's native activation, and preventDefault on mousedown
 * keeps the click from stealing focus away from the search field.
 */
function ModelRow({
  model,
  selected,
  pinned,
  value,
  onSelect,
  onTogglePin,
}: {
  model: ModelOption;
  selected: boolean;
  pinned: boolean;
  value: string;
  onSelect: () => void;
  onTogglePin: () => void;
}) {
  return (
    <CommandItem
      data-checked={selected ? "true" : undefined}
      onSelect={onSelect}
      value={value}
    >
      {/* One line. This was two, which made every row
          ~85px tall and showed four models in a panel
          that fits thirty. Provider and context move to
          a right-aligned meta chip, the way ZCode puts
          them in a trailing badge. */}
      <span className="rcode-model-item">
        <span className="rcode-model-item-name">{model.name}</span>
        {/* Only the context size. description reads
            "Provider - 128K" and the group heading
            already states the provider, so repeating
            it per row spent a third of the width and
            pushed model names into ellipsis. */}
        <span className="rcode-model-item-meta">
          {model.description.split(/[•·]/).pop()?.trim()}
        </span>
        <button
          aria-label={pinned ? `Unpin ${model.name}` : `Pin ${model.name}`}
          aria-pressed={pinned}
          className={"rcode-model-star" + (pinned ? " pinned" : "")}
          onClick={event => {
            event.stopPropagation();
            onTogglePin();
          }}
          onKeyDown={event => {
            if (event.key === "Enter" || event.key === " ") event.stopPropagation();
          }}
          onMouseDown={event => event.preventDefault()}
          title={pinned ? "Unpin model" : "Pin model"}
          type="button"
        >
          <StarIcon className="rcode-model-star-icon" size={13} />
        </button>
      </span>
    </CommandItem>
  );
}

export function AgentPromptInput({
  disabled = false,
  onSend,
  onStop,
  streaming = false,
}: {
  disabled?: boolean;
  onSend: (text: string, meta?: { mode?: string; reasoningEffort?: string }) => void;
  onStop?: () => void;
  streaming?: boolean;
}) {
  const { settings, setSetting } = useApp();
  const { allModels } = useProviders();
  const [modelOpen, setModelOpen] = useState(false);
  const [mode, setMode] = useState<AgentMode>("full-access");
  const [effort, setEffort] = useState(settings.reasoningEffort || "max");
  const [search, setSearch] = useState("");
  const [pinnedKeys, setPinnedKeys] = useState<string[]>([]);
  const [openProviders, setOpenProviders] = useState<Set<string>>(new Set());

  const currentModel = allModels.find(model => model.id === settings.model);

  useEffect(() => {
    if (allModels.length > 0 && !currentModel) {
      setSetting("model", allModels[0].id);
      setSetting("providerName", allModels[0].provider);
    }
  }, [allModels, currentModel, setSetting]);

  // Load favourites once. The live list is component state — settings context
  // would hand back the raw JSON string, and reparsing it on every settings
  // write would fight the toggle.
  useEffect(() => {
    let cancelled = false;
    api
      .getSetting("pinnedModels")
      .then(value => {
        if (!cancelled) setPinnedKeys(parsePinnedModels(value));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // The picker remounts per open, but this state outlives it; a stale query
  // would keep providers force-expanded on the next open with an empty box.
  useEffect(() => {
    if (!modelOpen) setSearch("");
  }, [modelOpen]);

  const modelGroups = useMemo(() => {
    const byProvider = new Map<string, typeof allModels>();

    for (const model of allModels) {
      const group = byProvider.get(model.providerLabel) ?? [];
      group.push(model);
      byProvider.set(model.providerLabel, group);
    }

    return Array.from(byProvider.entries()).map(([label, models]) => ({
      label,
      models,
    }));
  }, [allModels]);

  const query = search.trim().toLowerCase();
  const searching = query !== "";

  const matchesQuery = useCallback(
    (model: ModelOption) =>
      !searching ||
      [model.id, model.name, model.provider, model.providerLabel].some(value =>
        value.toLowerCase().includes(query)
      ),
    [query, searching]
  );

  const visibleGroups = useMemo(
    () =>
      modelGroups
        .map(group => ({ label: group.label, models: group.models.filter(matchesQuery) }))
        .filter(group => group.models.length > 0),
    [modelGroups, matchesQuery]
  );

  // Pinned section, in pin order. Keys that no longer resolve to a live model
  // (provider disabled or removed) are skipped, not pruned from storage.
  const pinnedModels = useMemo(() => {
    const byKey = new Map(allModels.map(model => [modelKey(model), model]));
    const out: ModelOption[] = [];
    for (const key of pinnedKeys) {
      if (out.some(model => modelKey(model) === key)) continue;
      const model = byKey.get(key);
      if (model && matchesQuery(model)) out.push(model);
    }
    return out;
  }, [allModels, matchesQuery, pinnedKeys]);

  const togglePin = useCallback(
    (model: ModelOption) => {
      const key = modelKey(model);
      const next = pinnedKeys.includes(key)
        ? pinnedKeys.filter(entry => entry !== key)
        : [...pinnedKeys, key];
      setPinnedKeys(next);
      void setSetting("pinnedModels", JSON.stringify(next)).catch(() => {});
    },
    [pinnedKeys, setSetting]
  );

  const toggleProvider = useCallback((label: string) => {
    setOpenProviders(previous => {
      const next = new Set(previous);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);

  const chooseModel = useCallback(
    (model: ModelOption) => {
      setSetting("model", model.id);
      setSetting("providerName", model.provider);
      setModelOpen(false);
    },
    [setSetting]
  );

  const handleSubmit = useCallback(
    ({ text }: PromptInputMessage) => {
      const trimmed = text.trim();
      if (!trimmed || disabled) return;
      onSend(trimmed, { mode, reasoningEffort: effort });
    },
    [disabled, effort, mode, onSend]
  );

  return (
    <>
      <PromptInput className="rcode-prompt-input" onSubmit={handleSubmit}>
        <PromptInputBody>
          <PromptInputTextarea
            disabled={disabled}
            name="message"
            placeholder="Do anything"
          />
        </PromptInputBody>

        <PromptInputFooter className="rcode-prompt-footer">
          <PromptInputTools className="rcode-prompt-tools">
            <PromptInputActionMenu>
              <PromptInputActionMenuTrigger>
                <PlusIcon size={16} />
              </PromptInputActionMenuTrigger>
              <PromptInputActionMenuContent>
                <PromptInputActionAddAttachments />
                <PromptInputActionAddScreenshot />
              </PromptInputActionMenuContent>
            </PromptInputActionMenu>

            <div className="rcode-mode-select">
              <PromptInputSelect
                onValueChange={value => setMode(String(value) as AgentMode)}
                value={mode}
              >
                <PromptInputSelectTrigger
                  aria-label="Agent access mode"
                  className="rcode-composer-select"
                >
                  {(() => {
                    const current = MODES.find(m => m.value === mode) ?? MODES[0];
                    const ModeIcon = current.Icon;
                    return (
                      <>
                        <ModeIcon size={14} />
                        {/* Label collapses below md. An icon alone cannot say
                            whether the agent can currently run commands, which
                            is the thing worth knowing at a glance. */}
                        <span className="rcode-mode-trigger-label">
                          {current.label}
                        </span>
                      </>
                    );
                  })()}
                </PromptInputSelectTrigger>
                <PromptInputSelectContent align="start" className="rcode-mode-popup">
                {MODES.map(option => (
                  <PromptInputSelectItem key={option.value} value={option.value}>
                    <span className="rcode-mode-item">
                      <option.Icon size={14} className="rcode-mode-item-icon" />
                      <span className="rcode-mode-item-text">
                        <span className="rcode-mode-item-label">{option.label}</span>
                        <span className="rcode-mode-item-hint">{option.hint}</span>
                      </span>
                    </span>
                  </PromptInputSelectItem>
                ))}
                </PromptInputSelectContent>
              </PromptInputSelect>
            </div>

          </PromptInputTools>

          <PromptInputTools className="rcode-prompt-tools rcode-prompt-tools-right">
          {/* Reasoning effort is its own control, not a band inside the
              model list. Buried above the groups it competed with the model
              names for attention and split the panel into two jobs; ZCode
              keeps it separate for the same reason. */}
          <Popover>
            <PopoverTrigger
              render={<PromptInputButton className="rcode-effort-trigger" />}
            >
              <GaugeIcon size={13} />
              <span className="rcode-effort-trigger-label">
                {effort === "max" ? "Max" : effort[0].toUpperCase() + effort.slice(1)}
              </span>
              <ChevronDownIcon size={11} />
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="rcode-effort-popup"
              side="top"
              sideOffset={8}
            >
              <div className="rcode-effort-popup-label">Reasoning effort</div>
              {EFFORTS.map(value => (
                <button
                  type="button"
                  key={value}
                  className={"rcode-effort-option" + (effort === value ? " active" : "")}
                  onClick={() => {
                    setEffort(value);
                    setSetting("reasoningEffort", value);
                  }}
                >
                  <span>
                    {value === "max" ? "Max" : value[0].toUpperCase() + value.slice(1)}
                  </span>
                  {effort === value ? <CheckIcon size={14} /> : null}
                </button>
              ))}
            </PopoverContent>
          </Popover>

            <Popover open={modelOpen} onOpenChange={setModelOpen}>
              <PopoverTrigger
                render={
                  <PromptInputButton
                    className="rcode-composer-model-trigger"
                    tooltip={
                      currentModel
                        ? `${currentModel.provider} / ${currentModel.name}`
                        : "Choose model"
                    }
                  />
                }
              >
                {/* Model trigger: provider, model name, chevron. No icon and no
                    chrome around it — ZCode's is a ghost button, and a glyph
                    plus a bordered pill around two words of text was reading as
                    a third thing competing with the label. The name used to be
                    omitted entirely, so the control gave no indication of what
                    it had selected. Provider is a separate span so the composer
                    can drop it first when the toolbar is tight, keeping the
                    model name readable longest. */}
                <span className="rcode-model-trigger-label">
                  <span className="rcode-model-trigger-provider">
                    {currentModel?.provider}
                  </span>
                  <span className="rcode-model-trigger-name">
                    {currentModel?.name ?? "Choose model"}
                  </span>
                </span>
                <ChevronDownIcon
                  size={12}
                  className="rcode-model-trigger-chevron"
                />
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="rcode-model-selector"
                side="bottom"
                sideOffset={8}
              >
                {/* Filtering is done here, not by cmdk: the sections are
                    collapsible, so which items exist depends on state cmdk
                    cannot see. shouldFilter={false} keeps keyboard selection
                    and hover working over exactly the rows we chose to render. */}
                <Command className="border-none bg-transparent" shouldFilter={false}>
                  <CommandInput
                    autoFocus
                    placeholder="Search models…"
                    value={search}
                    onValueChange={setSearch}
                  />
                  <CommandList>
                    {pinnedModels.length > 0 && (
                      <CommandGroup heading="Pinned">
                        {pinnedModels.map(model => (
                          <ModelRow
                            key={`pinned:${model.provider}:${model.id}`}
                            model={model}
                            onSelect={() => chooseModel(model)}
                            onTogglePin={() => togglePin(model)}
                            pinned
                            selected={
                              currentModel?.id === model.id &&
                              currentModel?.provider === model.provider
                            }
                            value={`pinned:${model.provider}:${model.id}`}
                          />
                        ))}
                      </CommandGroup>
                    )}
                    {visibleGroups.map(group => {
                      // A typed query expands every provider with matches:
                      // someone who searched is looking for a result, not for
                      // the expand control. Empty groups are not rendered.
                      const expanded =
                        searching || openProviders.has(group.label);

                      return (
                        <CommandGroup key={group.label}>
                          <button
                            aria-expanded={expanded}
                            className="rcode-model-provider"
                            data-open={expanded ? "true" : "false"}
                            onClick={() => toggleProvider(group.label)}
                            onKeyDown={event => {
                              // cmdk's root preventDefaults every Enter;
                              // without this the header button never activates
                              // from the keyboard.
                              if (event.key === "Enter" || event.key === " ") {
                                event.stopPropagation();
                              }
                            }}
                            onMouseDown={event => event.preventDefault()}
                            type="button"
                          >
                            <ChevronRightIcon
                              className="rcode-model-provider-chevron"
                              size={12}
                            />
                            <span className="rcode-model-provider-name">
                              {group.label}
                            </span>
                            <span className="rcode-model-provider-count">
                              {group.models.length}
                            </span>
                          </button>
                          {expanded &&
                            group.models.map(model => (
                              <ModelRow
                                key={`${model.provider}:${model.id}`}
                                model={model}
                                onSelect={() => chooseModel(model)}
                                onTogglePin={() => togglePin(model)}
                                pinned={pinnedKeys.includes(modelKey(model))}
                                selected={
                                  currentModel?.id === model.id &&
                                  currentModel?.provider === model.provider
                                }
                                value={`${model.provider}:${model.id}`}
                              />
                            ))}
                        </CommandGroup>
                      );
                    })}
                    {visibleGroups.length === 0 && pinnedModels.length === 0 && (
                      <div className="rcode-model-empty">
                        {searching
                          ? "No models match your search."
                          : "No models available."}
                      </div>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            <PromptInputButton tooltip="Voice input">
              <MicIcon size={16} />
            </PromptInputButton>

            <PromptInputSubmit
              className="rcode-prompt-submit"
              disabled={disabled && !streaming}
              onStop={onStop}
              status={streaming ? "streaming" : undefined}
            >
              {/* The prototype's send is a round accent button with an up
                  arrow. The arrow is passed as children only while idle: while
                  a turn runs, children become undefined and the submit's own
                  status icons return (square while streaming), so the stop
                  affordance stays honest. undefined, not false — `??` only
                  falls through on null/undefined. */}
              {streaming ? undefined : <ArrowUpIcon size={20} className="size-5" />}
            </PromptInputSubmit>
          </PromptInputTools>
        </PromptInputFooter>
      </PromptInput>

    </>
  );
}
