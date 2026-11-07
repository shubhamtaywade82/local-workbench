// The assistant's structured actions. Options that have a fixed set of values
// live in menus. Diagram and Archify open a dialog for their description.

"use client";

import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { FileSearch, ImageIcon, Layers, ListTree, Network, RefreshCw, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CONVERT_FORMATS, IMPROVE_TONES, MERMAID_TYPES, type ConvertFormat, type ImproveTone, type MermaidType } from "@/lib/ai/tasks/contract";
import type { AssistantAction } from "@/features/workbench/ai/assistant-controller";

/** A dialog the action bar opens for an action that needs a description. */
export type DialogRequest = { readonly kind: "diagram"; readonly mermaidType: MermaidType } | { readonly kind: "archify" };

interface ActionBarProps {
  readonly disabled: boolean;
  readonly hasDocument: boolean;
  readonly diagnosticCount: number;
  readonly onRun: (action: AssistantAction) => void;
  readonly onOpenDialog: (request: DialogRequest) => void;
}

const FORMAT_LABEL: Readonly<Record<ConvertFormat, string>> = {
  json: "JSON",
  jsonc: "JSONC",
  json5: "JSON5",
  yaml: "YAML",
  toml: "TOML",
  toon: "TOON",
  xml: "XML",
  markdown: "Markdown",
};

const TONE_LABEL: Readonly<Record<ImproveTone, string>> = { concise: "Concise", detailed: "Detailed", friendly: "Friendly" };
const MERMAID_LABEL: Readonly<Record<MermaidType, string>> = { flowchart: "Flowchart", sequence: "Sequence", state: "State", er: "Entity relationship", class: "Class" };

export function ActionBar({ disabled, hasDocument, diagnosticCount, onRun, onOpenDialog }: ActionBarProps) {
  const docDisabled = disabled || !hasDocument;
  return (
    <div role="toolbar" aria-label="Assistant actions" className="flex flex-wrap items-center gap-1 border-b px-2 py-2">
      <ActionChip icon={<FileSearch className="h-3.5 w-3.5" />} label="Explain" disabled={docDisabled} onClick={() => onRun({ task: "explain" })} />
      <ActionChip
        icon={<Wrench className="h-3.5 w-3.5" />}
        label="Fix"
        badge={diagnosticCount > 0 ? String(diagnosticCount) : undefined}
        disabled={docDisabled}
        onClick={() => onRun({ task: "fix" })}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ActionChip icon={<RefreshCw className="h-3.5 w-3.5" />} label="Convert" chevron disabled={docDisabled} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuLabel className="text-[11px]">Convert the file to</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {CONVERT_FORMATS.map((format) => (
            <DropdownMenuItem key={format} onSelect={() => onRun({ task: "convert", targetFormat: format })}>
              {FORMAT_LABEL[format]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ActionChip icon={<ListTree className="h-3.5 w-3.5" />} label="Improve" chevron disabled={docDisabled} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuLabel className="text-[11px]">Rewrite Markdown as</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {IMPROVE_TONES.map((tone) => (
            <DropdownMenuItem key={tone} onSelect={() => onRun({ task: "improve-docs", tone })}>
              {TONE_LABEL[tone]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ActionChip icon={<ImageIcon className="h-3.5 w-3.5" />} label="Diagram" chevron disabled={disabled} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuLabel className="text-[11px]">Mermaid diagram from a description</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {MERMAID_TYPES.map((type) => (
            <DropdownMenuItem key={type} onSelect={() => onOpenDialog({ kind: "diagram", mermaidType: type })}>
              {MERMAID_LABEL[type]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <ActionChip icon={<Network className="h-3.5 w-3.5" />} label="Archify" disabled={disabled} onClick={() => onOpenDialog({ kind: "archify" })} />
      <ActionChip icon={<Layers className="h-3.5 w-3.5" />} label="Review" disabled={disabled} onClick={() => onRun({ task: "architecture-review" })} />
    </div>
  );
}

/**
 * A toolbar chip. It forwards its ref and every other prop to the button,
 * because Radix's `asChild` triggers attach their handlers through them.
 */
const ActionChip = forwardRef<HTMLButtonElement, ActionChipProps>(function ActionChip(
  { icon, label, badge, chevron, disabled, onClick, ...rest },
  ref
) {
  return (
    <Button
      {...rest}
      ref={ref}
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      className="h-7 gap-1.5 rounded-full px-2.5 text-[12px] font-normal"
    >
      {icon}
      {label}
      {badge && <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-medium text-primary">{badge}</span>}
      {chevron && <span aria-hidden="true" className="text-muted-foreground">▾</span>}
    </Button>
  );
});

interface ActionChipProps extends Omit<ComponentPropsWithoutRef<"button">, "children" | "type"> {
  readonly icon: ReactNode;
  readonly label: string;
  readonly badge?: string;
  readonly chevron?: boolean;
}
