-- Verde Dhan — CFI Financial also supplies spot EUR/USD, GBP/USD, USD/JPY,
-- spot gold and silver, and WTI / natural gas CFDs (USD). Angel One keeps
-- the INR currency futures and MCX base metals.
update public.data_sources set category = '{global_indices,commodities,forex}' where id = 'cfi';
update public.data_sources set category = '{india_equities,india_indices,forex,commodities}',
  licence_notes = 'Account-holder market data under the SmartAPI terms. Used for NSE/BSE equities, NIFTY 50 / SENSEX, NSE INR currency futures and MCX base-metal futures (front month, INR). Redistribution to other users needs an exchange data-vending licence.'
  where id = 'angelone';
