import { StrigoiSkillPack } from './skill-pack';

/**
 * The first bundled domain pack. Its content is authored for Strigoi and does
 * not redistribute Salesforce documentation or third-party extensions.
 */
export const SALESFORCE_SKILL_PACK: StrigoiSkillPack = {
    id: 'strigoi.salesforce',
    name: 'Strigoi Salesforce & Agentforce Pack',
    version: '1.0.0',
    publisher: 'Strigoi',
    description: 'Orientação local para Salesforce Core, Industries e Agentforce.',
    skills: [
        {
            id: 'salesforce.apex',
            name: 'Apex',
            description: 'Apex, triggers, testes e regras de plataforma.',
            triggers: ['.cls', '.trigger', 'apex', 'apex class', 'apex test', 'trigger', 'governor limit', 'governor limits', 'test class'],
            prompt: `Apply the Apex skill. Prefer bulk-safe collection processing, explicit sharing intent, CRUD/FLS checks at trust boundaries, and focused tests. Avoid SOQL/DML in loops. Verify governor-limit-sensitive changes with an Apex test or explain what prevents verification.`,
            prerequisites: ['Salesforce CLI', 'Java for the Apex language server']
        },
        {
            id: 'salesforce.soql',
            name: 'SOQL & SOSL',
            description: 'Consultas, seletores e acesso a dados Salesforce.',
            triggers: ['.soql', 'soql', 'sosl', 'selector', 'select ', 'from ', 'database.query', 'query optimization'],
            prompt: `Apply the SOQL & SOSL skill. Use bind variables instead of string concatenation, request only needed fields, consider selectivity and query limits, and preserve sharing/security intent. For dynamic queries, call out injection and escaping risks explicitly.`,
            prerequisites: ['Salesforce CLI']
        },
        {
            id: 'salesforce.lwc',
            name: 'Lightning Web Components',
            description: 'LWC, Aura e integração cliente-servidor.',
            triggers: ['.js-meta.xml', 'lightning web component', 'lightning web components', 'lwc', '@wire', 'lightningelement', 'aura'],
            prompt: `Apply the Lightning Web Components skill. Keep data access in Apex or supported LDS/UI APIs, respect reactive state and component boundaries, validate accessibility, and add focused Jest or Apex coverage where the project supports it.`,
            prerequisites: ['Salesforce CLI', 'Node.js for LWC tooling']
        },
        {
            id: 'salesforce.metadata',
            name: 'Salesforce DX & Metadata',
            description: 'Projetos SFDX, metadata, orgs e deploy.',
            triggers: ['sfdx-project.json', 'salesforce cli', 'sf project', 'scratch org', 'sandbox', 'package.xml', 'metadata', 'deploy source', 'retrieve source'],
            prompt: `Apply the Salesforce DX & Metadata skill. Treat the source repository as the source of truth, make deployment scope explicit, avoid destructive metadata operations without confirmation, and validate against the target org only after the person approves the change set.`,
            prerequisites: ['Salesforce CLI', 'Authenticated Salesforce org when deployment is requested']
        },
        {
            id: 'salesforce.industries',
            name: 'Salesforce Industries',
            description: 'OmniStudio, EPC, CPQ e artefatos Industries.',
            triggers: ['omnistudio', 'omniscript', 'flexcard', 'dataraptor', 'integration procedure', 'vlocity', 'epc', 'industries cpq', 'salesforce industries'],
            prompt: `Apply the Salesforce Industries skill. Preserve the contract between OmniScripts, FlexCards, DataRaptors, Integration Procedures and their data JSON. Identify the exact artifact and its dependencies before proposing a change, and avoid broad retrieve/deploy operations without an explicit manifest and review.`,
            prerequisites: ['Salesforce CLI', 'Industries/OmniStudio project access when deployment is requested']
        },
        {
            id: 'salesforce.agentforce',
            name: 'Agentforce',
            description: 'Agentforce DX, Agent Script, actions e testes de agentes.',
            triggers: ['agentforce', 'agent script', 'agent script language', 'agent metadata', 'agent test', 'agent testing', 'prompt template', 'agent action', 'agentforce dx'],
            prompt: `Apply the Agentforce skill. Treat agent configuration as versioned metadata. Keep actions least-privileged, make grounding and output constraints explicit, and distinguish preview/test evidence from a production deployment. Prefer Agentforce DX artifacts and repeatable tests when available.`,
            prerequisites: ['Salesforce CLI with Agentforce DX support', 'Agentforce-enabled Salesforce org for preview or live testing']
        }
    ]
};
