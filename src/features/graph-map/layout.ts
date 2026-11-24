import dagre from "@dagrejs/dagre";
import type { GraphEdge, GraphNode } from "@/types/contracts";

export interface NodePosition {
  x: number;
  y: number;
}

const NODE_WIDTH = 216;
const NODE_HEIGHT = 76;

/**
 * Compute deterministic Dagre coordinates for concept nodes, safely handling
 * isolated (degree-0) nodes, self-loops, and cycles without overlapping.
 */
export function computeDagreLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  direction: "LR" | "TB" = "LR"
): Record<string, NodePosition> {
  if (nodes.length === 0) return {};

  const connectedIds = new Set<string>();
  const validNodeIds = new Set(nodes.map((n) => n.variable_id));

  for (const edge of edges) {
    if (
      edge.source_variable_id !== edge.target_variable_id &&
      validNodeIds.has(edge.source_variable_id) &&
      validNodeIds.has(edge.target_variable_id)
    ) {
      connectedIds.add(edge.source_variable_id);
      connectedIds.add(edge.target_variable_id);
    }
  }

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: 56,
    ranksep: 96,
    marginx: 32,
    marginy: 32,
  });

  for (const node of nodes) {
    if (connectedIds.has(node.variable_id)) {
      g.setNode(node.variable_id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    }
  }

  for (const edge of edges) {
    if (
      edge.source_variable_id !== edge.target_variable_id &&
      connectedIds.has(edge.source_variable_id) &&
      connectedIds.has(edge.target_variable_id)
    ) {
      g.setEdge(edge.source_variable_id, edge.target_variable_id);
    }
  }

  const positions: Record<string, NodePosition> = {};
  let maxY = 0;

  if (connectedIds.size > 0) {
    dagre.layout(g);
    for (const vid of connectedIds) {
      const laid = g.node(vid);
      if (laid && Number.isFinite(laid.x) && Number.isFinite(laid.y)) {
        const pos = {
          x: Math.round(laid.x - NODE_WIDTH / 2),
          y: Math.round(laid.y - NODE_HEIGHT / 2),
        };
        positions[vid] = pos;
        if (pos.y + NODE_HEIGHT > maxY) {
          maxY = pos.y + NODE_HEIGHT;
        }
      }
    }
  }

  // İzole (bağlantısız) düğümleri düzenli alt ızgaraya yerleştir
  const isolated = nodes.filter((n) => !positions[n.variable_id]);
  const startY = connectedIds.size > 0 ? maxY + 64 : 32;
  const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(isolated.length))));
  isolated.forEach((node, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    positions[node.variable_id] = {
      x: 32 + col * (NODE_WIDTH + 40),
      y: startY + row * (NODE_HEIGHT + 36),
    };
  });

  return positions;
}
