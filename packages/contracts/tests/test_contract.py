import json
import re
from pathlib import Path

import yaml
from openapi_spec_validator import validate

ROOT = Path(__file__).parents[1]
DOC = yaml.safe_load((ROOT / "openapi.yaml").read_text())
ERRORS = json.loads((ROOT / "error-codes.json").read_text())
METHODS = {"get", "post", "put", "patch", "delete"}


def operations():
    for path, item in DOC["paths"].items():
        for method, op in item.items():
            if method in METHODS:
                yield path, method, op


def test_document_is_valid_openapi():
    validate(DOC)


def test_operation_ids_are_unique():
    ids = [op["operationId"] for _, _, op in operations()]
    assert len(ids) == len(set(ids))


def test_no_upload_is_possible():
    """Golden rule 2: every request body is JSON and no schema takes binary input."""
    for path, method, op in operations():
        body = op.get("requestBody")
        if body:
            assert list(body["content"]) == ["application/json"], (path, method)
    text = json.dumps(DOC["components"]["schemas"])
    assert '"binary"' not in text and "byte" not in text and "base64" not in text


def test_only_sheet_files_return_binary():
    for path, _, op in operations():
        for response in op["responses"].values():
            for media in response.get("content", {}):
                if media.split("/")[0] == "image" or media == "application/pdf":
                    assert path == "/files/sheets/{sheet_file}"


def test_schemas_reject_unknown_fields():
    for name, schema in DOC["components"]["schemas"].items():
        if schema.get("type") == "object" and name != "RulesArtifact":
            assert schema.get("additionalProperties") is False or name == "ServerCheck", name


def test_secured_operations_name_their_roles():
    for path, method, op in operations():
        assert bool(op.get("security")) == bool(op.get("x-roles")), (path, method)


def test_audit_actions_exist():
    actions = set(DOC["components"]["schemas"]["AuditAction"]["enum"])
    for path, method, op in operations():
        for action in re.findall(r"[a-z_]+", op.get("x-audit", "").replace(" or ", " ")):
            assert action in actions, (path, method, action)


def test_error_codes_are_well_formed():
    assert "approvals_missing" in ERRORS
    assert ERRORS["approvals_missing"]["status"] == 409
    for code, entry in ERRORS.items():
        assert re.fullmatch(r"[a-z_]+", code)
        assert 400 <= entry["status"] < 600 and entry["title"]


def test_every_error_status_is_declared_somewhere():
    used = {int(s) for _, _, op in operations() for s in op["responses"] if s[0] == "4"}
    assert {e["status"] for e in ERRORS.values()} <= used


def test_a14_a3_f2_session_fields_present():
    required = DOC["components"]["schemas"]["CaptureSession"]["required"]
    for field in ("free_arm", "guidance_mode", "camera_facing", "app_version"):
        assert field in required


def test_conflicts_resolve_by_conflict_id():
    assert "/conflicts/{conflict_id}/resolve" in DOC["paths"]


def test_profile_payload_carries_silhouettes_with_101_samples():
    schemas = DOC["components"]["schemas"]
    assert schemas["MmProfile"]["minItems"] == schemas["MmProfile"]["maxItems"] == 101
    assert {"silhouette_front", "silhouette_side"} <= set(
        schemas["MeasurementProfilePayload"]["required"]
    )


def test_plain_language_guide_covers_every_endpoint():
    guide = (ROOT.parents[1] / "docs" / "api-contract.md").read_text()
    for path, method, _ in operations():
        assert f"`{method.upper()} {path}" in guide, (method, path)
