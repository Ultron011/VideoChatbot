import sys
from pathlib import Path

# Windows consoles default to cp1252, which can't print Devanagari test queries.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Make apps/agent importable (src package + data paths).
AGENT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AGENT_DIR))

from src.memory import CachingManager


def test_cache():
    cache_file = AGENT_DIR / "data" / "cache.json"
    manager = CachingManager(cache_file)

    # Test cases: (query, expected_hit, expected_keyword_in_answer)
    test_cases = [
        ("what is the cost of ivf?", True, "one lakh fifty thousand"),
        ("how much does treatment cost in mumbai?", True, "one lakh fifty thousand"),
        ("ivf cost in india?", True, "one lakh fifty thousand"),
        ("how long does ivf take?", True, "four to six weeks"),
        ("ivf process timeline", True, "four to six weeks"),
        ("is the retrieval painful?", True, "sedation"),
        ("do i need to book an appointment?", True, "drmalpani"),
        ("clinic number?", True, "drmalpani"),
        ("can i walk after transfer?", True, "bed rest"),
        ("tell me a joke about doctors", False, None),
        ("what is the weather like in Mumbai?", False, None),
        # Vocabulary guard: one-word meaning flips must MISS — serving the
        # near-match answer would be medically wrong.
        ("is ivf safe?", False, None),                 # ≠ "is ivf painful"
        ("how much does icsi cost?", False, None),     # ≠ basic ivf cost
        ("what is the failure rate?", False, None),    # ≠ success rate
        ("can i run after transfer?", False, None),    # ≠ walking
        ("consultation fees?", False, None),           # ≠ ivf cycle fees
        # Reverse guard: under-specified questions must MISS — "what is
        # ivf" is a definition question, not the cost question it overlaps.
        ("what is ivf?", False, None),
        # Anaphora gate: context-dependent queries must MISS.
        ("how much does it cost?", False, None),
        ("is that painful?", False, None),
        # Language gate: Hindi queries must MISS (answers are English).
        ("आईवीएफ की लागत क्या है?", False, None),
    ]

    all_passed = True
    print("\n--- Running Caching Layer Validation Tests ---")
    for query, expected_hit, expected_keyword in test_cases:
        ans = manager.match_query(query)
        hit = ans is not None

        if hit != expected_hit:
            print(f"FAIL: Query '{query}' -> Expected Hit: {expected_hit}, Got Hit: {hit}")
            all_passed = False
            continue

        if hit and expected_keyword and expected_keyword not in ans.lower():
            print(f"FAIL: Query '{query}' -> Expected keyword '{expected_keyword}' in answer, but got:\n'{ans}'")
            all_passed = False
            continue

        status = "HIT" if hit else "MISS"
        print(f"PASS: Query '{query}' [{status}]")

    if all_passed:
        print("\nSUCCESS: All caching validation tests passed successfully!")
        return 0
    else:
        print("\nFAILURE: Some validation tests failed.")
        return 1


if __name__ == "__main__":
    sys.exit(test_cache())
