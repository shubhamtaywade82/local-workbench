// One verified Archify document per diagram type. The archify prompt shows the
// model a document that is known to render, which grounds it better than the
// JSON schema alone. These are the upstream examples used by the render tests.

import type { ArchifyDiagramType } from "@/lib/archify/contract";
import architecture from "@/lib/archify/fixtures/web-app.architecture.json";
import workflow from "@/lib/archify/fixtures/agent-tool-call.workflow.json";
import sequence from "@/lib/archify/fixtures/async-job-roundtrip.sequence.json";
import dataflow from "@/lib/archify/fixtures/event-stream.dataflow.json";
import lifecycle from "@/lib/archify/fixtures/deployment-release.lifecycle.json";
import erd from "@/lib/archify/fixtures/orders.erd.json";
import tree from "@/lib/archify/fixtures/archify-repository.tree.json";
import classDiagram from "@/lib/archify/fixtures/payments.class.json";
import timeline from "@/lib/archify/fixtures/archify-dev-activity.timeline.json";
import waterfall from "@/lib/archify/fixtures/checkout-request.waterfall.json";

export const ARCHIFY_EXAMPLES: Readonly<Record<ArchifyDiagramType, unknown>> = {
  architecture,
  workflow,
  sequence,
  dataflow,
  lifecycle,
  erd,
  tree,
  class: classDiagram,
  timeline,
  waterfall,
};
