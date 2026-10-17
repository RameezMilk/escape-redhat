// Knowledge pack: source-linked rule cards + the fictional site plan (data/knowledge/*).
import ruleCardsJson from '../../../data/knowledge/rule-cards.json' with { type: 'json' };
import sitePlanJson from '../../../data/knowledge/site-plan.json' with { type: 'json' };

export interface RuleCard {
  id: string;
  kind: string;
  title: string;
  section: string;
  source_url: string;
  principle: string;
  exercise_policy: string;
}

export type PlanSectionId = 'reporting' | 'routes' | 'assistance' | 'accountability';

export interface SitePlan {
  title: string;
  disclaimer: string;
  sections: Record<PlanSectionId, { text: string; rule_ids: string[] }>;
}

export const RULE_CARDS: RuleCard[] = (ruleCardsJson as unknown as { cards: RuleCard[] }).cards;
export const SITE_PLAN: SitePlan = sitePlanJson as unknown as SitePlan;

export function ruleCard(id: string): RuleCard | undefined {
  return RULE_CARDS.find((c) => c.id === id);
}

export function ruleSources(ids: string[]): { label: string; url: string }[] {
  return ids
    .map(ruleCard)
    .filter((c): c is RuleCard => !!c)
    .map((c) => ({ label: `${c.section} — ${c.title}`, url: c.source_url }));
}
