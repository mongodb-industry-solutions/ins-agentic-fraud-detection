/**
 * Shapes the Relationships tab's three API responses for rendering.
 *
 * Every value traces back to a real response field. Nothing here invents a
 * count, a name or a position, and a missing field becomes null so the
 * component shows its own empty state.
 */

/** Scope options for the graph and the leaderboard, which share one scope. */
export const GRAPH_SCOPES = [
  { id: "ALL", label: "All" },
  { id: "FLAGGED", label: "Flagged" },
  { id: "PENDING", label: "Pending" },
];

export const ENTITY_TYPES = [
  { id: "customer", label: "Customer" },
  { id: "repairShop", label: "Repair shop" },
  { id: "adjuster", label: "Adjuster" },
];

/** Singular nouns for the entity empty states. */
const ENTITY_NOUN = {
  customer: "customer",
  repairShop: "repair shop",
  adjuster: "adjuster",
};

export function entityNoun(entityType) {
  return ENTITY_NOUN[entityType] || "entity";
}

/**
 * Scope segments labelled with the candidate count for each, from the
 * response's own `scopeCounts`.
 *
 * The counts describe how many claims each scope *considers*, which is not the
 * same as how many nodes the current scope drew — an unconnected claim is still
 * a candidate and still a node. They come from the backend rather than being
 * counted off the returned nodes, because two of the three scopes are not the
 * one currently loaded and their node lists are not in hand.
 */
export function toScopeSegments(scopeCounts) {
  return GRAPH_SCOPES.map((scope) => ({
    id: scope.id,
    label: scope.label,
    count: scopeCounts?.[scope.id] ?? undefined,
  }));
}

/**
 * Line style per edge type. Style, not colour: node fill is already fully
 * committed to claim status, so a second colour system on the edges would
 * compete with it and double the legend. Stroke pattern is a free channel.
 */
export const EDGE_STYLE = {
  SHARED_PATTERN: { id: "solid", label: "Shared fraud pattern", dash: null },
  SAME_CUSTOMER: { id: "dashed", label: "Same customer", dash: "6 4" },
  SAME_REPAIR_SHOP: { id: "dotted", label: "Same repair shop", dash: "2 4" },
};

export const EDGE_LEGEND = Object.entries(EDGE_STYLE).map(([type, style]) => ({
  type,
  ...style,
}));

/** Node fill classes, keyed by the status the backend resolved. */
export const NODE_STATUS = {
  flagged: { label: "Flagged as fraud", tone: "nodeFlagged" },
  pending: { label: "Pending review", tone: "nodePending" },
  cleared: { label: "Cleared", tone: "nodeCleared" },
  unprocessed: { label: "Not yet analyzed", tone: "nodeUnprocessed" },
};

/**
 * Graph nodes and edges positioned for drawing.
 *
 * Edges are resolved to coordinates here and any edge with a missing endpoint
 * is dropped: an edge drawn to a node that was not rendered would be a line
 * running to nowhere. `layout` comes from useForceLayout.
 *
 * Returns null when there is nothing to draw, so the caller can tell "empty"
 * from "loaded" without inspecting array lengths itself.
 */
export function toGraphModel(data, layout) {
  const nodes = data?.nodes || [];
  if (nodes.length === 0) return null;

  const positioned = nodes
    .map((node) => ({
      ...node,
      position: layout?.[node.claimId],
      // Falls back to the muted treatment rather than rendering an uncoloured
      // circle if the backend ever sends a status this build does not know.
      tone: (NODE_STATUS[node.status] || NODE_STATUS.unprocessed).tone,
      scoreLabel:
        typeof node.computedScore === "number" ? String(Math.round(node.computedScore)) : null,
    }))
    .filter((node) => node.position);

  const known = new Set(positioned.map((node) => node.claimId));

  const edges = (data?.edges || [])
    .filter((edge) => known.has(edge.source) && known.has(edge.target))
    .map((edge) => ({
      ...edge,
      id: `${edge.source}--${edge.target}`,
      style: EDGE_STYLE[edge.type] || EDGE_STYLE.SHARED_PATTERN,
      from: layout[edge.source],
      to: layout[edge.target],
      // Every reason, for the tooltip — the line itself can only express one.
      tooltip: (edge.reasons || []).map((reason) => reason.label).join("\n"),
    }));

  // Which statuses are actually present, so the legend does not advertise a
  // status this graph contains none of.
  const statuses = [];
  positioned.forEach((node) => {
    if (!statuses.includes(node.status)) statuses.push(node.status);
  });

  return {
    nodes: positioned,
    edges,
    statusLegend: statuses
      .filter((status) => NODE_STATUS[status])
      .map((status) => ({ status, ...NODE_STATUS[status] })),
    // Only the edge types this graph actually drew.
    edgeLegend: EDGE_LEGEND.filter((entry) => edges.some((edge) => edge.type === entry.type)),
    connectedCount: new Set(edges.flatMap((edge) => [edge.source, edge.target])).size,
  };
}

/** Leaderboard rows, ranked in the order the API returned them. */
export function toClusterRows(data) {
  const clusters = data?.clusters || [];
  if (clusters.length === 0) return null;

  return clusters.map((cluster, position) => ({
    ...cluster,
    rank: position + 1,
    avgScoreLabel: formatScore(cluster.avgScore),
    maxScoreLabel: formatScore(cluster.maxScore),
  }));
}

function formatScore(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return value.toFixed(1);
}

/**
 * Repeat-entity rows.
 *
 * A 0% confirmed rate is a real and useful result — repeat claims that nobody
 * has confirmed yet — so it is formatted and shown like any other, never
 * hidden or suppressed.
 */
export function toEntityRows(data) {
  const entities = data?.entities || [];
  if (entities.length === 0) return null;

  return entities.map((entity) => ({
    ...entity,
    label: entity.entityLabel || entity.entityValue,
    // Shown alongside the name only when it adds something the name does not,
    // which is the customer case — a repair shop's id *is* its name.
    subLabel: entity.entityLabel && entity.entityLabel !== entity.entityValue
      ? entity.entityValue
      : null,
    confirmedRateLabel: `${Math.round((entity.confirmedRate ?? 0) * 100)}%`,
  }));
}
