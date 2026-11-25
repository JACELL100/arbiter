"""Pure statistics helpers (no DB access) - unit-tested in tests/test_stats.py.

Conventions: preference -2..2 canonical (negative = A better), sign category -1 (A) / 0 (tie) / 1 (B).
"""
from __future__ import annotations

import math
import random
import statistics
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Sequence

import numpy as np

# ---------------------------------------------------------------------------
# Basic helpers
# ---------------------------------------------------------------------------


def sign(x: float | int | None) -> int:
    if x is None:
        return 0
    return (x > 0) - (x < 0)


def majority_sign(signs: Sequence[int]) -> int | None:
    """Sign category with a strict majority (more than half of the votes), else None."""
    if not signs:
        return None
    cat, count = Counter(sign(s) for s in signs).most_common(1)[0]
    return cat if count * 2 > len(signs) else None


def wilson_ci(successes: float, n: float, z: float = 1.96) -> tuple[float, float]:
    """Wilson score interval. ``successes`` may be fractional (ties count half)."""
    if n <= 0:
        return (0.0, 1.0)
    p = min(max(successes / n, 0.0), 1.0)
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (max(0.0, centre - half), min(1.0, centre + half))


def _round(x: float | None, nd: int = 4) -> float | None:
    if x is None:
        return None
    x = float(x)
    if math.isnan(x) or math.isinf(x):
        return None
    return round(x, nd)


# ---------------------------------------------------------------------------
# Bradley-Terry
# ---------------------------------------------------------------------------

Comparison = tuple[str, str, float]  # (model_i, model_j, score of i: 1 win, 0.5 tie, 0 loss)


def bradley_terry(
    comparisons: Iterable[Comparison],
    models: Iterable[str] | None = None,
    prior: float = 0.5,
    iters: int = 200,
    tol: float = 1e-9,
) -> dict[str, float]:
    """Bradley-Terry strengths via the MM algorithm (Hunter, 2004).

    Ties count as half a win for each side. A small prior (2*prior virtual games, half won,
    against a fixed reference player of strength 1) keeps strengths finite for undefeated or
    winless models and for disconnected comparison graphs. Strengths are normalised to a
    geometric mean of 1 (so the Elo-scaled mean is 1000).
    """
    comps = list(comparisons)
    names = sorted(set(models or []) | {c[0] for c in comps} | {c[1] for c in comps})
    if not names:
        return {}
    idx = {m: k for k, m in enumerate(names)}
    k = len(names)
    wins = np.zeros(k)
    games = np.zeros((k, k))
    for a, b, s in comps:
        if a == b:
            continue
        i, j = idx[a], idx[b]
        wins[i] += s
        wins[j] += 1.0 - s
        games[i, j] += 1
        games[j, i] += 1
    p = np.ones(k)
    for _ in range(iters):
        denom = (games / (p[:, None] + p[None, :])).sum(axis=1) + 2 * prior / (p + 1.0)
        new_p = (wins + prior) / denom
        new_p /= math.exp(float(np.log(new_p).mean()))
        converged = float(np.max(np.abs(new_p - p))) < tol
        p = new_p
        if converged:
            break
    return {m: float(p[idx[m]]) for m in names}


def bt_elo(strength: float) -> float:
    return 1000.0 + 400.0 * math.log10(max(strength, 1e-12))


def bt_bootstrap(
    item_comparisons: Sequence[Sequence[Comparison]],
    models: Iterable[str],
    n_boot: int = 200,
    seed: int = 7,
) -> dict[str, tuple[float, float]]:
    """95% percentile CI of Elo-scaled BT scores, resampling items with replacement (fixed seed)."""
    names = list(models)
    if not item_comparisons or not names:
        return {m: (1000.0, 1000.0) for m in names}
    rng = random.Random(seed)
    n = len(item_comparisons)
    samples: dict[str, list[float]] = {m: [] for m in names}
    for _ in range(n_boot):
        comps: list[Comparison] = []
        for _ in range(n):
            comps.extend(item_comparisons[rng.randrange(n)])
        strengths = bradley_terry(comps, models=names, iters=100, tol=1e-7)
        for m in names:
            samples[m].append(bt_elo(strengths[m]))
    out = {}
    for m in names:
        arr = np.array(samples[m])
        out[m] = (float(np.percentile(arr, 2.5)), float(np.percentile(arr, 97.5)))
    return out


# ---------------------------------------------------------------------------
# Agreement
# ---------------------------------------------------------------------------


def _ordered_sq(v: np.ndarray) -> float:
    """Sum over ordered pairs i != j of (v_i - v_j)^2."""
    return float(2 * v.size * np.sum(v * v) - 2 * np.sum(v) ** 2)


def krippendorff_alpha_interval(units: Iterable[Sequence[float]]) -> float | None:
    """Krippendorff's alpha, interval metric (pairwise formulation).

    Only units with >= 2 values are pairable. Returns None when there are no pairable units
    or the pooled values have no variance (alpha is undefined then).
    """
    pairable = [np.asarray(u, dtype=float) for u in units if len(u) >= 2]
    if not pairable:
        return None
    allv = np.concatenate(pairable)
    n = allv.size
    d_o = sum(_ordered_sq(u) / (u.size - 1) for u in pairable) / n
    d_e = _ordered_sq(allv) / (n * (n - 1))
    if d_e <= 1e-12:
        return None
    return 1.0 - d_o / d_e


CATEGORIES = (-1, 0, 1)


def fleiss_kappa(units: Iterable[Sequence[int]], categories: Sequence[int] = CATEGORIES) -> float | None:
    """Fleiss' kappa generalised to a varying number of raters per item.

    Choice: each item i with n_i >= 2 ratings contributes its own observed agreement
    P_i = (sum_k n_ik^2 - n_i) / (n_i (n_i - 1)); P_bar is the unweighted mean of the P_i and
    chance agreement P_e = sum_k p_k^2 uses category proportions over all ratings of those
    items. With equal n_i this reduces exactly to classic Fleiss' kappa.
    """
    rows = [list(u) for u in units if len(u) >= 2]
    if not rows:
        return None
    p_items = []
    totals: Counter = Counter()
    total_n = 0
    for u in rows:
        c = Counter(u)
        n_i = len(u)
        p_items.append((sum(c[k] ** 2 for k in categories) - n_i) / (n_i * (n_i - 1)))
        totals.update(c)
        total_n += n_i
    p_bar = sum(p_items) / len(p_items)
    p_e = sum((totals[k] / total_n) ** 2 for k in categories)
    if p_e >= 1 - 1e-12:
        return None
    return (p_bar - p_e) / (1 - p_e)


def cohen_kappa(a: Sequence[int], b: Sequence[int], categories: Sequence[int] = CATEGORIES) -> float | None:
    if len(a) != len(b) or not a:
        return None
    n = len(a)
    p_o = sum(1 for x, y in zip(a, b) if x == y) / n
    ca, cb = Counter(a), Counter(b)
    p_e = sum((ca[k] / n) * (cb[k] / n) for k in categories)
    if p_e >= 1 - 1e-12:
        return None
    return (p_o - p_e) / (1 - p_e)


def pairwise_agreement(units: Iterable[Sequence[int]]) -> float | None:
    """Share of rater pairs on the same item that agree on sign."""
    agree = total = 0
    for u in units:
        s = [sign(x) for x in u]
        m = len(s)
        if m < 2:
            continue
        agree += sum(v * (v - 1) // 2 for v in Counter(s).values())
        total += m * (m - 1) // 2
    return agree / total if total else None


# ---------------------------------------------------------------------------
# Item aggregation & disputes (shared by items list, review queue, stats, export)
# ---------------------------------------------------------------------------

_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def pick_llm(rows: Sequence[dict], judge_model: str | None) -> dict | None:
    """One LLM verdict per item: the project's judge model if present, else the latest."""
    if not rows:
        return None
    for r in rows:
        if judge_model and r.get("model") == judge_model:
            return r
    return max(rows, key=lambda r: r.get("created_at") or _EPOCH)


def human_votes(prefs: Sequence[int]) -> dict[str, int]:
    c = Counter(sign(p) for p in prefs)
    return {"a": c[-1], "tie": c[0], "b": c[1]}


def dispute_reasons(
    item: dict,
    prefs: Sequence[int],
    llm_preference: int | None,
    any_flagged: bool,
    judgments_per_item: int,
) -> list[str]:
    """SPEC dispute rules. ``prefs`` are the canonical human preferences on this item."""
    if item.get("is_gold"):
        return []
    if len(prefs) < min(2, judgments_per_item):
        return []
    reasons: list[str] = []
    maj = majority_sign([sign(p) for p in prefs])
    if maj is None:
        reasons.append("human_split")
    if llm_preference is not None and maj is not None and sign(llm_preference) != maj:
        reasons.append("llm_disagrees")
    if any_flagged:
        reasons.append("flagged")
    return reasons


def aggregate_item(
    item: dict,
    judgments: Sequence[dict],
    llm: dict | None,
    review: dict | None,
    judgments_per_item: int,
) -> dict:
    """ItemRow extras (+ internal ``reasons``) for one item.

    ``disputed`` is true only while the item is unreviewed (a review resolves the dispute).
    """
    prefs = [int(j["preference"]) for j in judgments]
    llm_pref = int(llm["preference"]) if llm else None
    reasons = dispute_reasons(item, prefs, llm_pref, any(j.get("flagged") for j in judgments), judgments_per_item)
    return {
        "human_votes": human_votes(prefs),
        "human_mean": _round(sum(prefs) / len(prefs)) if prefs else None,
        "llm_preference": llm_pref,
        "llm_consistent": bool(llm["consistent"]) if llm else None,
        "review_preference": int(review["final_preference"]) if review else None,
        "disputed": bool(reasons) and review is None,
        "reasons": reasons,
    }


# ---------------------------------------------------------------------------
# Contributors
# ---------------------------------------------------------------------------


def screen_choice(j: dict) -> int:
    return -int(j["preference"]) if j.get("swapped") else int(j["preference"])


def contributor_metrics(user_judgments: Sequence[dict], prefs_by_item: dict[Any, list[tuple[Any, int]]]) -> dict:
    """Per-contributor quality metrics.

    ``prefs_by_item`` maps item_id -> [(user_id, preference)] over **non-gold** human judgments.
    """
    n = len(user_judgments)
    golds = [j for j in user_judgments if j.get("is_gold")]
    gold_correct = sum(1 for j in golds if j.get("gold_correct"))
    durations = [j["duration_ms"] / 1000.0 for j in user_judgments if j.get("duration_ms") is not None]
    agree = considered = 0
    for j in user_judgments:
        if j.get("is_gold"):
            continue
        others = [sign(p) for uid, p in prefs_by_item.get(j["item_id"], []) if uid != j["user_id"]]
        if len(others) < 2:
            continue
        maj = majority_sign(others)
        if maj is None:
            continue
        considered += 1
        agree += int(sign(j["preference"]) == maj)
    non_tie = [screen_choice(j) for j in user_judgments if j["preference"] != 0]
    return {
        "judgments": n,
        "golds": len(golds),
        "gold_accuracy": _round(gold_correct / len(golds)) if golds else None,
        "too_fast_rate": _round(sum(1 for j in user_judgments if j.get("too_fast")) / n) if n else 0.0,
        "median_seconds": _round(statistics.median(durations), 2) if durations else None,
        "agreement_rate": _round(agree / considered) if considered else None,
        "left_bias": _round(sum(1 for c in non_tie if c < 0) / len(non_tie)) if non_tie else None,
        "last_active_at": max((j["created_at"] for j in user_judgments), default=None),
    }


# ---------------------------------------------------------------------------
# Project dashboard
# ---------------------------------------------------------------------------


def model_pair(item: dict) -> tuple[str, str] | None:
    """(model_a, model_b) for an item; generic labels only when both names are missing."""
    a, b = item.get("model_a"), item.get("model_b")
    if not a and not b:
        return ("Model A", "Model B")
    if not a or not b or a == b:
        return None
    return (a, b)


def is_ready(item: dict) -> bool:
    return bool(item.get("response_a")) and bool(item.get("response_b"))


def progress_of(items: Sequence[dict], judgments_per_item: int) -> tuple[int, float]:
    """(target_judgments, progress 0..1). Progress caps each item at judgments_per_item."""
    ready = [i for i in items if not i["is_gold"] and is_ready(i)]
    target = len(ready) * judgments_per_item
    done = sum(min(int(i.get("judgments_count") or 0), judgments_per_item) for i in ready)
    return target, (min(done / target, 1.0) if target else 0.0)


def compute_project_stats(
    project: dict,
    items: Sequence[dict],
    judgments: Sequence[dict],
    llm_rows: Sequence[dict],
    reviews: Sequence[dict],
    paused_contributors: int,
    now: datetime | None = None,
    n_boot: int = 200,
) -> dict:
    now = now or datetime.now(timezone.utc)
    jpi = int(project["judgments_per_item"])
    items_by_id = {i["id"]: i for i in items}
    j_by_item: dict[Any, list[dict]] = defaultdict(list)
    for j in judgments:
        j_by_item[j["item_id"]].append(j)
    llm_by_item: dict[Any, list[dict]] = defaultdict(list)
    for r in llm_rows:
        llm_by_item[r["item_id"]].append(r)
    review_by_item = {r["item_id"]: r for r in reviews}

    non_gold = [i for i in items if not i["is_gold"]]
    non_gold_ids = {i["id"] for i in non_gold}
    target, progress = progress_of(items, jpi)
    llm_pick = {iid: pick_llm(rows, project.get("judge_model")) for iid, rows in llm_by_item.items()}

    disputed = 0
    for it in non_gold:
        agg = aggregate_item(it, j_by_item.get(it["id"], []), llm_pick.get(it["id"]),
                             review_by_item.get(it["id"]), jpi)
        disputed += int(agg["disputed"])

    totals = {
        "items": len(items),
        "gold_items": len(items) - len(non_gold),
        "ready_items": sum(1 for i in non_gold if is_ready(i)),
        "judgments": len(judgments),
        "contributors": len({j["user_id"] for j in judgments}),
        "target_judgments": target,
        "progress": _round(progress),
        "disputed": disputed,
        "reviewed": len(review_by_item),
        "llm_judged": len(llm_by_item),
    }

    # ---- models (human judgments on non-gold items) ---------------------------------
    ng_judgments = [j for j in judgments if j["item_id"] in non_gold_ids]
    record: dict[str, Counter] = defaultdict(Counter)
    item_comps: dict[Any, list[Comparison]] = defaultdict(list)
    crit_rec: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(lambda: [0.0, 0]))
    for j in ng_judgments:
        it = items_by_id[j["item_id"]]
        names = model_pair(it)
        if not names:
            continue
        a, b = names
        s = sign(j["preference"])
        if s < 0:
            record[a]["wins"] += 1
            record[b]["losses"] += 1
            item_comps[it["id"]].append((a, b, 1.0))
        elif s > 0:
            record[b]["wins"] += 1
            record[a]["losses"] += 1
            item_comps[it["id"]].append((a, b, 0.0))
        else:
            record[a]["ties"] += 1
            record[b]["ties"] += 1
            item_comps[it["id"]].append((a, b, 0.5))
        for key, val in (j.get("criteria") or {}).items():
            try:
                v = sign(int(val))
            except (TypeError, ValueError):
                continue
            ra, rb = crit_rec[key][a], crit_rec[key][b]
            ra[0] += 1.0 if v < 0 else 0.5 if v == 0 else 0.0
            rb[0] += 1.0 if v > 0 else 0.5 if v == 0 else 0.0
            ra[1] += 1
            rb[1] += 1

    model_names = sorted(record)
    all_comps = [c for cs in item_comps.values() for c in cs]
    strengths = bradley_terry(all_comps, models=model_names)
    boot = bt_bootstrap(list(item_comps.values()), model_names, n_boot=n_boot) if model_names else {}
    models = []
    for m in model_names:
        r = record[m]
        comps = r["wins"] + r["losses"] + r["ties"]
        score = r["wins"] + 0.5 * r["ties"]
        lo, hi = wilson_ci(score, comps)
        blo, bhi = boot.get(m, (1000.0, 1000.0))
        models.append({
            "model": m,
            "wins": r["wins"],
            "losses": r["losses"],
            "ties": r["ties"],
            "comparisons": comps,
            "win_rate": _round(score / comps) if comps else None,
            "win_rate_ci": [_round(lo), _round(hi)],
            "bt_score": _round(bt_elo(strengths[m]), 1),
            "bt_ci": [_round(blo, 1), _round(bhi, 1)],
        })
    models.sort(key=lambda x: x["bt_score"] or 0, reverse=True)

    # ---- agreement (non-gold only) ----------------------------------------------------
    ng_prefs = {iid: [int(j["preference"]) for j in js] for iid, js in j_by_item.items() if iid in non_gold_ids}
    multi = [p for p in ng_prefs.values() if len(p) >= 2]
    llm_signs: list[int] = []
    human_signs: list[int] = []
    for iid, prefs in ng_prefs.items():
        llm = llm_pick.get(iid)
        maj = majority_sign([sign(p) for p in prefs])
        if llm is None or maj is None:
            continue
        llm_signs.append(sign(llm["preference"]))
        human_signs.append(maj)
    picked = [r for iid, r in llm_pick.items() if r is not None and iid in non_gold_ids]
    agreement = {
        "krippendorff_alpha": _round(krippendorff_alpha_interval(multi)),
        "fleiss_kappa": _round(fleiss_kappa([[sign(x) for x in p] for p in multi])),
        "pairwise_agreement": _round(pairwise_agreement(multi)),
        "llm_human_agreement": _round(sum(int(a == b) for a, b in zip(llm_signs, human_signs)) / len(llm_signs))
        if llm_signs else None,
        "llm_human_kappa": _round(cohen_kappa(llm_signs, human_signs)) if llm_signs else None,
        "llm_consistency": _round(sum(1 for r in picked if r["consistent"]) / len(picked)) if picked else None,
    }

    # ---- position bias / quality --------------------------------------------------------
    non_tie = [screen_choice(j) for j in judgments if j["preference"] != 0]
    golds = [j for j in judgments if j.get("is_gold")]
    quality = {
        "too_fast_rate": _round(sum(1 for j in judgments if j.get("too_fast")) / len(judgments)) if judgments else 0.0,
        "gold_accuracy": _round(sum(1 for j in golds if j.get("gold_correct")) / len(golds)) if golds else None,
        "flagged_count": sum(1 for j in judgments if j.get("flagged")),
        "paused_contributors": paused_contributors,
    }

    # ---- criteria --------------------------------------------------------------------------
    criteria = []
    seen: set[str] = set()
    for c in project.get("rubric") or []:
        key = c.get("key") if isinstance(c, dict) else None
        if not key or key in seen:
            continue
        seen.add(key)
        rec = crit_rec.get(key, {})
        criteria.append({
            "key": key,
            "label": c.get("label") or key,
            "models": [{"model": m, "win_rate": _round(v[0] / v[1]) if v[1] else None, "n": int(v[1])}
                       for m, v in sorted(rec.items())],
        })

    # ---- timeline (last 48 h, hourly, UTC) -----------------------------------------------
    end = now.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    start = end - timedelta(hours=47)
    buckets: Counter = Counter()
    for j in judgments:
        ts = j["created_at"]
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        h = ts.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
        if start <= h <= end:
            buckets[h] += 1
    timeline = [
        {"bucket": (start + timedelta(hours=k)).isoformat(), "judgments": buckets[start + timedelta(hours=k)]}
        for k in range(48)
    ]

    hist = Counter(int(j["preference"]) for j in ng_judgments)
    return {
        "totals": totals,
        "models": models,
        "agreement": agreement,
        "position_bias": {
            "left_rate": _round(sum(1 for c in non_tie if c < 0) / len(non_tie)) if non_tie else None,
            "n": len(non_tie),
        },
        "quality": quality,
        "criteria": criteria,
        "timeline": timeline,
        "preference_histogram": [{"value": v, "count": hist[v]} for v in range(-2, 3)],
    }
