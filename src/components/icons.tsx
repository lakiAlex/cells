// The app's icons: Hugeicons stroke-rounded (MIT, https://hugeicons.com), the set
// Lookout uses, under the names the components use. The title bar's brand glyph
// stays Lucide, since it matches the app icon.
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

// Lucide squares-unite, drawn like the app icon: a thick raised band with a side face
// and a fold along the diagonal. Colors come from the --brand-* variables in styles.css.
const SQUARES_UNITE =
  "M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3a1 1 0 0 0 1 1h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2v-3a1 1 0 0 0-1-1z";

export function BrandMark({ size = 17 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="-0.5 -0.5 25 25" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="brand-mark-top" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="24" y2="24">
          <stop offset="0" stopColor="var(--brand-top-1)" />
          <stop offset="1" stopColor="var(--brand-top-2)" />
        </linearGradient>
        <clipPath id="brand-mark-fold">
          <path d="M24.5 -0.5V24.5H-0.5z" />
        </clipPath>
      </defs>
      <path d={SQUARES_UNITE} stroke="var(--brand-side)" strokeWidth={3.4} transform="translate(0.35 0.7)" />
      <path d={SQUARES_UNITE} stroke="url(#brand-mark-top)" strokeWidth={3.4} />
      <path d={SQUARES_UNITE} stroke="var(--brand-fold)" strokeWidth={3.4} clipPath="url(#brand-mark-fold)" />
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
