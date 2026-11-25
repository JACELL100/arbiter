"""Write api/sample/prompts.csv: 40 prompts without responses (fill them via /generate)
plus 6 gold items with responses, a clear correct answer and an explanation.

    .venv/Scripts/python scripts/sample_data.py
"""
from __future__ import annotations

import csv
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "sample" / "prompts.csv"

PROMPTS: list[tuple[str, str]] = [
    # coding
    ("coding", "Write a Python function that returns the n-th Fibonacci number in O(log n) time. Explain the approach briefly."),
    ("coding", "What is the difference between `let`, `const` and `var` in JavaScript? Give a short example of each."),
    ("coding", "My SQL query `SELECT name, COUNT(*) FROM orders` errors out in Postgres. Why, and how do I fix it?"),
    ("coding", "Write a bash one-liner that finds the 10 largest files under the current directory."),
    ("coding", "Explain what a race condition is and show a minimal Go example plus the fix."),
    ("coding", "Refactor this into idiomatic Python: `result = []\nfor x in items:\n    if x % 2 == 0:\n        result.append(x * x)`"),
    ("coding", "How do I debounce a search input in React with hooks? Show a short component."),
    ("coding", "Explain Big-O of looking up a key in a Python dict vs a list, and when each is appropriate."),
    # reasoning
    ("reasoning", "A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost? Show your reasoning."),
    ("reasoning", "If it takes 5 machines 5 minutes to make 5 widgets, how long would it take 100 machines to make 100 widgets?"),
    ("reasoning", "Three friends split a $30 hotel room, the clerk refunds $5, the bellboy keeps $2 and returns $1 each. Where did the 'missing dollar' go?"),
    ("reasoning", "Is the statement 'All squares are rectangles, so all rectangles are squares' valid? Explain the logical error if any."),
    ("reasoning", "You have a 3-litre and a 5-litre jug and unlimited water. How do you measure exactly 4 litres?"),
    ("reasoning", "A store raises a price by 20% and then lowers it by 20%. Is the final price the same as the original? Explain."),
    ("reasoning", "Estimate how many piano tuners work in Chicago. Walk through your assumptions."),
    ("reasoning", "Which is larger: 2^100 or 10^30? Justify without a calculator."),
    # writing
    ("writing", "Write a polite but firm email to a client whose invoice is 45 days overdue."),
    ("writing", "Write a 4-line poem about debugging at 2am."),
    ("writing", "Rewrite this sentence to be clearer and shorter: 'Due to the fact that we are currently in the process of reviewing the documents, we are unable at this point in time to provide a response.'"),
    ("writing", "Draft a two-paragraph product description for a minimalist steel water bottle."),
    ("writing", "Write a short, encouraging message to a teammate whose launch slipped by a week."),
    ("writing", "Summarize the plot of Romeo and Juliet in exactly three sentences."),
    ("writing", "Write a LinkedIn post (under 120 words) announcing that our team open-sourced an internal evaluation tool."),
    ("writing", "Give me five alternative titles for a blog post about reducing cloud costs."),
    # factual
    ("factual", "Why is the sky blue? Explain for a curious 12-year-old."),
    ("factual", "What causes the seasons on Earth?"),
    ("factual", "What is the difference between a virus and a bacterium?"),
    ("factual", "Briefly explain how public-key cryptography lets two strangers communicate securely."),
    ("factual", "What were the main causes of the 2008 financial crisis? Keep it to one paragraph."),
    ("factual", "How does a transformer language model generate text, at a high level?"),
    ("factual", "What is the difference between weather and climate?"),
    ("factual", "Explain inflation and why central banks raise interest rates to fight it."),
    # advice
    ("advice", "I have two job offers: a stable corporate role and an early-stage startup. How should I think about choosing?"),
    ("advice", "How can I get better at giving feedback to junior engineers?"),
    ("advice", "I keep procrastinating on a big project. Give me a practical plan for this week."),
    ("advice", "What should I check before signing a one-year apartment lease?"),
    ("advice", "How do I prepare for a system design interview in four weeks?"),
    ("advice", "My team's standups run 40 minutes. How can we make them useful and short?"),
    ("advice", "I'm starting to run. How should I build up to a 5k without getting injured?"),
    ("advice", "How do I politely decline a meeting that I don't need to attend?"),
]

# (category, prompt, response_a, response_b, gold A|B|tie, explanation)
GOLD: list[tuple[str, str, str, str, str, str]] = [
    (
        "factual",
        "What is the capital of Australia?",
        "The capital of Australia is Sydney, its largest and best-known city.",
        "The capital of Australia is Canberra. Sydney and Melbourne are larger, but Canberra was purpose-built "
        "as the capital as a compromise between them.",
        "B",
        "Response A is factually wrong: Canberra, not Sydney, is the capital. Accuracy outweighs fluency.",
    ),
    (
        "reasoning",
        "A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost?",
        "The ball costs 5 cents. If the ball is x, the bat is x + 1.00, so 2x + 1.00 = 1.10 and x = 0.05.",
        "The ball costs 10 cents, because $1.10 minus $1.00 is 10 cents.",
        "A",
        "Response B gives the intuitive but wrong answer (then the bat would cost $1.10 and the total $1.20). "
        "Response A is correct and shows the algebra.",
    ),
    (
        "coding",
        "In Python, how do I remove duplicates from a list while preserving order?",
        "Use `list(set(items))` - sets keep the original order of the elements.",
        "Use `list(dict.fromkeys(items))`. Dicts preserve insertion order (Python 3.7+), so the first occurrence "
        "of each element is kept in order.",
        "B",
        "Response A is wrong: sets do not preserve order. Response B is correct and explains why.",
    ),
    (
        "factual",
        "How many planets are in our solar system?",
        "There are eight planets: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus and Neptune. "
        "Pluto was reclassified as a dwarf planet in 2006.",
        "There are nine planets, including Pluto, which is the smallest and farthest from the Sun.",
        "A",
        "Since the IAU's 2006 definition there are eight planets; Response B is outdated and incorrect.",
    ),
    (
        "advice",
        "Is it safe to mix bleach and ammonia-based cleaners to clean a bathroom faster?",
        "Yes, combining them makes a stronger cleaner and saves time - just open a window.",
        "No. Mixing bleach and ammonia produces toxic chloramine gas, which can cause serious respiratory harm. "
        "Use one product, rinse thoroughly, and ventilate the room.",
        "B",
        "Response A gives dangerous advice. Response B is correct and safety-conscious.",
    ),
    (
        "writing",
        "Reply with only the word 'yes' or 'no': is water wet?",
        "yes",
        "Yes.",
        "tie",
        "Both responses follow the instruction and give the same answer; minor punctuation differences do not "
        "matter, so this is a tie.",
    ),
]

FIELDS = ["prompt", "response_a", "response_b", "model_a", "model_b", "is_gold", "gold", "gold_explanation", "category"]


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        for category, prompt in PROMPTS:
            w.writerow({"prompt": prompt, "is_gold": "false", "category": category})
        for category, prompt, a, b, gold, expl in GOLD:
            w.writerow({"prompt": prompt, "response_a": a, "response_b": b, "model_a": "gold-a", "model_b": "gold-b",
                        "is_gold": "true", "gold": gold, "gold_explanation": expl, "category": category})
    print(f"wrote {len(PROMPTS)} prompts + {len(GOLD)} gold items to {OUT}")


if __name__ == "__main__":
    main()
