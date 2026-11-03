"""The analysis CLI on the seed, through the real export endpoints (M14 Done-when)."""

import filecmp
import json
from pathlib import Path

from httpx import AsyncClient
from support import bearer, sign_in
from typer.testing import CliRunner
from vt_analysis.cli import cli

PREFIX = "/api/v1"
VERSION = "0.1-uncalibrated"


async def test_two_runs_on_the_seed_export_are_byte_identical(
    client: AsyncClient, tmp_path: Path
) -> None:
    headers = bearer(await sign_in(client, "admin@vt.test"))
    # The analysis needs a frozen version: freeze the shipped file through the registry.
    frozen = await client.post(f"{PREFIX}/admin/rules/{VERSION}/freeze", headers=headers)
    assert frozen.status_code == 200
    listing = await client.get(f"{PREFIX}/admin/rules", headers=headers)
    (tmp_path / "registry.json").write_text(json.dumps(listing.json()))
    captures = await client.get(
        f"{PREFIX}/study/export/captures.csv", params={"rules_version": VERSION}, headers=headers
    )
    reference = await client.get(f"{PREFIX}/study/export/reference.csv", headers=headers)
    assert captures.status_code == 200 and reference.status_code == 200
    # Without a re-derivation the values are the phones' own under the same version: the
    # export leaves rederived_rules_version empty, which the analysis accepts (data.py).
    (tmp_path / "captures.csv").write_text(captures.text)
    (tmp_path / "reference.csv").write_text(reference.text)
    outs = []
    for name in ("a", "b"):
        out = tmp_path / name
        result = CliRunner().invoke(cli, [
            "run", "--captures", str(tmp_path / "captures.csv"),
            "--reference", str(tmp_path / "reference.csv"),
            "--registry", str(tmp_path / "registry.json"), "--rules", VERSION,
            "--out", str(out), "--resamples", "60", "--seed", "3",
        ])  # fmt: skip
        assert result.exit_code == 0, result.output
        outs.append(out)
    a, b = outs
    for table in sorted(p.name for p in (a / "tables").iterdir()):
        assert filecmp.cmp(a / "tables" / table, b / "tables" / table, shallow=False), table
    assert (a / "results.md").read_bytes() == (b / "results.md").read_bytes()
    assert (a / "metadata.json").read_bytes() == (b / "metadata.json").read_bytes()
    meta = json.loads((a / "metadata.json").read_text())
    assert meta["frozen_at"] and meta["rules_version"] == VERSION
    # Two test-cohort participants with one or two readings each: nothing can be analysed, and
    # the report says so for every site rather than inventing a verdict.
    text = (a / "results.md").read_text()
    assert "NOT ASSESSED" in text and "Not analysed" in text
