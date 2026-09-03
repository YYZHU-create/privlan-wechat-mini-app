DO $$
DECLARE
  names text[] := ARRAY['workflow_event_consumptions','workflow_events','workflow_tasks','workflow_instances','marketing_redemptions','marketing_issuances','marketing_campaigns','marketing_offers','marketing_audiences','membership_redemptions','membership_overrides','membership_level_rules','customer_tag_links','customer_memberships','membership_levels','membership_programs','customer_points_ledger','customer_points_accounts','customer_notes','customer_events','customer_tags','customers','orders','appointment_advisor_services','appointments','appointment_import_runs','staff_leaves','staff_schedules','staff_store_assignments','resource_store_assignments','resources','appointment_services','appointment_advisors','appointment_business_hours','appointment_settings','workspace_media_folders','assets','ai_template_draft_revisions','ai_template_drafts','ai_template_request_receipts','ai_credit_ledger','ai_credit_accounts','ai_workspace_skills','workspace_configs','merchant_ai_policies','merchant_ai_connections','subscriptions','audit_events','legacy_imports','operator_feature_flag_overrides','staff_members','stores'];
  t text; pass_no int;
BEGIN
  CREATE TEMP TABLE _uat_ids(id uuid primary key) ON COMMIT DROP;
  INSERT INTO _uat_ids SELECT id FROM tenants WHERE name LIKE 'B1 synthetic tenant %' ON CONFLICT DO NOTHING;
  FOR pass_no IN 1..4 LOOP
    FOREACH t IN ARRAY names LOOP
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='tenant_id') THEN
          EXECUTE format('DELETE FROM %I WHERE tenant_id IN (SELECT id FROM _uat_ids)', t);
        END IF;
      EXCEPTION WHEN foreign_key_violation OR undefined_table THEN NULL;
      END;
    END LOOP;
    BEGIN DELETE FROM merchant_sessions WHERE workspace_id IN (SELECT id FROM workspaces WHERE tenant_id IN (SELECT id FROM _uat_ids)); EXCEPTION WHEN foreign_key_violation THEN NULL; END;
    BEGIN DELETE FROM memberships WHERE workspace_id IN (SELECT id FROM workspaces WHERE tenant_id IN (SELECT id FROM _uat_ids)); EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  END LOOP;
  DELETE FROM users u WHERE u.login_identifier LIKE 'b1-auth-%@example.test' AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id=u.id);
  DELETE FROM workspaces w WHERE w.tenant_id IN (SELECT id FROM _uat_ids) AND NOT EXISTS (SELECT 1 FROM workflow_definitions d WHERE d.tenant_id=w.tenant_id);
  DELETE FROM tenants t WHERE t.id IN (SELECT id FROM _uat_ids) AND NOT EXISTS (SELECT 1 FROM workflow_definitions d WHERE d.tenant_id=t.id);
END $$;
