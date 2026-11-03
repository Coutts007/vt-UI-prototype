"""a frozen rules version never changes (backend-spec 11.7, M13)

The registry is authoritative for a version's status. A draft row may be frozen once; after that
its artifact, checksum and lineage are fixed, the only change left is retiring it, and no role may
delete it. The server also checks every artifact's checksum when it loads one, so a row changed by
hand outside this trigger is refused rather than computed with.

Revision ID: 0010
Revises: 0009
"""

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None

FUNCTION = """
CREATE FUNCTION vt_rules_version_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'a frozen rules version cannot be deleted' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'retired' THEN
    RAISE EXCEPTION 'a retired rules version cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'frozen' THEN
    IF NEW.status <> 'retired'
       OR NEW.artifact IS DISTINCT FROM OLD.artifact
       OR NEW.checksum IS DISTINCT FROM OLD.checksum
       OR NEW.parent IS DISTINCT FROM OLD.parent
       OR NEW.fitted_cohort_hash IS DISTINCT FROM OLD.fitted_cohort_hash
       OR NEW.frozen_at IS DISTINCT FROM OLD.frozen_at
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.rules_version IS DISTINCT FROM OLD.rules_version THEN
      RAISE EXCEPTION 'a frozen rules version is immutable' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF NEW.status = 'frozen' AND OLD.status = 'draft' AND NEW.frozen_at IS NULL THEN
    RAISE EXCEPTION 'freezing records when' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.rules_version IS DISTINCT FROM OLD.rules_version THEN
    RAISE EXCEPTION 'a rules version keeps its name' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
"""


def upgrade() -> None:
    op.execute(FUNCTION)
    op.execute(
        "CREATE TRIGGER rules_version_guard BEFORE UPDATE OR DELETE ON rules_version "
        "FOR EACH ROW EXECUTE FUNCTION vt_rules_version_guard()"
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER rules_version_guard ON rules_version")
    op.execute("DROP FUNCTION vt_rules_version_guard()")
