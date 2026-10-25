-- Verde Dhan — register the live data sources. Price tables reference
-- data_sources(id), so a provider's rows are refused until it is listed here.
-- Angel One SmartAPI replaces Upstox for Indian equities and indices, and
-- also supplies MCX commodity and NSE currency futures (front month, INR
-- terms). Twelve Data stays listed but disabled as an optional global source.
insert into public.data_sources (id, display_name, category, licence_notes, is_demo, enabled) values
  ('angelone', 'Angel One SmartAPI', '{india_equities,india_indices,forex,commodities}',
   'Account-holder market data under the SmartAPI terms. Commodities are MCX futures and currencies are NSE currency futures, not international spot. Redistribution to other users needs an exchange data-vending licence.',
   false, true),
  ('twelvedata', 'Twelve Data', '{global_indices,forex,commodities}',
   'Not in use. Coverage and real-time access depend on the plan.', false, false)
on conflict (id) do update set
  display_name = excluded.display_name,
  category = excluded.category,
  licence_notes = excluded.licence_notes;

comment on column public.stocks.provider_ids is 'Provider instrument identifiers, e.g. {"angelone": "2885"} (SmartAPI symbol token).';
