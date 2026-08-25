"use client";

import { useMemo } from "react";

/**
 * A settled force-directed layout for the relationship graph.
 *
 * Written here rather than pulled from d3-force, which is not a dependency of
 * this project (there is no d3 package installed at all). For a graph capped at
 * a few dozen nodes the three forces that matter are a short read, and adding
 * four transitive packages to run 300 iterations of them was the worse trade.
 * If this ever needs quadtree approximation, collision handling or a live
 * draggable simulation, that is the point to bring d3-force in.
 *
 * Deliberately deterministic. Nodes start on a circle ordered by id, never from
 * `Math.random()`, so the same graph always lays out identically — the same
 * claim sits in the same place when you switch scope and come back, and nothing
 * in this app is allowed to invent data, including positions.
 *
 * The simulation runs to completion in a `useMemo` and returns final
 * coordinates. It is not animated: a settled layout is what is being drawn, and
 * an animated one would mean a render loop for no additional information.
 */

const ITERATIONS = 320;
// Repulsion between every pair, so disconnected nodes still spread out.
const REPULSION = 5200;
// How hard an edge pulls its two claims together.
const ATTRACTION = 0.012;
// The resting length of an edge, in the same units as the layout box.
const IDEAL_EDGE_LENGTH = 90;
// A weak pull toward the middle, which is what stops disconnected components
// from drifting apart indefinitely under pure repulsion.
const CENTERING = 0.014;
// Displacement is scaled by this each step so the layout converges instead of
// oscillating around its solution.
const COOLING = 0.985;
// Guards the division when two nodes land on top of each other.
const MIN_DISTANCE = 0.01;

const WIDTH = 700;
const HEIGHT = 320;
// Keeps whole node circles and their labels inside the viewBox after scaling.
const PADDING = 34;

export default function useForceLayout(nodes, edges) {
  return useMemo(() => computeLayout(nodes, edges), [nodes, edges]);
}

/** Exported for the layout checks in scripts/check-force-layout.mjs. */
export function computeLayout(nodes, edges) {
  const claimIds = (nodes || []).map((node) => node.claimId);
  if (claimIds.length === 0) return {};

  // One node cannot be laid out by forces — there is nothing to push against.
  if (claimIds.length === 1) {
    return { [claimIds[0]]: { x: WIDTH / 2, y: HEIGHT / 2 } };
  }

  const index = new Map(claimIds.map((id, position) => [id, position]));

  // Sorted so the starting ring depends only on which claims are present, not
  // on the order the API happened to return them in.
  const ordered = [...claimIds].sort();
  const radius = Math.min(WIDTH, HEIGHT) / 2.6;
  const points = new Array(claimIds.length);

  ordered.forEach((id, ring) => {
    const angle = (ring / ordered.length) * Math.PI * 2;
    points[index.get(id)] = {
      x: WIDTH / 2 + Math.cos(angle) * radius,
      y: HEIGHT / 2 + Math.sin(angle) * radius,
    };
  });

  // Only edges whose endpoints are both present can pull on anything.
  const links = (edges || [])
    .map((edge) => [index.get(edge.source), index.get(edge.target)])
    .filter(([source, target]) => source !== undefined && target !== undefined);

  let alpha = 1;

  for (let step = 0; step < ITERATIONS; step += 1) {
    const forces = points.map(() => ({ x: 0, y: 0 }));

    // Pairwise repulsion. O(n²), which at a 200-node ceiling is ~20k pairs per
    // step — cheap enough to do exactly rather than approximate.
    for (let a = 0; a < points.length; a += 1) {
      for (let b = a + 1; b < points.length; b += 1) {
        let dx = points[a].x - points[b].x;
        let dy = points[a].y - points[b].y;
        let distanceSquared = dx * dx + dy * dy;

        if (distanceSquared < MIN_DISTANCE) {
          // Coincident nodes have no direction to separate along, so they are
          // nudged apart deterministically by index rather than randomly.
          dx = (a - b) * 0.01 || 0.01;
          dy = 0.01;
          distanceSquared = dx * dx + dy * dy;
        }

        const distance = Math.sqrt(distanceSquared);
        const push = REPULSION / distanceSquared;
        const ux = dx / distance;
        const uy = dy / distance;

        forces[a].x += ux * push;
        forces[a].y += uy * push;
        forces[b].x -= ux * push;
        forces[b].y -= uy * push;
      }
    }

    // Edge attraction, proportional to how far past its resting length the
    // edge is stretched.
    links.forEach(([source, target]) => {
      const dx = points[target].x - points[source].x;
      const dy = points[target].y - points[source].y;
      const distance = Math.sqrt(dx * dx + dy * dy) || MIN_DISTANCE;
      const pull = (distance - IDEAL_EDGE_LENGTH) * ATTRACTION;
      const ux = (dx / distance) * pull;
      const uy = (dy / distance) * pull;

      forces[source].x += ux;
      forces[source].y += uy;
      forces[target].x -= ux;
      forces[target].y -= uy;
    });

    points.forEach((point, position) => {
      forces[position].x += (WIDTH / 2 - point.x) * CENTERING;
      forces[position].y += (HEIGHT / 2 - point.y) * CENTERING;
      point.x += forces[position].x * alpha;
      point.y += forces[position].y * alpha;
    });

    alpha *= COOLING;
  }

  return fitToBox(claimIds, points);
}

/**
 * Scales the settled layout into the viewBox.
 *
 * Both axes use one shared scale factor rather than being stretched
 * independently: distance is the only thing this diagram means, so squashing one
 * axis would misreport how closely two claims are related.
 */
function fitToBox(claimIds, points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const scale = Math.min((WIDTH - PADDING * 2) / spanX, (HEIGHT - PADDING * 2) / spanY);

  // Re-centred after scaling, so a layout narrower than the box sits in the
  // middle instead of hugging the left edge.
  const offsetX = (WIDTH - spanX * scale) / 2;
  const offsetY = (HEIGHT - spanY * scale) / 2;

  const layout = {};
  claimIds.forEach((id, position) => {
    layout[id] = {
      x: offsetX + (points[position].x - minX) * scale,
      y: offsetY + (points[position].y - minY) * scale,
    };
  });
  return layout;
}

export const GRAPH_VIEWBOX = { width: WIDTH, height: HEIGHT };
