alter table appointment_settings
  drop constraint if exists appointment_settings_slot_interval_minutes_check;
alter table appointment_settings
  add constraint appointment_settings_slot_interval_minutes_check
  check (slot_interval_minutes between 5 and 300 and slot_interval_minutes % 5 = 0);

alter table appointment_settings
  alter column min_advance_minutes set default 0;
update appointment_settings set min_advance_minutes = 0 where min_advance_minutes <> 0;

alter table appointment_settings
  drop constraint if exists appointment_settings_default_buffer_minutes_check;
update appointment_settings
set default_buffer_minutes = least(30, greatest(1, default_buffer_minutes));
alter table appointment_settings
  alter column default_buffer_minutes set default 1;
alter table appointment_settings
  add constraint appointment_settings_default_buffer_minutes_check
  check (default_buffer_minutes between 1 and 30);
