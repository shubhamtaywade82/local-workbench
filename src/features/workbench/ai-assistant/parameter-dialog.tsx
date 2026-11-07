// The dialog for actions that need a description. It keeps the parameters in
// one place: the diagram type, the quality for Archify, and what to draw.

"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MERMAID_TYPES, type MermaidType } from "@/lib/ai/tasks/contract";
import { ARCHIFY_DIAGRAM_TYPES, ARCHIFY_QUALITY_PROFILES, type ArchifyDiagramType, type ArchifyQualityProfile } from "@/lib/archify/contract";
import type { AssistantAction } from "@/features/workbench/ai/assistant-controller";

import type { DialogRequest } from "./action-bar";

interface ParameterDialogProps {
  readonly request: DialogRequest | null;
  readonly onClose: () => void;
  readonly onSubmit: (action: AssistantAction) => void;
}

const ARCHIFY_LABEL: Readonly<Record<ArchifyDiagramType, string>> = {
  architecture: "Architecture",
  workflow: "Workflow",
  sequence: "Sequence",
  dataflow: "Data flow",
  lifecycle: "Lifecycle",
  erd: "Entity relationship",
  tree: "Tree",
  class: "Class",
  timeline: "Timeline",
  waterfall: "Waterfall",
};

const MERMAID_LABEL: Readonly<Record<MermaidType, string>> = {
  flowchart: "Flowchart",
  sequence: "Sequence",
  state: "State",
  er: "Entity relationship",
  class: "Class",
};

export function ParameterDialog({ request, onClose, onSubmit }: ParameterDialogProps) {
  if (!request) return null;
  return <ParameterForm key={request.kind === "diagram" ? `d-${request.mermaidType}` : "archify"} request={request} onClose={onClose} onSubmit={onSubmit} />;
}

function ParameterForm({ request, onClose, onSubmit }: Required<Pick<ParameterDialogProps, "onClose" | "onSubmit">> & { request: DialogRequest }) {
  const [description, setDescription] = useState("");
  const [mermaidType, setMermaidType] = useState<MermaidType>(request.kind === "diagram" ? request.mermaidType : "flowchart");
  const [archifyType, setArchifyType] = useState<ArchifyDiagramType>("architecture");
  const [quality, setQuality] = useState<ArchifyQualityProfile>("showcase");
  const isDiagram = request.kind === "diagram";
  const ready = description.trim().length > 0;

  const submit = () => {
    if (!ready) return;
    if (isDiagram) onSubmit({ task: "generate-diagram", mermaidType, description: description.trim() });
    else onSubmit({ task: "archify-diagram", diagramType: archifyType, quality, description: description.trim() });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{isDiagram ? "Draw a Mermaid diagram" : "Create an Archify diagram"}</DialogTitle>
          <DialogDescription>
            {isDiagram
              ? "The diagram opens as a new file. Your open document is not changed."
              : "Archify checks the diagram before you can save it. A rejected draft is repaired automatically, up to three attempts."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {isDiagram ? (
            <div className="space-y-1.5">
              <Label htmlFor="param-mermaid">Diagram type</Label>
              <select id="param-mermaid" value={mermaidType} onChange={(e) => setMermaidType(e.target.value as MermaidType)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                {MERMAID_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {MERMAID_LABEL[type]}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="param-archify">Diagram type</Label>
                <select id="param-archify" value={archifyType} onChange={(e) => setArchifyType(e.target.value as ArchifyDiagramType)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                  {ARCHIFY_DIAGRAM_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {ARCHIFY_LABEL[type]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="param-quality">Quality</Label>
                <select id="param-quality" value={quality} onChange={(e) => setQuality(e.target.value as ArchifyQualityProfile)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                  {ARCHIFY_QUALITY_PROFILES.map((profile) => (
                    <option key={profile} value={profile}>
                      {profile === "showcase" ? "Showcase (strict)" : "Standard"}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="param-description">What should it show?</Label>
            <Textarea
              id="param-description"
              autoFocus
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={isDiagram ? "A user signs in, opens a workspace, edits a file and previews it." : "The web app calls an API, which checks a cache and falls back to PostgreSQL."}
              className="min-h-28 text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!ready}>
            {isDiagram ? "Draw diagram" : "Create diagram"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
