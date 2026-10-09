"use client";

import { useMemo, useState } from "react";

import SegmentedControl from "@/components/segmentedControl/SegmentedControl";
import {
  toGraphModel,
  toGraphSummary,
  toScopeSegments,
} from "@/lib/fraudRelationshipsPresenter";
import graph from "./Relationships.module.css";
import useForceLayout, { GRAPH_VIEWBOX } from "./useForceLayout";
import { EmptyState, ErrorState, Skeleton, Zone } from "./Zone";

/**
 * The relationship network: claims as nodes, connections as edges.
 *
 * Node fill carries claim status and its size carries the fraud score; the
 * connection type is carried by line pattern and colour. Nothing is drawn
 * louder than it needs to be at rest — lines sit back until you point at a claim
 * or a connection, which brings its neighbourhood forward and fades the rest.
 *
 * The three connection types can be switched off from the legend. The layout is
 * computed once over every connection, so hiding one never moves a claim.
 */
export default function RelationshipGraphSection({
  data,
  isLoading,
  error,
  scope,
  onScopeChange,
  onOpenClaim,
}) {
  // The layout hook must run unconditionally, so it is called before any of the
  // early state branches below.
  const layout = useForceLayout(data?.nodes, data?.edges);
  const model = toGraphModel(data, layout);

  // What the pointer is over: {kind: "node" | "edge", id}, or null.
  const [focus, setFocus] = useState(null);
  const [hiddenTypes, setHiddenTypes] = useState(() => new Set());

  const visibleEdges = useMemo(
    () => (model ? model.edges.filter((edge) => !hiddenTypes.has(edge.type)) : []),
    [model, hiddenTypes]
  );
  const summary = useMemo(
    () => (model ? toGraphSummary(model.nodes, visibleEdges) : null),
    [model, visibleEdges]
  );

  const toggleType = (type) =>
    setHiddenTypes((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  // The claims that stay at full strength while something is focused.
  const litNodes = useMemo(() => {
    if (!focus || !model) return null;
    if (focus.kind === "edge") {
      const edge = visibleEdges.find((candidate) => candidate.id === focus.id);
      return edge ? new Set([edge.source, edge.target]) : null;
    }
    const set = new Set([focus.id]);
    visibleEdges.forEach((edge) => {
      if (edge.source === focus.id) set.add(edge.target);
      if (edge.target === focus.id) set.add(edge.source);
    });
    return set;
  }, [focus, model, visibleEdges]);

  const isEdgeLit = (edge) => {
    if (!focus) return false;
    if (focus.kind === "edge") return edge.id === focus.id;
    return edge.source === focus.id || edge.target === focus.id;
  };

  const focusedNode = focus?.kind === "node" ? model?.nodes.find((n) => n.claimId === focus.id) : null;
  const focusedEdge =
    focus?.kind === "edge" ? visibleEdges.find((edge) => edge.id === focus.id) : null;

  return (
    <Zone
      title="Claim relationship network"
      subtitle="Size shows the fraud score, colour shows the claim's status. Point at a claim or a line to see how it connects."
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
            <div className={graph.legendGroup}>
              {model.statusLegend.map((entry) => (
                <span key={entry.status} className={graph.legendItem}>
                  <span className={`${graph.statusDot} ${graph[entry.tone]}`} />
                  {entry.label}
                </span>
              ))}
            </div>

            {/* Separated from the status keys: these describe the lines, not the
                circles — and unlike them, they are controls. */}
            <div className={graph.legendGroup}>
              {model.edgeLegend.map((entry) => {
                const isHidden = hiddenTypes.has(entry.type);
                return (
                  <button
                    key={entry.type}
                    type="button"
                    className={`${graph.edgeToggle} ${isHidden ? graph.edgeToggleOff : ""}`}
                    aria-pressed={!isHidden}
                    onClick={() => toggleType(entry.type)}
                    title={isHidden ? `Show ${entry.label.toLowerCase()}` : `Hide ${entry.label.toLowerCase()}`}
                  >
                    <svg className={`${graph.legendLine} ${graph[entry.tone]}`} viewBox="0 0 18 2" aria-hidden="true">
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
                    <span className={graph.edgeCount}>{entry.count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className={graph.canvas}>
            <svg
              // Remounted per scope so the claims draw in again on a switch.
              key={scope}
              className={graph.graphSvg}
              viewBox={`0 0 ${GRAPH_VIEWBOX.width} ${GRAPH_VIEWBOX.height}`}
              role="img"
              aria-label={`${summary.claims} claims, ${summary.connections} connections, ${summary.claims - summary.unconnected} claims connected to at least one other.`}
              onMouseLeave={() => setFocus(null)}
            >
              <defs>
                {/* A soft glow behind flagged claims, so the ones that matter
                    most are the first thing the eye lands on. */}
                <filter id="flaggedGlow" x="-60%" y="-60%" width="220%" height="220%">
                  <feGaussianBlur stdDeviation="4" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Edges first so nodes sit on top of them. */}
              <g className={graph.edges}>
                {visibleEdges.map((edge) => {
                  const lit = isEdgeLit(edge);
                  const dim = focus && !lit;
                  return (
                    <g key={edge.id}>
                      <line
                        x1={edge.from.x}
                        y1={edge.from.y}
                        x2={edge.to.x}
                        y2={edge.to.y}
                        className={`${graph.edge} ${graph[edge.style.tone]} ${lit ? graph.edgeLit : ""} ${dim ? graph.edgeDim : ""}`}
                        strokeWidth={lit ? edge.width + 1.2 : edge.width}
                        strokeDasharray={edge.style.dash || undefined}
                        vectorEffect="non-scaling-stroke"
                      />
                      {/* A wide invisible stroke on top: the visible line is
                          1-2px, far too thin to point at reliably. */}
                      <line
                        x1={edge.from.x}
                        y1={edge.from.y}
                        x2={edge.to.x}
                        y2={edge.to.y}
                        className={graph.edgeHit}
                        onMouseEnter={() => setFocus({ kind: "edge", id: edge.id })}
                        onMouseLeave={() => setFocus(null)}
                      >
                        <title>{`${edge.source} ↔ ${edge.target}\n${edge.tooltip}`}</title>
                      </line>
                    </g>
                  );
                })}
              </g>

              <g>
                {model.nodes.map((node, order) => {
                  const dim = litNodes && !litNodes.has(node.claimId);
                  const isFocused = focus?.kind === "node" && focus.id === node.claimId;
                  return (
                    <g
                      key={node.claimId}
                      className={`${graph.nodeGroup} ${dim ? graph.nodeDim : ""}`}
                      style={{ "--order": order }}
                      onMouseEnter={() => setFocus({ kind: "node", id: node.claimId })}
                      onMouseLeave={() => setFocus(null)}
                      onFocus={() => setFocus({ kind: "node", id: node.claimId })}
                      onBlur={() => setFocus(null)}
                      onClick={() => onOpenClaim?.(node.claimId)}
                      role="button"
                      tabIndex={0}
                      aria-label={`${node.claimId}, ${node.statusLabel}${node.scoreLabel ? `, score ${node.scoreLabel}` : ", not scored"}. Open claim.`}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onOpenClaim?.(node.claimId);
                        }
                      }}
                    >
                      {/* The ring that appears around the claim under the pointer. */}
                      <circle
                        cx={node.position.x}
                        cy={node.position.y}
                        r={node.radius + 6}
                        className={`${graph.halo} ${isFocused ? graph.haloOn : ""}`}
                      />
                      <circle
                        cx={node.position.x}
                        cy={node.position.y}
                        r={node.radius}
                        className={`${graph.node} ${graph[node.tone]}`}
                        filter={node.status === "flagged" ? "url(#flaggedGlow)" : undefined}
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
                        y={node.position.y + node.radius + 12}
                        className={`${graph.nodeLabel} ${isFocused ? graph.nodeLabelOn : ""}`}
                      >
                        {node.claimId}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>

            {/* What the pointer is over, spelled out. */}
            <aside className={graph.detail} aria-live="polite">
              {focusedNode ? (
                <>
                  <span className={graph.detailKicker}>Claim</span>
                  <span className={graph.detailTitle}>{focusedNode.claimId}</span>
                  <span className={graph.detailRow}>
                    <span className={`${graph.statusDot} ${graph[focusedNode.tone]}`} />
                    {focusedNode.statusLabel}
                  </span>
                  <span className={graph.detailRow}>
                    {focusedNode.scoreLabel
                      ? `Fraud score ${focusedNode.scoreLabel} / 12`
                      : "Not scored yet"}
                  </span>
                  <span className={graph.detailRow}>
                    {litNodes.size - 1} connected claim{litNodes.size - 1 === 1 ? "" : "s"}
                  </span>
                  <span className={graph.detailHint}>Click to open the claim</span>
                </>
              ) : focusedEdge ? (
                <>
                  <span className={graph.detailKicker}>Connection</span>
                  <span className={graph.detailTitle}>
                    {focusedEdge.source} ↔ {focusedEdge.target}
                  </span>
                  <ul className={graph.detailReasons}>
                    {focusedEdge.reasonLabels.map((label) => (
                      <li key={label}>{label}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  <span className={graph.detailKicker}>Explore</span>
                  <span className={graph.detailHint}>
                    Point at a claim to light up everything it touches, or at a line to see why
                    two claims are linked.
                  </span>
                </>
              )}
            </aside>
          </div>

          <div className={graph.footer}>
            <span className={graph.footStat}>
              <span className={graph.footValue}>{summary.claims}</span> claims
            </span>
            <span className={graph.footStat}>
              <span className={graph.footValue}>{summary.connections}</span> connections
            </span>
            <span className={graph.footStat}>
              <span className={graph.footValue}>{summary.unconnected}</span> unconnected
            </span>
            {summary.hub && (
              <span className={graph.footStat}>
                Most connected{" "}
                <button
                  type="button"
                  className={graph.footLink}
                  onClick={() => onOpenClaim?.(summary.hub.claimId)}
                >
                  {summary.hub.claimId}
                </button>{" "}
                <span className={graph.footValue}>({summary.hub.count})</span>
              </span>
            )}
          </div>
        </>
      )}
    </Zone>
  );
}
