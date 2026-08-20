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
import { toUpdatePayload } from "@/lib/const/claimFields";
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
  const [closeError, setCloseError] = useState(null);
  const [saveError, setSaveError] = useState(null);

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
    setCloseError(null);
    setSaveError(null);
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
      // 502 is this app's proxy reporting the backend unreachable: merge
      // locally so the demo shows the saved value.
      if (error.status === 502 || !error.status) {
        setDetail((current) => (current ? { ...current, ...changed } : current));
        setIsEditing(false);
        setDrafts({});
        return;
      }
      // A real refusal (422 whitelist violation, 404, ...) keeps edit mode open
      // with the drafts intact so the values aren't silently lost.
      setSaveError(error.message);
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

      // 502 is this app's own proxy reporting the backend unreachable, so fall
      // back to demo behaviour: apply the backend's own guard locally, and
      // otherwise mark the claim closed so the gated actions can be seen.
      if (error.status === 502 || !error.status) {
        if (header?.statusKey === STATUS.PENDING) {
          setCloseConflict(true);
        } else {
          setDetail((current) =>
            current
              ? { ...current, claimStatus: "CLOSED", closedAt: new Date().toISOString() }
              : current
          );
        }
        return;
      }

      // Any other status is a real backend refusal and gets stated as one.
      setCloseError(error.message);
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
    saveError,
    closeConflict,
    closeError,
    requestClose,
  };
}
