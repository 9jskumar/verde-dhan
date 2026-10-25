-- Verde Dhan — CFI Financial (MetaTrader 5) as the source of global index
-- and Brent numbers. Rows are written by bridge/cfi_mt5 on a Windows machine
-- running the CFI MT5 terminal.
insert into public.data_sources (id, display_name, category, licence_notes, is_demo, enabled) values
  ('cfi', 'CFI Financial (MT5)', '{global_indices,commodities}',
   'CFD quotes from the account holder''s CFI MetaTrader 5 terminal. They track the underlying index or futures market but are not official index levels or exchange settlements. Confirm CFI''s terms before showing them to other users.',
   false, true)
on conflict (id) do update set
  display_name = excluded.display_name,
  category = excluded.category,
  licence_notes = excluded.licence_notes;
