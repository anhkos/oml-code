// src/tools/template.ts
import { log } from "../utils/oml-context.js";

const TEMPLATES = {
  vocabulary: `vocabulary <http://example.com/domain#> as domain {
    concept Entity
    aspect Identifiable

    concept SubEntity < Entity

    relation entity hasRelation [
        from Entity
        to SubEntity
        forward hasRelation
        reverse isRelationOf
    ]
}`,

  description: `description <http://example.com/instance#> as inst {
    uses <http://example.com/domain>

    instance entity1 : domain:Entity
    instance subEntity1 : domain:SubEntity

    relation instance entity1 [
        domain:hasRelation subEntity1
    ]
}`,

  concept: `concept ConceptName`,

  aspect: `aspect AspectName`,

  relation: `relation entity relationName [
    from SourceConcept
    to TargetConcept
    forward forwardName
    reverse reverseName
]`,

  unreifiedRelation: `relation relationName [
    from SourceConcept
    to TargetConcept
    forward forwardName
]`,
} as const;

export type TemplateKey = keyof typeof TEMPLATES;

export function listTemplates(): TemplateKey[] {
  return Object.keys(TEMPLATES) as TemplateKey[];
}

export function getTemplate(templateType: TemplateKey): string {
  log("info", "get_oml_template called", { templateType });

  const template = TEMPLATES[templateType];

  if (!template) {
    log("error", "Unknown template type", { templateType });
    throw new Error(`Unknown template type: ${templateType}`);
  }

  return template;
}
