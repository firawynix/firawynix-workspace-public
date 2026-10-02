import { injectable } from '@theia/core/shared/inversify';
import { SALESFORCE_SKILL_PACK } from './skills/salesforce-skill-pack';
import { StrigoiSkillDefinition, StrigoiSkillPack } from './skills/skill-pack';

export interface SkillRoute {
    readonly skills: readonly StrigoiSkillDefinition[];
    readonly packs: readonly string[];
}

/**
 * Native, deterministic skill selection. Extensions contribute declarative
 * packs; this service owns ordering, the small-context budget and auditability.
 */
@injectable()
export class StrigoiSkillRouter {
    protected readonly packs: StrigoiSkillPack[] = [SALESFORCE_SKILL_PACK];

    registerPack(pack: StrigoiSkillPack): void {
        if (this.packs.some(candidate => candidate.id === pack.id)) {
            return;
        }
        this.packs.push(pack);
    }

    getPacks(): readonly StrigoiSkillPack[] {
        return this.packs;
    }

    route(requestText: string): SkillRoute {
        const normalizedRequest = this.normalize(requestText);
        if (!normalizedRequest) {
            return { skills: [], packs: [] };
        }

        const ranked = this.packs
            .flatMap(pack => pack.skills.map(skill => ({ pack, skill, score: this.score(skill, normalizedRequest) })))
            .filter(candidate => candidate.score > 0)
            .sort((left, right) => right.score - left.score || left.skill.id.localeCompare(right.skill.id))
            .slice(0, 3);

        return {
            skills: ranked.map(candidate => candidate.skill),
            packs: Array.from(new Set(ranked.map(candidate => candidate.pack.name)))
        };
    }

    createPromptFragment(route: SkillRoute): string {
        if (route.skills.length === 0) {
            return `## Native skill routing\nNo built-in Strigoi skill pack matched this request. This does not override or invalidate a user-selected prompt, slash skill, or tool already present in the request. Follow those selected instructions when available; never invent skill content.`;
        }

        const skillNames = route.skills.map(skill => skill.name).join(', ');
        const guidance = route.skills.map(skill => `- ${skill.prompt}`).join('\n');
        const prerequisites = Array.from(new Set(route.skills.flatMap(skill => skill.prerequisites ?? [])));
        const prerequisiteNote = prerequisites.length > 0
            ? `\n- Check prerequisites only when needed: ${prerequisites.join('; ')}. Missing prerequisites are a blocker, not a reason to invent results.`
            : '';
        return `## Native skill routing\nThe native router selected: ${skillNames}. State this selection in one short sentence before acting, then follow only the applicable guidance. These skills do not grant extra permissions or tools.\n${guidance}${prerequisiteNote}`;
    }

    protected score(skill: StrigoiSkillDefinition, request: string): number {
        return skill.triggers.reduce((score, trigger) => {
            const normalizedTrigger = this.normalize(trigger);
            if (!normalizedTrigger) {
                return score;
            }
            if (normalizedTrigger.startsWith('.')) {
                return score + (request.includes(normalizedTrigger) ? 4 : 0);
            }
            return score + (this.matchesPhrase(request, normalizedTrigger) ? 2 : 0);
        }, 0);
    }

    protected matchesPhrase(text: string, phrase: string): boolean {
        const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|\\s)${escapedPhrase}(?=$|\\s|[.,;:!?])`).test(text);
    }

    protected normalize(value: string): string {
        return value
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLocaleLowerCase()
            .replace(/[^a-z0-9@._-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
}
