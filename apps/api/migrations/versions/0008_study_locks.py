"""study locks in the database and a narrower retention role (review of PR #14)

Revision ID: 0008
Revises: 0007
"""

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None

# What the nightly job removes, and nothing else (backend-spec 14.6). Child rows go by cascade.
# audit_log stays: step 4 removes rows past their period, and only this role may.
RETENTION_DELETES = (
    '"order"', "client", "measurement_profile", "capture_session", "measurement_derivation",
    "reference_correction", "reference_measurement", "participant", "audit_log",
    "revoked_token", "deleted_profile",
)  # fmt: skip

FUNCTIONS = """
CREATE FUNCTION vt_participant_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.withdrawn_at IS NOT NULL AND NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at THEN
    RAISE EXCEPTION 'a withdrawal cannot be undone' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.cohort IS DISTINCT FROM OLD.cohort AND EXISTS (
    SELECT 1 FROM reference_measurement WHERE participant_id = OLD.participant_id
  ) THEN
    RAISE EXCEPTION 'the cohort is locked once readings exist' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER participant_guard BEFORE UPDATE ON participant
  FOR EACH ROW EXECUTE FUNCTION vt_participant_guard();

CREATE FUNCTION vt_study_link_guard() RETURNS trigger AS $$
BEGIN
  IF current_user <> 'vt_retention' AND (
    (OLD.participant_id IS NOT NULL AND NEW.participant_id IS DISTINCT FROM OLD.participant_id)
    OR (OLD.set_no IS NOT NULL AND NEW.set_no IS DISTINCT FROM OLD.set_no)
  ) THEN
    RAISE EXCEPTION 'a study set keeps its participant' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER capture_session_study_link BEFORE UPDATE ON capture_session
  FOR EACH ROW EXECUTE FUNCTION vt_study_link_guard();

CREATE FUNCTION vt_seed_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.key = 'allocation_seed' AND (TG_OP = 'DELETE' OR NEW.value IS DISTINCT FROM OLD.value) THEN
    RAISE EXCEPTION 'the allocation seed is set once' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER app_setting_seed_once BEFORE UPDATE OR DELETE ON app_setting
  FOR EACH ROW EXECUTE FUNCTION vt_seed_guard();
"""


def _statements(sql: str) -> list[str]:
    parts, current = [], ""
    for line in sql.strip().splitlines():
        current += line + "\n"
        if line.rstrip().endswith(";") and current.count("$$") % 2 == 0:
            parts.append(current)
            current = ""
    return parts


def upgrade() -> None:
    op.add_column(
        "participant", sa.Column("withdrawn_at", sa.DateTime(timezone=True), nullable=True)
    )
    for statement in _statements(FUNCTIONS):
        op.execute(statement)
    op.execute("REVOKE DELETE ON ALL TABLES IN SCHEMA public FROM vt_retention")
    op.execute("REVOKE ALL ON alembic_version, user_account FROM vt_retention")
    op.execute(f"GRANT DELETE ON {', '.join(RETENTION_DELETES)} TO vt_retention")


def downgrade() -> None:
    op.execute(f"REVOKE DELETE ON {', '.join(RETENTION_DELETES)} FROM vt_retention")
    op.execute("GRANT SELECT, DELETE ON ALL TABLES IN SCHEMA public TO vt_retention")
    op.execute("DROP TRIGGER app_setting_seed_once ON app_setting")
    op.execute("DROP FUNCTION vt_seed_guard()")
    op.execute("DROP TRIGGER capture_session_study_link ON capture_session")
    op.execute("DROP FUNCTION vt_study_link_guard()")
    op.execute("DROP TRIGGER participant_guard ON participant")
    op.execute("DROP FUNCTION vt_participant_guard()")
    op.drop_column("participant", "withdrawn_at")
