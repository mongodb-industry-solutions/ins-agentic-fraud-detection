"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { closeClaim, getAuditTrail, getClaim, getLinkedClaims, updateClaim } from "@/lib/api/claims";
import {
  toAuditTimeline,
  toClaimHeader,
  toClaimTabs,
  toCustomerTab,
  toLinkedClaims,
  toOverviewSections,
  toPolicyTab,
} from "@/lib/claimDetailPresenter";
import { STATUS } from "@/lib/claimsPresenter";
import { toDemoClaimDetail } from "@/lib/const/demoClaimDetail";

/**
 * All state for one claim's view. The detail document is fetched once when the
 * screen opens; tab switching never refetches, it only changes which slice of
 * this response renders.
 */
export default function useClaimView(claimId) {
  const [detail, setDetail] = useState(null);
  const [linked, setLinked] = useState(null);
  const [audit, setAudit] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const [activeTab, setActiveTab] = useState("overview");
  const [isEditing, setIsEditing] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [closeConflict, setCloseConflict] = useState(false);

  const load = useCallback(
    async (signal) => {
      setIsLoading(true);
      try {
        const [claim, linkedResponse, auditResponse] = await Promise.all([
          getClaim(claimId),
          getLinkedClaims(claimId),
          getAuditTrail(claimId),
        ]);
        if (signal?.aborted) return;
        setDetail(claim);
        setLinked(linkedResponse);
        setAudit(auditResponse);
      } catch {
        if (signal?.aborted) return;
        const demo = toDemoClaimDetail(claimId);
        setDetail(demo.claim);
        setLinked(demo.linked);
        setAudit(demo.audit);
      } finally {
        if (!signal?.aborted) setIsLoading(false);
      }
    },
    [claimId]
  );

  // Drilling from one claim to another resets the view rather than carrying the
  // previous claim's tab, edit state or conflict banner across.
  useEffect(() => {
    const controller = new AbortController();
    setActiveTab("overview");
    setIsEditing(false);
    setDrafts({});
    setCloseConflict(false);
    load(controller.signal);
    return () => controller.abort();
  }, [claimId, load]);

  const header = useMemo(() => (detail ? toClaimHeader(detail) : null), [detail]);
  const overviewSections = useMemo(() => (detail ? toOverviewSections(detail) : []), [detail]);
  const policy = useMemo(() => (detail ? toPolicyTab(detail) : null), [detail]);
  const customer = useMemo(() => (detail ? toCustomerTab(detail) : null), [detail]);
  const linkedClaims = useMemo(() => toLinkedClaims(linked), [linked]);
  const auditEntries = useMemo(() => toAuditTimeline(audit), [audit]);
  const tabs = useMemo(() => toClaimTabs(linkedClaims.length), [linkedClaims.length]);

  const startEditing = useCallback(() => setIsEditing(true), []);

  const cancelEditing = useCallback(() => {
    setIsEditing(false);
    setDrafts({});
  }, []);

  const changeDraft = useCallback((field, value) => {
    setDrafts((current) => ({ ...current, [field]: value }));
  }, []);

  const save = useCallback(async () => {
    if (Object.keys(drafts).length === 0) {
      cancelEditing();
      return;
    }
    try {
      await updateClaim(claimId, drafts);
      await load();
    } catch {
      // No backend in demo mode: merge the edit locally so the saved value is
      // what the grid shows afterwards.
      setDetail((current) => (current ? { ...current, ...drafts } : current));
    } finally {
      setIsEditing(false);
      setDrafts({});
    }
  }, [claimId, drafts, load, cancelEditing]);

  const requestClose = useCallback(async () => {
    try {
      await closeClaim(claimId);
      setCloseConflict(false);
      await load();
    } catch (error) {
      // 409 is the real backend answer for "scored but still undecided". With
      // no backend reachable, fall back to evaluating that same condition
      // locally so the banner reflects the claim's actual state either way.
      const isPendingDecision = header?.statusKey === STATUS.PENDING;
      if (error.status === 409 || isPendingDecision) {
        setCloseConflict(true);
      }
    }
  }, [claimId, load, header]);

  return {
    isLoading,
    header,
    tabs,
    activeTab,
    setActiveTab,
    overviewSections,
    policy,
    customer,
    linkedClaims,
    auditEntries,
    isEditing,
    drafts,
    startEditing,
    cancelEditing,
    changeDraft,
    save,
    closeConflict,
    requestClose,
  };
}
