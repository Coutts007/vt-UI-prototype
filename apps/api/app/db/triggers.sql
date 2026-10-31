-- Append-only audit and immutable reference readings. Only retention may remove expired rows.
CREATE FUNCTION vt_block_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_user = 'vt_retention' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% rows cannot be changed', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION vt_block_change();
CREATE TRIGGER reference_measurement_immutable BEFORE UPDATE OR DELETE ON reference_measurement
  FOR EACH ROW EXECUTE FUNCTION vt_block_change();
CREATE TRIGGER reference_correction_immutable BEFORE UPDATE OR DELETE ON reference_correction
  FOR EACH ROW EXECUTE FUNCTION vt_block_change();
