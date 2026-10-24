# WhatsApp templates

Business-initiated messages on the WhatsApp Cloud API must use templates approved in **Meta Business Manager → WhatsApp Manager → Message templates**. Submit the four below as category **Utility**, language **English (en)**. Names must match exactly; they are seeded in `whatsapp_templates`, and the admin should set `meta_status` to `APPROVED` once Meta approves each one.

Template parameters cannot contain newlines, tabs or more than four consecutive spaces (Meta error 132018). `sanitizeTemplateParam()` enforces this, so each parameter is one line.

Meta may reject or recategorise templates; wording below is a starting point. Do not add promotional language, since that pushes a template into the Marketing category.

## vd_global_premarket (4 parameters) — 08:00 IST

```
Verde Dhan global pre-market, {{1}}
{{2}}
{{3}}
{{4}}
Research only, not investment advice. Reply STOP to opt out.
```

1. date (with `[DEMO, synthetic data]` prefix in demo) · 2. US / Europe / Asia index moves · 3. FX and commodities · 4. rule-based global sentiment and sector tailwinds/pressure

## vd_india_premarket (4 parameters) — 08:30 IST

```
Verde Dhan India pre-market, {{1}}
Watch near breakout: {{2}}
Retest setups: {{3}}
Risk flags: {{4}}
Levels come from computed data. Research only, not investment advice. Reply STOP to opt out.
```

## vd_daily_close (5 parameters) — 16:30 IST

```
Verde Dhan daily close, {{1}}
Market: {{2}}
Top 3: {{3}}
Top 10: {{4}}
{{5}}
Scores rank evidence; they are not a probability of profit. Research only. Reply STOP to opt out.
```

## vd_exceptional_alert (3 parameters) — market hours, threshold-based

```
Verde Dhan alert: {{1}}
{{2}}
{{3}}
Research only, not investment advice. Reply STOP to opt out.
```

Triggers (defaults in `DEFAULT_ALERT_THRESHOLDS`): a confirmed breakout with score ≥ 75 and recommendation `BUY_BREAKOUT`, or an index move of ≥ 2%. Each alert has an idempotency key (`breakout:<symbol>:<date>` or `index:<symbol>:<date>`) so it is sent once.

## Recipient and consent

- Primary recipient: `WHATSAPP_RECIPIENT` (E.164). Nothing is enqueued until `WHATSAPP_RECIPIENT_OPTED_IN=true`, which should only be set once the recipient's opt-in is recorded.
- The number is never stored in the database; jobs reference a SHA-256 hash (`recipient_hash`). Logged provider responses have phone numbers redacted.
- A recipient who sends STOP must be removed (set the opt-in flag to false or remove the variable).

## Preview without sending

`npm run job -- preview_reports` prints all parameters built from demo research, with no network or database access.
