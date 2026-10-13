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
import { toUpdatePayload } from "@/lib/const/claimFields";

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
  const [loadError, setLoadError] = useState(null);

  const [activeTab, setActiveTab] = useState("overview");
  const [isEditing, setIsEditing] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [closeConflict, setCloseConflict] = useState(false);
  const [closeError, setCloseError] = useState(null);
  const [saveError, setSaveError] = useState(null);

  const load = useCallback(
    async (signal) => {
      setIsLoading(true);
      setLoadError(null);
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
      } catch (error) {
        if (signal?.aborted) return;
        // Cleared rather than kept: another claim's data under this claim's id
        // would misrepresent it.
        setDetail(null);
        setLinked(null);
        setAudit(null);
        setLoadError(error.message || "Could not load this claim.");
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
    setCloseError(null);
    setSaveError(null);
    load(controller.signal);
    return () => controller.abort();
  }, [claimId, load]);

  const header = useMemo(() => (detail ? toClaimHeader(detail) : null), [detail]);
  const overviewSections = useMemo(() => (detail ? toOverviewSections(detail) : []), [detail]);
  const policy = useMemo(() => (detail ? toPolicyTab(detail) : null), [detail]);
  const customer = useMemo(() => (detail ? toCustomerTab(detail) : null), [detail]);
  // The agent's semantic precedents: the newest assessment's, falling back to
  // the copy persisted on the claim itself.
  const linkedClaims = useMemo(() => {
    const newestReview = audit?.records?.[0];
    const similar = newestReview?.similarClaims?.length
      ? newestReview.similarClaims
      : detail?.fraud?.similarClaims || [];
    return toLinkedClaims(linked, similar);
  }, [linked, audit, detail]);
  const auditEntries = useMemo(() => toAuditTimeline(audit), [audit]);
  const tabs = useMemo(() => toClaimTabs(linkedClaims.length), [linkedClaims.length]);

  const startEditing = useCallback(() => setIsEditing(true), []);

  const cancelEditing = useCallback(() => {
    setIsEditing(false);
    setDrafts({});
    setSaveError(null);
  }, []);

  const changeDraft = useCallback((field, value) => {
    setDrafts((current) => ({ ...current, [field]: value }));
  }, []);

  const save = useCallback(async () => {
    // Coerced to the backend's types (booleans, numbers) and reduced to fields
    // whose value actually differs — touching a field without changing it
    // should not appear in updatedFields.
    const payload = toUpdatePayload(drafts);
    const changed = Object.fromEntries(
      Object.entries(payload).filter(([field, value]) => value !== (detail?.[field] ?? null))
    );

    if (Object.keys(changed).length === 0) {
      cancelEditing();
      return;
    }

    setSaveError(null);
    try {
      await updateClaim(claimId, changed);
      await load();
      setIsEditing(false);
      setDrafts({});
    } catch (error) {
      // Any failure (422 whitelist violation, 404, backend unreachable) keeps
      // edit mode open with the drafts intact so the values aren't lost.
      setSaveError(error.message || "Could not save the changes.");
    }
  }, [claimId, drafts, detail, load, cancelEditing]);

  const requestClose = useCallback(async () => {
    if (header?.isClosed) return;

    try {
      await closeClaim(claimId);
      setCloseConflict(false);
      setCloseError(null);
      await load();
    } catch (error) {
      // 409 is the real backend answer for "scored but still undecided".
      if (error.status === 409) {
        setCloseConflict(true);
        return;
      }

      // Anything else (including the backend being unreachable) is stated as is.
      setCloseError(error.message || "Could not close this claim.");
    }
  }, [claimId, load, header]);

  const retry = useCallback(() => load(), [load]);

  return {
    isLoading,
    loadError,
    retry,
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
    saveError,
    closeConflict,
    closeError,
    requestClose,
  };
}
