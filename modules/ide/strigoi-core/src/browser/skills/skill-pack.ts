/**
 * A skill pack is declarative knowledge for the native Strigoi skill router.
 * Packs can add guidance and prerequisites, but cannot grant tools or bypass
 * the M2 permission model. Tool availability remains owned by the agent mode.
 */
export interface StrigoiSkillDefinition {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly triggers: readonly string[];
    readonly prompt: string;
    readonly prerequisites?: readonly string[];
}

export interface StrigoiSkillPack {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly publisher: string;
    readonly description: string;
    readonly skills: readonly StrigoiSkillDefinition[];
}
