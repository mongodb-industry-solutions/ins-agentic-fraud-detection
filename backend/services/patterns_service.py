"""The fraud-pattern catalogue: its leaderboard, its drill-down, and adding to
or editing the patterns themselves."""

from datetime import datetime, timezone
from typing import Any

from core.exceptions import NotFoundError, ValidationError
from core.serialization import to_jsonable
from repositories.claims_repo import ClaimsRepository
from repositories.patterns_repo import PatternsRepository

# The router's schema owns the enum; the service takes plain dicts like every
# other service here, so it only needs the one value it branches on.
RULE_PATTERN_TYPE = "RULE"


# Written by the decision flow and the embedding procedure, never by a caller.
# The request schema already forbids them; this repeats the check for service
# level callers (the Phase 4 agent tools) that build the dict directly.
FORBIDDEN_UPDATE_KEYS = frozenset(
    {
        "patternId",
        "patternType",
        "stats",
        "embedding",
        "embeddingText",
        "createdAt",
        # Generated from the pattern's own stats by `regenerate_why_effective`.
        # Hand-editing it would produce a sentence that contradicts the numbers
        # printed beside it, and the next regeneration would silently discard it.
        "whyEffective",
        "whyEffectiveGeneratedAt",
    }
)

# Reliability bands for the generated `whyEffective` blurb, as
# (minimum confirmedFraudRate, sentence template) in descending order. The
# thresholds are the same ones the severity guidance in the catalogue uses, so
# the prose and the severity label cannot tell a reviewer different stories.
RELIABILITY_BANDS: tuple[tuple[float, str], ...] = (
    (0.75, "Highly reliable: {confirmed} of the {triggered} claims it fired on were "
           "confirmed fraud, so a match is strong evidence on its own."),
    (0.50, "Reliable more often than not: {confirmed} of {triggered} matches were "
           "confirmed fraud, which makes it worth acting on but not conclusive alone."),
    (0.25, "A moderate signal: {confirmed} of {triggered} matches were confirmed fraud, "
           "so it earns its weight in combination with other patterns rather than by itself."),
    (0.0, "Low precision: only {confirmed} of {triggered} matches were confirmed fraud, "
          "so a match is context for a reviewer rather than evidence against the claim."),
)

# Below this, the rate is arithmetic on too few cases to describe as a track record.
MIN_TRIGGERS_FOR_RELIABILITY = 5

# Above this, the pattern is doing broad screening rather than picking out
# individual claims, which changes how a reviewer should read a match.
HIGH_VOLUME_TRIGGERS = 30


class PatternsService:
    """Orchestrates the pattern leaderboard, per-pattern detail, and writes."""

    def __init__(self, patterns_repo: PatternsRepository, claims_repo: ClaimsRepository):
        self.patterns = patterns_repo
        self.claims = claims_repo

    @staticmethod
    def _public(pattern: dict[str, Any]) -> dict[str, Any]:
        """A pattern as callers see it: the 1024-float vector replaced by the one
        fact anyone needs about it.

        The vector is machine input, useless to a client and larger than the rest
        of the document put together. But whether a pattern *has* one decides
        whether it takes part in similarity matching at all, so dropping the
        field silently would leave a caller unable to tell a freshly created
        pattern from an embedded one — hence a boolean rather than an omission.
        """
        public = {key: value for key, value in to_jsonable(pattern).items() if key != "embedding"}
        public["hasEmbedding"] = bool(pattern.get("embedding"))
        # Never null. A stored blurb is used as-is; a pattern that has not been
        # through generation yet gets one composed from its current stats, so the
        # field is always renderable and a caller never has to handle its absence.
        # `whyEffectiveGeneratedAt` is how a caller tells the two apart.
        public["whyEffective"] = (
            pattern.get("whyEffective") or PatternsService.build_why_effective(pattern)
        )
        return public

    def list_patterns(self, pattern_type: str, active: bool | None, sort: str) -> dict[str, Any]:
        patterns = [
            self._public(pattern)
            for pattern in self.patterns.list_all(
                pattern_type=pattern_type, active=active, sort=sort
            )
        ]
        return {"patterns": patterns, "total": len(patterns)}

    # -------------------------------------------------------- why-effective text

    @staticmethod
    def build_why_effective(pattern: dict[str, Any]) -> str:
        """A sentence on how much a match by this pattern is actually worth.

        Composed from the pattern's own recorded stats by template rather than
        written by a model. Three reasons: the output has to stay consistent with
        the `confirmedFraudRate` displayed next to it, regenerating the whole
        catalogue has to be cheap enough to run on a schedule, and a claim about
        a rule's reliability is not something worth letting a model improvise.

        The wording is therefore a function of the stats alone — the same stats
        always produce the same sentence, which is what makes it safe to
        regenerate whenever `confirmedFraudRate` shifts.
        """
        stats = pattern.get("stats") or {}
        triggered = stats.get("timesTriggered") or 0
        confirmed = stats.get("confirmedCount") or 0
        rate = stats.get("confirmedFraudRate") or 0.0

        if not triggered:
            return (
                "No track record yet: this pattern has not fired on any claim, so its "
                "weight is an author's estimate rather than a measured rate."
            )

        if triggered < MIN_TRIGGERS_FOR_RELIABILITY:
            return (
                f"Too little history to judge: it has fired {triggered} time(s), "
                f"{confirmed} of which were confirmed fraud. Treat the rate as "
                "provisional until it has more matches behind it."
            )

        sentence = next(
            template for threshold, template in RELIABILITY_BANDS if rate >= threshold
        ).format(confirmed=confirmed, triggered=triggered)

        if triggered >= HIGH_VOLUME_TRIGGERS:
            sentence += (
                " It fires across a large share of the portfolio, so it works as a "
                "screen rather than as a way of singling out one claim."
            )
        return sentence

    def regenerate_why_effective(self, pattern_id: str | None = None) -> dict[str, Any]:
        """Regenerate and store the blurb for one pattern, or the whole catalogue.

        Stored rather than computed per request so the text is stable between
        regenerations: `list_fraud_patterns` is called on every dashboard load,
        and a sentence that changed under the reader the moment a single decision
        was recorded would be worse than one that is explicitly a few hours old.
        Intended to be run on a schedule, or after a batch of decisions.
        """
        if pattern_id:
            pattern = self.patterns.get_by_id(pattern_id)
            if not pattern:
                raise NotFoundError("fraud pattern", pattern_id)
            targets = [pattern]
        else:
            targets = self.patterns.list_all(pattern_type="ALL", active=None)

        generated_at = datetime.now(timezone.utc)
        results = []
        for target in targets:
            text = self.build_why_effective(target)
            # Skip the write when nothing changed: a scheduled run over an
            # unchanged catalogue should not look like activity.
            if target.get("whyEffective") == text:
                results.append({"patternId": target["patternId"], "changed": False,
                                "whyEffective": text})
                continue
            self.patterns.set_why_effective(target["patternId"], text, generated_at)
            results.append({"patternId": target["patternId"], "changed": True,
                            "whyEffective": text})

        changed = sum(1 for r in results if r["changed"])
        return {
            "generatedAt": generated_at,
            "patternsProcessed": len(results),
            "patternsChanged": changed,
            "results": results,
            "message": (
                f"Regenerated whyEffective for {len(results)} pattern(s); "
                f"{changed} changed."
            ),
        }

    def create_pattern(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Add a pattern to the catalogue.

        Two things are deliberately not done here. Stats start at zero rather
        than being inherited or estimated, because a brand-new pattern has no
        track record to report. And no embedding is generated: that is the
        embedding procedure's job, so a similarity pattern is created inert and
        the response says so — it takes no part in matching until embedded.
        """
        pattern_type = payload["patternType"]
        conditions = payload.get("conditions") or []

        document: dict[str, Any] = {
            "patternId": self.patterns.next_pattern_id(),
            "patternType": pattern_type,
            "name": payload["name"].strip(),
            "description": (payload.get("description") or "").strip(),
            "appliesTo": payload["appliesTo"],
            "severity": payload["severity"],
            "weight": payload["weight"],
            "active": payload["active"],
            "stats": {"timesTriggered": 0, "confirmedCount": 0, "confirmedFraudRate": 0.0},
            "exampleClaimIds": [],
            "createdAt": datetime.now(timezone.utc),
            "updatedAt": datetime.now(timezone.utc),
        }

        if pattern_type == RULE_PATTERN_TYPE:
            document["ruleLogic"] = self._to_rule_logic(conditions)
        else:
            document["embeddingText"] = payload["embeddingText"].strip()

        stored = self.patterns.insert_pattern(document)
        is_embedding_pending = pattern_type != RULE_PATTERN_TYPE

        return {
            "patternId": stored["patternId"],
            "created": True,
            "embeddingPending": is_embedding_pending,
            "message": (
                f"Created {stored['patternId']}."
                + (
                    " It will not be used in similarity matching until its embedding "
                    "has been generated."
                    if is_embedding_pending
                    else ""
                )
            ),
            "pattern": self._public(stored),
        }

    @staticmethod
    def _to_rule_logic(conditions: list[dict[str, Any]]) -> dict[str, Any]:
        """Store one condition flat, several under `conditions`.

        Every hand-authored rule in the catalogue is a single flat comparison
        ({field, operator, value}), so a single-condition rule created here is
        shaped identically to those and needs no special handling downstream.
        The flat shape simply cannot express an AND of several comparisons,
        which is the only case that gets the nested form.
        """
        cleaned = [
            {key: value for key, value in condition.items() if value is not None}
            for condition in conditions
        ]
        return cleaned[0] if len(cleaned) == 1 else {"conditions": cleaned}

    def update_pattern(self, pattern_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        """Apply a whitelisted partial update to one pattern.

        Retiring a pattern is a `PATCH {"active": false}`, not a delete: the
        claims it already scored still cite it, so the document has to stay
        readable for their fraud reports to keep making sense.
        """
        if not fields:
            raise ValidationError("No updatable fields were provided.")

        rejected = sorted(key for key in fields if key in FORBIDDEN_UPDATE_KEYS)
        if rejected:
            raise ValidationError(
                "These fields cannot be edited through this endpoint; reliability "
                "stats are derived from recorded decisions and embeddings are "
                "written by the embedding procedure.",
                details={"rejectedFields": rejected},
            )

        updated = self.patterns.update_fields(pattern_id, fields)
        if not updated:
            raise NotFoundError("fraud pattern", pattern_id)

        return {
            "patternId": pattern_id,
            "updated": True,
            "updatedFields": sorted(fields),
            "message": f"Updated {len(fields)} field(s) on {pattern_id}.",
            "pattern": self._public(updated),
        }

    def get_pattern_detail(self, pattern_id: str) -> dict[str, Any]:
        """The pattern plus the claims it actually fired on.

        The matched claims are a separate query rather than a $lookup: the
        pattern id sits inside each claim's `fraud.matchedPatterns` array, so
        the natural direction of the join is claims -> pattern, not the reverse.
        """
        pattern = self.patterns.get_by_id(pattern_id)
        if not pattern:
            raise NotFoundError("fraud pattern", pattern_id)

        matched = to_jsonable(self.claims.find_by_pattern(pattern_id))
        return {
            "pattern": self._public(pattern),
            "matchedClaims": matched,
            "matchedCount": len(matched),
        }
