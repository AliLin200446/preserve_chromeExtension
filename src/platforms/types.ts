export type ConnectionState =
  | "Not connected"
  | "Authentication required"
  | "Connecting"
  | "Connected"
  | "Permission denied"
  | "Unsupported feature"
  | "Connection error";
export interface PlatformCapabilities {
  browse: boolean;
  importImages: boolean;
  liveSelection: boolean;
  prepareNode: boolean;
  automaticGeneration: boolean;
}
export interface RemoteProject {
  id: string;
  name: string;
}
export interface CanvasNode {
  id: string;
  shortId?: string;
  type: string;
  label: string;
  prompt?: string;
  model?: string;
  outputUrl?: string;
  text?: string;
  assetId?: string;
  position?: { x: number; y: number };
  inputs: Record<string, unknown>;
  output: Record<string, unknown>;
}
export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}
export interface RemoteCanvas {
  projectId: string;
  url?: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}
export interface PlatformProvenance {
  platform: "FLORA";
  workspaceId: string;
  projectId: string;
  projectName: string;
  nodeId: string;
  nodeType: string;
  assetId?: string;
  generationId?: string;
  model?: string;
  prompt?: string;
  importedAt: number;
  imageHash: string;
  canvasEdges: CanvasEdge[];
  sourceNodeIds: string[];
  inputs: Record<string, unknown>;
  output: Record<string, unknown>;
}
export interface Handoff {
  workspaceId: string;
  projectId: string;
  projectName: string;
  prompt: string;
  referenceNodeId?: string;
  referenceLabel: string;
  idempotencyKey: string;
  mode: "node" | "manual";
}
export interface PlatformAdapter {
  id: string;
  capabilities: PlatformCapabilities;
  status(): Promise<ConnectionState>;
  connect(key: string): Promise<RemoteProject[]>;
  disconnect(): Promise<void>;
  workspaces(): Promise<RemoteProject[]>;
  projects(
    workspaceId: string,
    cursor?: string,
    shared?: boolean,
  ): Promise<{ projects: RemoteProject[]; cursor?: string }>;
  canvas(workspaceId: string, projectId: string): Promise<RemoteCanvas>;
  asset(assetId: string): Promise<{ url?: string; type?: string }>;
  prepare(handoff: Handoff, confirmed: boolean): Promise<unknown>;
}
