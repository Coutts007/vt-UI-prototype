"""Reads Locust's CSV files from scripts/load.sh and checks them against backend-spec 16.4."""

import csv
import sys
from pathlib import Path


def rows(path: Path) -> dict[str, dict[str, str]]:
    with path.open() as handle:
        return {row["Name"]: row for row in csv.DictReader(handle)}


def main(out: Path) -> int:
    ingest = rows(out / "ingest_stats.csv")
    lists = rows(out / "lists_stats.csv")
    mixed = rows(out / "mixed_stats.csv")
    checks: list[tuple[str, float, str, bool]] = []
    post = ingest["POST /profiles"]
    rate = float(post["Requests/s"])
    p95 = float(post["95%"])
    checks.append(("POST /profiles p95 at about 20 req/s", p95, f"{rate:.1f} req/s", p95 <= 300))
    checks.append(("POST /profiles rate reached", rate, "target 20", rate >= 19))
    for name, row in lists.items():
        if name.startswith("GET /") and name != "Aggregated":
            value = float(row["95%"])
            checks.append((f"{name} p95", value, "target 200 ms", value <= 200))
    sheet = mixed.get("POST /orders/{id}/sheets")
    if sheet:
        value = float(sheet["95%"])
        checks.append(
            ("Sheet generation p95 under mixed load", value, "target 1500 ms", value <= 1500)
        )
        median = float(sheet["50%"])
        checks.append(("Sheet generation median", median, "target 1500 ms", median <= 1500))
    failures = int(mixed["Aggregated"]["Failure Count"])
    checks.append(("Errors at 50 users", failures, "target 0", failures == 0))
    print(f"{'Check':48} {'Value':>10}  Note")
    for label, value, note, ok in checks:
        print(f"{label:48} {value:>10.1f}  {note} {'PASS' if ok else 'MISS'}")
    return 0 if all(ok for *_, ok in checks) else 1


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1])))
