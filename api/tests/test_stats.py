import random
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.services import stats as st
from app.services.judge import combine, parse_verdict
from app.services.upload import UploadError, parse_upload


# --- Wilson ---------------------------------------------------------------------------

def test_wilson_basic():
    lo, hi = st.wilson_ci(50, 100)
    assert lo < 0.5 < hi
    assert lo == pytest.approx(0.4038, abs=1e-3)
    assert hi == pytest.approx(0.5962, abs=1e-3)


def test_wilson_edges():
    assert st.wilson_ci(0, 0) == (0.0, 1.0)
    lo, hi = st.wilson_ci(10, 10)
    assert hi == pytest.approx(1.0) and 0.6 < lo < 0.8
    lo, hi = st.wilson_ci(0, 10)
    assert lo == pytest.approx(0.0) and 0.2 < hi < 0.4
    lo, hi = st.wilson_ci(7.5, 10)  # fractional successes (half ties)
    assert 0 < lo < 0.75 < hi < 1


# --- Bradley-Terry ----------------------------------------------------------------------

def test_bt_ordering():
    rng = random.Random(0)
    comps = []
    for _ in range(200):
        comps.append(("strong", "weak", 1.0 if rng.random() < 0.8 else 0.0))
        comps.append(("strong", "mid", 1.0 if rng.random() < 0.65 else 0.0))
        comps.append(("mid", "weak", 1.0 if rng.random() < 0.65 else 0.5))
    s = st.bradley_terry(comps)
    assert s["strong"] > s["mid"] > s["weak"]
    elo = {m: st.bt_elo(v) for m, v in s.items()}
    assert elo["strong"] > 1000 > elo["weak"]


def test_bt_undefeated_is_finite_and_ties():
    s = st.bradley_terry([("a", "b", 1.0)] * 10)
    assert s["a"] > s["b"] and all(v > 0 and v < 1e6 for v in s.values())
    s = st.bradley_terry([("a", "b", 0.5)] * 10)
    assert s["a"] == pytest.approx(s["b"])
    assert st.bradley_terry([]) == {}


def test_bt_bootstrap_ci_contains_point():
    items = [[("x", "y", 1.0), ("x", "y", 1.0), ("x", "y", 0.0)] for _ in range(30)]
    names = ["x", "y"]
    point = {m: st.bt_elo(v) for m, v in st.bradley_terry([c for i in items for c in i], models=names).items()}
    ci = st.bt_bootstrap(items, names, n_boot=100)
    for m in names:
        lo, hi = ci[m]
        assert lo <= point[m] + 1e-6 and point[m] - 1e-6 <= hi
    assert ci == st.bt_bootstrap(items, names, n_boot=100)  # deterministic (fixed seed)


# --- Krippendorff -----------------------------------------------------------------------

def test_alpha_perfect():
    units = [[-2, -2, -2], [1, 1], [0, 0, 0], [2, 2]]
    assert st.krippendorff_alpha_interval(units) == pytest.approx(1.0)


def test_alpha_random_near_zero():
    rng = random.Random(42)
    units = [[rng.randint(-2, 2) for _ in range(3)] for _ in range(2000)]
    assert abs(st.krippendorff_alpha_interval(units)) < 0.05


def test_alpha_known_value_and_undefined():
    # two coders, interval data; hand-computed: Do = 6/8, De = 254/56 -> alpha = 1 - Do/De
    units = [[1, 2], [2, 2], [-1, -2], [0, 1]]
    v = st.krippendorff_alpha_interval(units)
    assert v == pytest.approx(1 - 0.75 / (254 / 56), abs=1e-9)
    assert st.krippendorff_alpha_interval([[1], [2]]) is None
    assert st.krippendorff_alpha_interval([[1, 1], [1, 1]]) is None  # no variance -> undefined


# --- Kappas -------------------------------------------------------------------------------

def test_fleiss_perfect_and_textbook():
    assert st.fleiss_kappa([[-1, -1, -1], [1, 1, 1], [0, 0, 0]]) == pytest.approx(1.0)
    # classic example structure: equal counts reduce to standard Fleiss
    units = [[-1, -1, 0], [1, 1, 1], [0, 0, 1], [-1, -1, -1], [1, 0, -1]]
    k = st.fleiss_kappa(units)
    assert -1 <= k <= 1
    rng = random.Random(1)
    rand = [[rng.choice([-1, 0, 1]) for _ in range(rng.randint(2, 5))] for _ in range(3000)]
    assert abs(st.fleiss_kappa(rand)) < 0.05


def test_cohen():
    a = [-1, 0, 1, 1, -1, 0]
    assert st.cohen_kappa(a, a) == pytest.approx(1.0)
    b = [1, -1, -1, 0, 0, 1]  # never agrees -> po=0, pe=1/3 -> -0.5
    assert st.cohen_kappa(a, b) == pytest.approx(-0.5)
    assert st.cohen_kappa([], []) is None
    # textbook: po=0.7, pe=0.5 -> 0.4
    x = [1] * 35 + [1] * 15 + [-1] * 15 + [-1] * 35
    y = [1] * 35 + [-1] * 15 + [1] * 15 + [-1] * 35
    assert st.cohen_kappa(x, y) == pytest.approx(0.4)


def test_pairwise_agreement():
    assert st.pairwise_agreement([[1, 2, 1], [-1, -2]]) == pytest.approx(1.0)
    assert st.pairwise_agreement([[1, -1]]) == pytest.approx(0.0)
    assert st.pairwise_agreement([[1]]) is None


# --- Majority / disputes -----------------------------------------------------------------

def test_majority_sign():
    assert st.majority_sign([-1, -1, 0]) == -1
    assert st.majority_sign([1, 1]) == 1
    assert st.majority_sign([-1, 0, 1]) is None
    assert st.majority_sign([1, 1, -1, -1]) is None
    assert st.majority_sign([1, 1, 0, -1]) is None  # 2 of 4 is not a strict majority
    assert st.majority_sign([]) is None
    assert st.majority_sign([2, 1, -2]) == 1  # magnitudes collapse to sign


def test_dispute_reasons():
    item = {"is_gold": False}
    assert st.dispute_reasons(item, [1, -1], None, False, 3) == ["human_split"]
    assert st.dispute_reasons(item, [1, 2], -1, False, 3) == ["llm_disagrees"]
    assert st.dispute_reasons(item, [1, 2], 1, True, 3) == ["flagged"]
    assert st.dispute_reasons(item, [1], -1, True, 3) == []  # too few votes
    assert st.dispute_reasons(item, [1], -1, False, 1) == ["llm_disagrees"]  # min(2, jpi) = 1
    assert st.dispute_reasons({"is_gold": True}, [1, -1], None, True, 3) == []


# --- Judge parsing / combination --------------------------------------------------------

def test_parse_verdict_defensive():
    v = parse_verdict('Sure! ```json\n{"preference": 5, "criteria": {"acc": -3}, "rationale": "x"}\n```', ["acc", "tone"])
    assert v == {"preference": 2, "criteria": {"acc": -1, "tone": 0}, "rationale": "x"}
    assert parse_verdict("no json here", ["acc"]) is None


def test_combine_orders():
    agree = combine({"preference": 1, "criteria": {"a": 1, "b": 0}}, {"preference": 2, "criteria": {"a": 1, "b": 1}})
    assert agree == {"preference": 2, "criteria": {"a": 1, "b": 0}, "consistent": True}
    flip = combine({"preference": -2, "criteria": {"a": -1}}, {"preference": 1, "criteria": {"a": -1}})
    assert flip["consistent"] is False and flip["preference"] == 0 and flip["criteria"] == {"a": -1}


# --- Upload parsing ------------------------------------------------------------------------

def test_upload_csv():
    data = (" Prompt ,Response_A,response_b,IS_GOLD,gold,gold_explanation,topic\n"
            "Hi,a,b,yes,A,because,greet\n"
            ",a,b,,,,\n"
            "Q2,,,,,,math\n"
            "Q3,a,,true,B,,x\n").encode("utf-8-sig")
    rows, errors = parse_upload("x.csv", data)
    assert len(rows) == 2 and rows[0]["is_gold"] and rows[0]["gold_preference"] == -1
    assert rows[0]["metadata"] == {"topic": "greet"}
    assert rows[1]["is_gold"] is False and rows[1]["response_a"] is None
    assert [e["row"] for e in errors] == [2, 4]
    with pytest.raises(UploadError):
        parse_upload("x.txt", b"prompt\nhi\n")


def test_upload_jsonl():
    data = b'{"prompt": "a", "gold": "tie", "response_a": "x", "response_b": "y", "extra": {"k": 1}}\n\nnot json\n'
    rows, errors = parse_upload("x.jsonl", data)
    assert rows[0]["is_gold"] and rows[0]["gold_preference"] == 0 and rows[0]["metadata"] == {"extra": {"k": 1}}
    assert errors == [{"row": 3, "message": errors[0]["message"]}]


# --- End-to-end dashboard computation ------------------------------------------------------

def test_compute_project_stats_smoke():
    now = datetime(2026, 1, 1, 12, 30, tzinfo=timezone.utc)
    project = {"judgments_per_item": 3, "judge_model": "j",
               "rubric": [{"key": "acc", "label": "Accuracy"}]}
    items, judgments, llm = [], [], []
    users = [uuid.uuid4() for _ in range(3)]
    for k in range(10):
        iid = uuid.uuid4()
        items.append({"id": iid, "is_gold": False, "model_a": "good", "model_b": "bad",
                      "response_a": "x", "response_b": "y", "judgments_count": 3})
        for n, u in enumerate(users):
            pref = -2 if n < 2 else (1 if k % 2 else -1)
            judgments.append({"item_id": iid, "user_id": u, "preference": pref, "criteria": {"acc": -1},
                              "swapped": bool(n % 2), "too_fast": False, "is_gold": False, "gold_correct": None,
                              "flagged": False, "created_at": now - timedelta(hours=k)})
        llm.append({"item_id": iid, "model": "j", "preference": -1, "consistent": True, "created_at": now})
    gid = uuid.uuid4()
    items.append({"id": gid, "is_gold": True, "model_a": None, "model_b": None, "response_a": "x",
                  "response_b": "y", "judgments_count": 1})
    judgments.append({"item_id": gid, "user_id": users[0], "preference": 1, "criteria": {}, "swapped": False,
                      "too_fast": True, "is_gold": True, "gold_correct": False, "flagged": True, "created_at": now})
    out = st.compute_project_stats(project, items, judgments, llm, [], 0, now=now, n_boot=50)
    assert out["totals"]["items"] == 11 and out["totals"]["gold_items"] == 1 and out["totals"]["progress"] == 1.0
    assert [m["model"] for m in out["models"]] == ["good", "bad"]
    assert out["models"][0]["comparisons"] == 30  # gold excluded
    assert out["agreement"]["llm_human_agreement"] == 1.0
    assert out["quality"]["gold_accuracy"] == 0.0 and out["quality"]["flagged_count"] == 1
    assert len(out["timeline"]) == 48 and sum(b["judgments"] for b in out["timeline"]) == 31
    assert out["criteria"][0]["models"][0]["model"] == "bad"
    assert sum(h["count"] for h in out["preference_histogram"]) == 30
