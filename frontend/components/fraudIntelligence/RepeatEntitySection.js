"use client";

import { useEffect, useState } from "react";

import Icon from "@/components/icons/Icons";
import SegmentedControl from "@/components/segmentedControl/SegmentedControl";
import { ENTITY_TYPES, entityNoun, toEntityRows } from "@/lib/fraudRelationshipsPresenter";
import graph from "./Relationships.module.css";
import { EmptyState, ErrorState, Skeleton, Zone } from "./Zone";

/**
 * Customers, repair shops and adjusters recurring across open or flagged claims.
 *
 * Deliberately independent of the pattern catalogue: an entity surfaces here
 * before there is enough evidence to justify writing a pattern for it, which is
 * the reason the lens exists.
 *
 * One row expands at a time. Collapsed rows show the three figures a manager
 * scans for; expanding reveals the claims themselves, each one clickable.
 */
export default function RepeatEntitySection({
  data,
  isLoading,
  error,
  entityType,
  onEntityTypeChange,
  onOpenClaim,
}) {
  const rows = toEntityRows(data);
  const [expanded, setExpanded] = useState(null);

  // Switching entity type loads a different set of entities, so an id expanded
  // under the previous type would either match nothing or, worse, match an
  // unrelated row.
  useEffect(() => setExpanded(null), [entityType]);

  return (
    <Zone
      title="Repeat entity analysis"
      subtitle="Entities appearing across several flagged or open claims — independent of any single fraud pattern."
      action={
        <SegmentedControl
          segments={ENTITY_TYPES}
          activeId={entityType}
          onChange={onEntityTypeChange}
          label="Repeat entity type"
        />
      }
    >
      {isLoading ? (
        <Skeleton height={132} />
      ) : error ? (
        <ErrorState message={`Couldn't load repeat entities: ${error}`} />
      ) : !rows ? (
        <EmptyState
          message={`No repeat ${entityNoun(entityType)}s meet the two-claim minimum yet.`}
        />
      ) : (
        <ul className={graph.entityList}>
          {rows.map((entity) => {
            const isOpen = expanded === entity.entityValue;
            return (
              <li key={entity.entityValue} className={graph.entityRow}>
                <button
                  type="button"
                  className={graph.entityHead}
                  aria-expanded={isOpen}
                  onClick={() => setExpanded(isOpen ? null : entity.entityValue)}
                >
                  {/* chevronDown rotated, rather than a second icon: the
                      disclosure state is the rotation. */}
                  <span className={`${graph.caret} ${isOpen ? graph.caretOpen : ""}`}>
                    <Icon name="chevronDown" size={12} />
                  </span>

                  <span className={graph.entityName}>
                    {entity.label}
                    {entity.subLabel && (
                      <span className={graph.entitySubLabel}>{entity.subLabel}</span>
                    )}
                  </span>

                  <span className={graph.entityStat}>
                    <span className={graph.entityStatValue}>{entity.claimCount}</span>
                    <span className={graph.entityStatLabel}>claims</span>
                  </span>
                  <span className={graph.entityStat}>
                    {/* A 0% rate is a real result — repeat claims nobody has
                        confirmed — and is shown like any other. */}
                    <span className={graph.entityStatValue}>{entity.confirmedRateLabel}</span>
                    <span className={graph.entityStatLabel}>confirmed</span>
                  </span>
                </button>

                {isOpen && (
                  <div className={graph.chipRow}>
                    {entity.claimIds.map((claimId) => (
                      <button
                        key={claimId}
                        type="button"
                        className={graph.claimChip}
                        onClick={() => onOpenClaim?.(claimId)}
                      >
                        {claimId}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Zone>
  );
}
