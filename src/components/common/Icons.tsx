/*
 * PURPOSE: Single source of icon imports — lucide-react only
 *
 * ALL icons in the app must come from this file. No emojis, no inline SVGs.
 *
 * Why lucide-react:
 * - Single consistent stroke width (1.75 / 2.0)
 * - Single viewBox (0 0 24 24) — no size drift
 * - Tree-shakeable, single source of truth
 * - All icons sized via `size` prop — defaults to 16px everywhere
 */

import {
  Plus,
  Search,
  Settings,
  Send,
  X,
  PanelRight,
  Copy,
  Trash2,
  ChevronLeft,
  ChevronDown,
  ArrowLeft,
  ArrowUp,
  MessageSquare,
  Minus,
  Maximize2,
  Globe,
  Code,
  Image,
  FlaskConical,
  Folder,
  Pin,
  Archive,
  MoreHorizontal,
  Lightbulb,
  Paperclip,
  Mic,
  Square,
  RefreshCw,
  Zap,
  Sparkles,
  Star,
  Gauge,
  Check,
  Pencil,
  User,
  Beaker,
  Compass,
  PanelLeft,
  Sidebar,
  PanelRightOpen,
  PanelRightClose,
  Settings2,
  KeyRound,
  Palette,
  Terminal,
  FileText,
  Globe2,
  Layers,
  Network,
  Cpu,
  History,
  BookOpen,
  ShieldCheck,
  Lock,
  LockOpen,
  ClipboardList,
  Wrench,
  Activity,
  GitFork,
  List,
  LayoutGrid,
  Download,
  Bot,
  MessageCircle,
  MessagesSquare,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Keyboard,
  PanelLeftClose,
  Code2,
  FolderOpen,
  ArrowUpRight,
  Undo2,
  Highlighter,
  MousePointer2,
  Eye,
  EyeOff,
  Clock,
  type LucideIcon,
} from "lucide-react";

// Default size is 16px everywhere. Stroke width inherits from lucide default (2).
const DEFAULT_SIZE = 16;

// Common icons
export const PlusIcon = (p: { size?: number; className?: string }) =>
  <Plus size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const SearchIcon = (p: { size?: number; className?: string }) =>
  <Search size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const SettingsIcon = (p: { size?: number; className?: string }) =>
  <Settings size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const Settings2Icon = (p: { size?: number; className?: string }) =>
  <Settings2 size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const SendIcon = (p: { size?: number; className?: string }) =>
  <Send size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const XIcon = (p: { size?: number; className?: string }) =>
  <X size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const PanelRightIcon = (p: { size?: number; className?: string }) =>
  <PanelRight size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const PanelLeftIcon = (p: { size?: number; className?: string }) =>
  <PanelLeft size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const CopyIcon = (p: { size?: number; className?: string }) =>
  <Copy size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const TrashIcon = (p: { size?: number; className?: string }) =>
  <Trash2 size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const ChevronLeftIcon = (p: { size?: number; className?: string }) =>
  <ChevronLeft size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const ChevronDownIcon = (p: { size?: number; className?: string }) =>
  <ChevronDown size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const ChevronRightIcon = (p: { size?: number; className?: string }) =>
  <ChevronRight size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const ChevronsLeftIcon = (p: { size?: number; className?: string }) =>
  <ChevronsLeft size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const ChevronsRightIcon = (p: { size?: number; className?: string }) =>
  <ChevronsRight size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const ArrowLeftIcon = (p: { size?: number; className?: string }) =>
  <ArrowLeft size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const ArrowUpIcon = (p: { size?: number; className?: string }) =>
  <ArrowUp size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const MessagesSquareIcon = (p: { size?: number; className?: string }) =>
  <MessagesSquare size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const MessageCircleIcon = (p: { size?: number; className?: string }) =>
  <MessageCircle size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const MinusIcon = (p: { size?: number; className?: string }) =>
  <Minus size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const MaximizeIcon = (p: { size?: number; className?: string }) =>
  <Maximize2 size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const GlobeIcon = (p: { size?: number; className?: string }) =>
  <Globe size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const CodeIcon = (p: { size?: number; className?: string }) =>
  <Code size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const ImageIcon = (p: { size?: number; className?: string }) =>
  <Image size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const FlaskIcon = (p: { size?: number; className?: string }) =>
  <FlaskConical size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const FolderIcon = (p: { size?: number; className?: string }) =>
  <Folder size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const PinIcon = (p: { size?: number; className?: string }) =>
  <Pin size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const ArchiveIcon = (p: { size?: number; className?: string }) =>
  <Archive size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const DotsIcon = (p: { size?: number; className?: string }) =>
  <MoreHorizontal size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const LightbulbIcon = (p: { size?: number; className?: string }) =>
  <Lightbulb size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const PaperclipIcon = (p: { size?: number; className?: string }) =>
  <Paperclip size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const MicIcon = (p: { size?: number; className?: string }) =>
  <Mic size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const StopIcon = (p: { size?: number; className?: string }) =>
  <Square size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const RefreshIcon = (p: { size?: number; className?: string }) =>
  <RefreshCw size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const ZapIcon = (p: { size?: number; className?: string }) =>
  <Zap size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const GaugeIcon = (p: { size?: number; className?: string }) =>
  <Gauge size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const SparkleIcon = (p: { size?: number; className?: string }) =>
  <Sparkles size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const StarIcon = (p: { size?: number; className?: string }) =>
  <Star size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const CheckIcon = (p: { size?: number; className?: string }) =>
  <Check size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2.5} />;
export const PenIcon = (p: { size?: number; className?: string }) =>
  <Pencil size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const EyeIcon = (p: { size?: number; className?: string }) =>
  <Eye size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const EyeOffIcon = (p: { size?: number; className?: string }) =>
  <EyeOff size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const SquareIcon = (p: { size?: number; className?: string }) =>
  <Square size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const ArrowUpRightIcon = (p: { size?: number; className?: string }) =>
  <ArrowUpRight size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const Undo2Icon = (p: { size?: number; className?: string }) =>
  <Undo2 size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const HighlighterIcon = (p: { size?: number; className?: string }) =>
  <Highlighter size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const MousePointer2Icon = (p: { size?: number; className?: string }) =>
  <MousePointer2 size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const ClockIcon = (p: { size?: number; className?: string }) =>
  <Clock size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const EditIcon = PenIcon;
export const UserIcon = (p: { size?: number; className?: string }) =>
  <User size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const BeakerIcon = (p: { size?: number; className?: string }) =>
  <Beaker size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const CompassIcon = (p: { size?: number; className?: string }) =>
  <Compass size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;

// Sidebar collapse controls
export const SidebarIcon = (p: { size?: number; className?: string }) =>
  <Sidebar size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const SidebarOpenIcon = (p: { size?: number; className?: string }) =>
  <PanelRightOpen size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const SidebarCloseIcon = (p: { size?: number; className?: string }) =>
  <PanelRightClose size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;

// Mode icons (replaces emojis: 📋 🔓 🛡)
export const PlanModeIcon = (p: { size?: number; className?: string }) =>
  <ClipboardList size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const FullAccessModeIcon = (p: { size?: number; className?: string }) =>
  <LockOpen size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const RestrictedModeIcon = (p: { size?: number; className?: string }) =>
  <ShieldCheck size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;

// Settings page sidebar icons
export const KeyIcon = (p: { size?: number; className?: string }) =>
  <KeyRound size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const PaletteIcon = (p: { size?: number; className?: string }) =>
  <Palette size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const TerminalIcon = (p: { size?: number; className?: string }) =>
  <Terminal size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const FileTextIcon = (p: { size?: number; className?: string }) =>
  <FileText size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const Globe2Icon = (p: { size?: number; className?: string }) =>
  <Globe2 size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const CpuIcon = (p: { size?: number; className?: string }) =>
  <Cpu size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const LayersIcon = (p: { size?: number; className?: string }) =>
  <Layers size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const HistoryIcon = (p: { size?: number; className?: string }) =>
  <History size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const BookIcon = (p: { size?: number; className?: string }) =>
  <BookOpen size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const LockIcon = (p: { size?: number; className?: string }) =>
  <Lock size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const WrenchIcon = (p: { size?: number; className?: string }) =>
  <Wrench size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const ListIcon = (p: { size?: number; className?: string }) =>
  <List size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const LayoutGridIcon = (p: { size?: number; className?: string }) =>
  <LayoutGrid size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const DownloadIcon = (p: { size?: number; className?: string }) =>
  <Download size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const GitForkIcon = (p: { size?: number; className?: string }) =>
  <GitFork size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const ActivityIcon = (p: { size?: number; className?: string }) =>
  <Activity size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const BotIcon = (p: { size?: number; className?: string }) =>
  <Bot size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;

// Settings page sidebar icons (additional)
export const KeyboardIcon = (p: { size?: number; className?: string }) =>
  <Keyboard size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const InfoIcon = (p: { size?: number; className?: string }) =>
  <BookOpen size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const PanelLeftCloseIcon = (p: { size?: number; className?: string }) =>
  <PanelLeftClose size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const Code2Icon = (p: { size?: number; className?: string }) =>
  <Code2 size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const FolderOpenIcon = (p: { size?: number; className?: string }) =>
  <FolderOpen size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const NetworkIcon = (p: { size?: number; className?: string }) =>
  <Network size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const TerminalSquareIcon = (p: { size?: number; className?: string }) =>
  <Terminal size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;
export const ShieldCheckIcon = (p: { size?: number; className?: string }) =>
  <ShieldCheck size={p.size ?? DEFAULT_SIZE} className={p.className} strokeWidth={2} />;

// Re-export LucideIcon type for consumers that need raw access
export type { LucideIcon };
