"use client";

import { useState } from "react";

import SegmentedControl from "@/components/segmentedControl/SegmentedControl";
import { toGraphModel, toScopeSegments } from "@/lib/fraudRelationshipsPresenter";
import graph from "./Relationships.module.css";
import styles from "./FraudIntelligenceView.module.css";
import useForceLayout, { GRAPH_VIEWBOX } from "./useForceLayout";
import { EmptyState, ErrorState, Skeleton, Zone } from "./Zone";

const NODE_RADIUS = 13;

/**
 * The relationship network: claims as nodes, connections as edges.
 *
 * Node colour carries claim status and nothing else. Edge meaning is carried by
 * line style rather than a second colour scale, so the two channels never
 * compete for the reader's attention. An edge connecting two claims for several
 * reasons is one line styled by its strongest reason, with all of them in its
 * tooltip.
 */
export default function RelationshipGraphSection({ data, isLoading, error, scope, onScopeChange, onOpenClaim }) {
  // The layout hook must run unconditionally, so it is called before any of the
  // early state branches below.
  const layout = useForceLayout(data?.nodes, data?.edges);
  const model = toGraphModel(data, layout);
  const [activeEdge, setActiveEdge] = useState(null);

  return (
    <Zone
      title="Claim relationship network"
      subtitle="Nodes are claims, coloured by status. Line style shows why two claims are connected."
      action={
        <SegmentedControl
          segments={toScopeSegments(data?.scopeCounts)}
          activeId={scope}
          onChange={onScopeChange}
          label="Relationship graph scope"
        />
      }
    >
      {isLoading ? (
        <Skeleton height={GRAPH_VIEWBOX.height} />
      ) : error ? (
        <ErrorState message={`Couldn't load the relationship graph: ${error}`} />
      ) : !model ? (
        <EmptyState message="No claims fall into this scope yet, so there are no relationships to show." />
      ) : (
        <>
          <div className={graph.legendRow}>
            {model.statusLegend.map((entry) => (
              <span key={entry.status} className={styles.finLegendItem}>
                <span className={`${graph.statusDot} ${graph[entry.tone]}`} />
                {entry.label}
              </span>
            ))}
            {/* Separated from the status keys: these describe the lines, not
                the circles, and merging the two reads as one legend. */}
            {model.edgeLegend.map((entry) => (
              <span key={entry.type} className={styles.finLegendItem}>
                <svg className={graph.legendLine} viewBox="0 0 18 2" aria-hidden="true">
                  <line
                    x1="0"
                    y1="1"
                    x2="18"
                    y2="1"
                    strokeDasharray={entry.dash || undefined}
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
                {entry.label}
              </span>
            ))}
          </div>

          <svg
            className={graph.graphSvg}
            viewBox={`0 0 ${GRAPH_VIEWBOX.width} ${GRAPH_VIEWBOX.height}`}
            role="img"
            aria-label={`${model.nodes.length} claims, ${model.edges.length} connections, ${model.connectedCount} claims connected to at least one other.`}
          >
            {/* Edges first so nodes sit on top of them. */}
            <g>
              {model.edges.map((edge) => (
                <line
                  key={edge.id}
                  x1={edge.from.x}
                  y1={edge.from.y}
                  x2={edge.to.x}
                  y2={edge.to.y}
                  className={`${graph.edge} ${activeEdge === edge.id ? graph.edgeActive : ""}`}
                  strokeDasharray={edge.style.dash || undefined}
                  vectorEffect="non-scaling-stroke"
                  onMouseEnter={() => setActiveEdge(edge.id)}
                  onMouseLeave={() => setActiveEdge(null)}
                >
                  {/* Native SVG tooltip: every reason connecting the pair, one
                      per line. No custom overlay to position or dismiss. */}
                  <title>{`${edge.source} ↔ ${edge.target}\n${edge.tooltip}`}</title>
                </line>
              ))}
            </g>

            <g>
              {model.nodes.map((node) => (
                <g
                  key={node.claimId}
                  className={graph.nodeGroup}
                  onClick={() => onOpenClaim?.(node.claimId)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpenClaim?.(node.claimId);
                    }
                  }}
                >
                  <title>
                    {`${node.claimId} — ${node.status}${node.scoreLabel ? `, score ${node.scoreLabel}` : ", not scored"}`}
                  </title>
                  <circle
                    cx={node.position.x}
                    cy={node.position.y}
                    r={NODE_RADIUS}
                    className={`${graph.node} ${graph[node.tone]}`}
                  />
                  {/* The score inside the circle, where there is one. An
                      unscored claim shows nothing rather than a 0 it never
                      earned. */}
                  {node.scoreLabel && (
                    <text
                      x={node.position.x}
                      y={node.position.y}
                      className={`${graph.nodeScore} ${graph[`${node.tone}Text`] || ""}`}
                    >
                      {node.scoreLabel}
                    </text>
                  )}
                  <text
                    x={node.position.x}
                    y={node.position.y + NODE_RADIUS + 11}
                    className={graph.nodeLabel}
                  >
                    {node.claimId}
                  </text>
                </g>
              ))}
            </g>
          </svg>

          <p className={graph.graphFoot}>
            {model.nodes.length} claims · {model.edges.length} connections ·{" "}
            {model.nodes.length - model.connectedCount} unconnected
          </p>
        </>
      )}
    </Zone>
  );
}
