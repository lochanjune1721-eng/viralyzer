-- Development seed (`supabase db reset` runs this after the migrations).
-- Reference rows (plans, niches, platforms, research connectors) are seeded by
-- the migrations themselves because constraints depend on them. This file only
-- adds data that helps exercise the graphs locally without paid research calls.

insert into public.niche_research (niche, payload, ttl_seconds, research_job_id)
values (
  'tech',
  '{
    "trends": [
      {"topic": "AI agents doing real work", "momentum": "rising", "why": "agent launches every week"},
      {"topic": "local-first / offline apps", "momentum": "steady", "why": "privacy fatigue"}
    ],
    "hooks": ["Nobody is talking about ...", "I tested X so you do not have to"],
    "formats": ["talking_head", "screen_recording", "duet_reaction"],
    "audience_notes": "Watches on commute; drops off after 3s without a concrete claim."
  }'::jsonb,
  86400 * 365,
  'seed'
);
