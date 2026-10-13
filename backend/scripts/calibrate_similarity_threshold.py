"""Step 7 — calibrate FRAUD_SIMILARITY_THRESHOLD against labelled data.

Each HISTORICAL_SIMILARITY pattern lists `exampleClaimIds` — claims a human associated with
that pattern. We treat (pattern, its example claim) as a POSITIVE pair and every other
(pattern, claim) as a NEGATIVE pair. For each referenced claim we embed its description
(input_type="query") and run the real Atlas vector search, then look at how well cosine
similarity separates positives from negatives and recommend a threshold.

Read-only: it embeds claims and queries the index, but writes nothing.

    uv run python scripts/calibrate_similarity_threshold.py
"""

import os
import sys

from dotenv import load_dotenv
from pymongo import MongoClient

# Repointed from the original repo's package path to this repo's flat `voyage/` folder.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from voyage import get_embedding  # noqa: E402

load_dotenv(os.path.join(os.getcwd(), ".env"))

VECTOR_INDEX_NAME = os.environ.get("FRAUD_PATTERN_VECTOR_INDEX", "fraud_pattern_vector_index")


def _vector_scores(col, query_vec):
    """Return {patternId: similarity} for all HISTORICAL_SIMILARITY patterns vs query_vec."""
    pipeline = [
        {"$vectorSearch": {
            "index": VECTOR_INDEX_NAME, "path": "embedding",
            "queryVector": query_vec, "numCandidates": 200, "limit": 50,
        }},
        {"$match": {"patternType": "HISTORICAL_SIMILARITY", "active": True}},
        {"$addFields": {"similarity": {"$meta": "vectorSearchScore"}}},
        {"$project": {"_id": 0, "patternId": 1, "similarity": 1}},
    ]
    return {d["patternId"]: round(float(d["similarity"]), 4) for d in col.aggregate(pipeline)}


def main() -> int:
    if not os.environ.get("VOYAGE_API_KEY"):
        print("VOYAGE_API_KEY not set — cannot embed.")
        return 1
    db_name = os.environ.get("MONGODB_DATABASE")
    client = MongoClient(os.environ.get("MONGODB_URI"))
    db = client[db_name]
    patterns = db["fraud_patterns"]
    claims = db["claims"]
    print(f"DB: {db_name}  |  model: {os.environ.get('VOYAGE_MODEL', 'voyage-3.5')}\n")

    # Build ground truth: claimId -> set(patternId) it is a labelled example of.
    labels: dict[str, set] = {}
    for p in patterns.find({"patternType": "HISTORICAL_SIMILARITY", "active": True}):
        for cid in p.get("exampleClaimIds") or []:
            labels.setdefault(cid, set()).add(p["patternId"])
    if not labels:
        print("No exampleClaimIds found on any HISTORICAL_SIMILARITY pattern — nothing to calibrate.")
        return 1

    positives: list[tuple] = []  # (claimId, patternId, similarity)
    negatives: list[tuple] = []
    missing: list[str] = []

    for cid, pos_pids in sorted(labels.items()):
        claim = claims.find_one({"claimId": cid}, {"_id": 0, "description": 1})
        if not claim:
            missing.append(cid)
            continue
        text = (claim.get("description") or "").strip()
        if not text:
            missing.append(f"{cid}(no description)")
            continue
        qv = get_embedding(text, input_type="query")
        if qv is None:
            print(f"  embed failed for {cid}; skipping")
            continue
        scores = _vector_scores(patterns, qv)  # vectors live on the fraud_patterns collection
        for pid, sim in scores.items():
            (positives if pid in pos_pids else negatives).append((cid, pid, sim))

    if not positives:
        print("No positive pairs could be scored (claims missing or unembeddable).")
        if missing:
            print("Missing/unusable claims:", ", ".join(missing))
        return 1

    pos_sims = sorted(s for _, _, s in positives)
    neg_sims = sorted((s for _, _, s in negatives), reverse=True)

    print(f"Positive pairs (pattern vs its own example claim): {len(positives)}")
    print(f"Negative pairs: {len(negatives)}")
    if missing:
        print(f"Skipped {len(missing)} referenced claim(s) not in DB: {', '.join(missing)}")
    print()
    print(f"  positives  min={pos_sims[0]:.4f}  median={pos_sims[len(pos_sims)//2]:.4f}  max={pos_sims[-1]:.4f}")
    print(f"  negatives  max={neg_sims[0]:.4f}  median={neg_sims[len(neg_sims)//2]:.4f}  min={neg_sims[-1]:.4f}")
    print()

    # Sweep candidate thresholds and report precision / recall / F1 over the labelled pairs.
    print(f"  {'thresh':>7} {'TP':>4} {'FP':>4} {'FN':>4} {'prec':>6} {'recall':>7} {'F1':>6}")
    best = None
    t = 0.30
    while t <= 0.90001:
        tp = sum(1 for _, _, s in positives if s >= t)
        fn = len(positives) - tp
        fp = sum(1 for _, _, s in negatives if s >= t)
        prec = tp / (tp + fp) if (tp + fp) else 0.0
        rec = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = (2 * prec * rec / (prec + rec)) if (prec + rec) else 0.0
        print(f"  {t:>7.2f} {tp:>4} {fp:>4} {fn:>4} {prec:>6.2f} {rec:>7.2f} {f1:>6.2f}")
        if best is None or f1 > best[1]:
            best = (t, f1)
        t += 0.05

    print()
    print(f"Suggested FRAUD_SIMILARITY_THRESHOLD ~= {best[0]:.2f}  (best F1={best[1]:.2f} on labelled pairs)")
    print("Current setting:", os.environ.get("FRAUD_SIMILARITY_THRESHOLD", "0.65"))
    client.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
