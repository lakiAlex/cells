// The app's icons: Hugeicons stroke-rounded (MIT, https://hugeicons.com), the set
// Lookout uses, under the names the components use. The title bar's brand mark
// is drawn like the app icon.
import {
  Alert02Icon,
  AlignBottomIcon,
  AlignTopIcon,
  AlignVerticalCenterIcon,
  ArrowDown01Icon,
  ArrowDown02Icon,
  ArrowDownToLineIcon,
  ArrowLeft02Icon,
  ArrowLeftToLineIcon,
  ArrowRight01Icon,
  ArrowRight02Icon,
  ArrowRightToLineIcon,
  ArrowUp01Icon,
  ArrowUp02Icon,
  ArrowUpDownIcon,
  BorderFullIcon,
  Cancel01Icon,
  CaseSensitiveIcon,
  CatIcon,
  ChartColumnIcon,
  ClipboardPasteIcon,
  Clock01Icon,
  Copy01Icon,
  CopyPlusIcon,
  DecimalsArrowLeftIcon,
  DecimalsArrowRightIcon,
  Delete02Icon,
  EraserIcon,
  FileAddIcon,
  FileSpreadsheetIcon,
  FilterHorizontalIcon,
  FilterIcon,
  FloppyDiskIcon,
  FolderOpenIcon,
  FunctionSquareIcon,
  GoogleSheetIcon,
  InsertColumnLeftIcon,
  InsertColumnRightIcon,
  InsertRowDownIcon,
  InsertRowUpIcon,
  KeyboardIcon,
  Link04Icon,
  Loading03Icon,
  Moon02Icon,
  MoreHorizontalIcon,
  PaintBoardIcon,
  PaintBucketIcon,
  PencilEdit02Icon,
  PinIcon,
  PinOffIcon,
  PlusSignIcon,
  Redo02Icon,
  RefreshIcon,
  ScissorIcon,
  Search01Icon,
  Sun03Icon,
  TableCellsMergeIcon,
  TableCellsSplitIcon,
  TextAlignCenterIcon,
  TextAlignLeftIcon,
  TextAlignRightIcon,
  TextBoldIcon,
  TextClearIcon,
  TextColorIcon,
  TextItalicIcon,
  TextSelectionIcon,
  TextStrikethroughIcon,
  TextUnderlineIcon,
  TextWrapIcon,
  Tick02Icon,
  Undo02Icon,
  ViewIcon,
  ViewOffIcon,
  SortingAZ01Icon,
  SortingZA01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

// The two sheets from the app icon (src-tauri/icons/make-icon.py): a grey sheet behind a white one with a header
// row, grid lines and a selected cell. Colors come from the --brand-* variables in styles.css.
export function BrandMark({ size = 17 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="brand-mark-top" gradientUnits="userSpaceOnUse" x1="0" y1="7" x2="0" y2="22">
          <stop offset="0" stopColor="var(--brand-top-1)" />
          <stop offset="1" stopColor="var(--brand-top-2)" />
        </linearGradient>
      </defs>
      <rect x="7.5" y="2" width="14.5" height="14.5" rx="2.6" fill="var(--brand-back)" />
      <rect x="2.3" y="7.8" width="14.5" height="14.5" rx="2.6" fill="var(--brand-side)" />
      <rect x="2" y="7.5" width="14.5" height="14.5" rx="2.6" fill="url(#brand-mark-top)" />
      <rect x="3.6" y="9.1" width="11.3" height="2.3" rx="0.6" fill="var(--brand-pad)" />
      <path d="M6.4 11.4V20.4M9.25 11.4V20.4M12.1 11.4V20.4M3.6 13.6H14.9M3.6 15.9H14.9M3.6 18.2H14.9" stroke="var(--brand-pad)" strokeWidth="0.35" />
      <rect x="6.4" y="15.9" width="2.85" height="2.3" rx="0.3" stroke="var(--brand-hole)" strokeWidth="0.6" />
    </svg>
  );
}

interface IconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

function icon(svg: IconSvgElement) {
  return function Icon({ size = 16, strokeWidth = 1.7, className }: IconProps) {
    return <HugeiconsIcon icon={svg} size={size} strokeWidth={strokeWidth} className={className} />;
  };
}

export const AlignCenter = icon(TextAlignCenterIcon);
export const AlignLeft = icon(TextAlignLeftIcon);
export const AlignRight = icon(TextAlignRightIcon);
export const AlignVerticalJustifyCenter = icon(AlignVerticalCenterIcon);
export const AlignVerticalJustifyEnd = icon(AlignBottomIcon);
export const AlignVerticalJustifyStart = icon(AlignTopIcon);
export const ArrowDown = icon(ArrowDown02Icon);
export const ArrowDownAZ = icon(SortingAZ01Icon);
export const ArrowDownToLine = icon(ArrowDownToLineIcon);
export const ArrowLeftToLine = icon(ArrowLeftToLineIcon);
export const ArrowRightToLine = icon(ArrowRightToLineIcon);
export const ArrowUp = icon(ArrowUp02Icon);
export const ArrowUpDown = icon(ArrowUpDownIcon);
export const ArrowUpZA = icon(SortingZA01Icon);
export const Baseline = icon(TextColorIcon);
export const BetweenHorizontalEnd = icon(InsertRowDownIcon);
export const BetweenHorizontalStart = icon(InsertRowUpIcon);
export const BetweenVerticalEnd = icon(InsertColumnRightIcon);
export const BetweenVerticalStart = icon(InsertColumnLeftIcon);
export const Bold = icon(TextBoldIcon);
export const CaseSensitive = icon(CaseSensitiveIcon);
export const Cat = icon(CatIcon);
export const ChartColumn = icon(ChartColumnIcon);
export const Check = icon(Tick02Icon);
export const ChevronDown = icon(ArrowDown01Icon);
export const ChevronRight = icon(ArrowRight01Icon);
export const ChevronUp = icon(ArrowUp01Icon);
export const ClipboardPaste = icon(ClipboardPasteIcon);
export const Clock = icon(Clock01Icon);
export const Copy = icon(Copy01Icon);
export const CopyPlus = icon(CopyPlusIcon);
export const DecimalsArrowLeft = icon(DecimalsArrowLeftIcon);
export const DecimalsArrowRight = icon(DecimalsArrowRightIcon);
export const Ellipsis = icon(MoreHorizontalIcon);
export const Eraser = icon(EraserIcon);
export const Eye = icon(ViewIcon);
export const EyeOff = icon(ViewOffIcon);
export const FilePlus2 = icon(FileAddIcon);
export const FileSpreadsheet = icon(FileSpreadsheetIcon);
export const Filter = icon(FilterIcon);
export const FolderOpen = icon(FolderOpenIcon);
export const Grid2x2 = icon(BorderFullIcon);
export const Italic = icon(TextItalicIcon);
export const Keyboard = icon(KeyboardIcon);
export const Link = icon(Link04Icon);
export const ListFilter = icon(FilterHorizontalIcon);
export const LoaderCircle = icon(Loading03Icon);
export const Moon = icon(Moon02Icon);
export const MoveDown = icon(ArrowDown02Icon);
export const MoveLeft = icon(ArrowLeft02Icon);
export const MoveRight = icon(ArrowRight02Icon);
export const MoveUp = icon(ArrowUp02Icon);
export const PaintBucket = icon(PaintBucketIcon);
export const Palette = icon(PaintBoardIcon);
export const Pencil = icon(PencilEdit02Icon);
export const Pin = icon(PinIcon);
export const PinOff = icon(PinOffIcon);
export const Plus = icon(PlusSignIcon);
export const Redo2 = icon(Redo02Icon);
export const RefreshCw = icon(RefreshIcon);
export const RemoveFormatting = icon(TextClearIcon);
export const Save = icon(FloppyDiskIcon);
export const Scissors = icon(ScissorIcon);
export const Search = icon(Search01Icon);
export const Sheet = icon(GoogleSheetIcon);
export const SquareFunction = icon(FunctionSquareIcon);
export const Strikethrough = icon(TextStrikethroughIcon);
export const Sun = icon(Sun03Icon);
export const TableCellsMerge = icon(TableCellsMergeIcon);
export const TableCellsSplit = icon(TableCellsSplitIcon);
export const Trash2 = icon(Delete02Icon);
export const TriangleAlert = icon(Alert02Icon);
export const Underline = icon(TextUnderlineIcon);
export const Undo2 = icon(Undo02Icon);
export const WholeWord = icon(TextSelectionIcon);
export const WrapText = icon(TextWrapIcon);
export const X = icon(Cancel01Icon);
