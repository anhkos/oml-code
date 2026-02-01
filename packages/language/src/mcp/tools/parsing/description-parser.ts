/**
 * Description Parser Module
 * 
 * Handles extraction of assertions, instances, and type information from OML descriptions.
 * Decoupled from file I/O - accepts parsed AST as input.
 */

import { Logger, getLogger } from '../common/logger.js';
import {
    isConceptInstance,
    isRelationInstance,
    Description,
    ConceptInstance,
    RelationInstance,
} from '../../../generated/ast.js';
import { PropertyAssertion, InstanceInfo, ImportPrefixMap, ParsedDescription } from './types.js';
import {
    buildImportPrefixMap,
    resolveImportAlias,
    getCanonicalType,
} from './import-resolver.js';

/**
 * Extract property assertions from a single concept instance
 *
 * @param instance The concept instance to process
 * @param importPrefixMap Map for resolving import aliases
 * @param logger Optional logger
 * @returns Array of property assertions from the instance
 */
function extractPropertyAssertions(
    instance: ConceptInstance,
    importPrefixMap: ImportPrefixMap,
    logger: Logger = getLogger('description-parser'),
): PropertyAssertion[] {
    const assertions: PropertyAssertion[] = [];
    const instanceName = instance.name || 'unnamed';

    const instanceTypes = instance.ownedTypes?.map((t) => getCanonicalType(t.type as any, importPrefixMap, logger)) || [];

    logger.debug(`Processing concept instance`, { instanceName, typeCount: instanceTypes.length });

    for (const pva of instance.ownedPropertyValues || []) {
        let propName = 'unknown';
        let propQualified = 'unknown';

        if (pva.property) {
            if (pva.property.ref?.name) {
                propName = pva.property.ref.name;

                // Find vocabulary prefix by traversing container chain
                let vocabPrefix: string | undefined;
                let container: unknown = pva.property.ref.$container;
                while (container) {
                    const containerWithPrefix = container as { prefix?: string; $container?: unknown };
                    if (containerWithPrefix.prefix) {
                        vocabPrefix = containerWithPrefix.prefix;
                        break;
                    }
                    container = containerWithPrefix.$container;
                }

                propQualified = vocabPrefix ? `${vocabPrefix}:${propName}` : propName;
            } else if (pva.property.$refText) {
                propName = pva.property.$refText;
                propQualified = resolveImportAlias(propName, importPrefixMap);
            }
        }

        // Get values - can be referenced instances or literals
        const values: string[] = [];

        // Referenced values (for relation properties)
        for (const ref of pva.referencedValues || []) {
            const refInstance = ref.ref;
            values.push(refInstance?.name || 'unknown');
        }

        // Literal values (for scalar properties)
        for (const lit of pva.literalValues || []) {
            const litValue = (lit as any).value;
            if (litValue !== undefined && litValue !== null) {
                values.push(String(litValue));
            }
        }

        logger.debug(`Extracted property`, { property: propQualified, valueCount: values.length });

        assertions.push({
            propertyName: propQualified,
            propertyQualified: propQualified,
            values,
            instanceName,
            instanceTypes,
            line: pva.$cstNode?.range?.start?.line,
        });
    }

    return assertions;
}

/**
 * Extract all instances from a description
 *
 * @param description Parsed description AST
 * @param importPrefixMap Map for resolving import aliases
 * @param logger Optional logger
 * @returns Array of instance info and their property assertions
 */
function extractInstances(
    description: Description,
    importPrefixMap: ImportPrefixMap,
    logger: Logger = getLogger('description-parser'),
): { instances: InstanceInfo[]; assertions: PropertyAssertion[] } {
    const instances: InstanceInfo[] = [];
    const assertions: PropertyAssertion[] = [];

    for (const statement of description.ownedStatements || []) {
        if (isConceptInstance(statement)) {
            const instance = statement as ConceptInstance;
            const instanceName = instance.name || 'unnamed';
            const instanceLine = instance.$cstNode?.range?.start?.line ? instance.$cstNode.range.start.line + 1 : undefined;

            const instanceTypes = instance.ownedTypes?.map((t: any) => getCanonicalType(t.type as any, importPrefixMap, logger)) || [];

            logger.debug(`Found concept instance`, { name: instanceName, typeCount: instanceTypes.length });

            instances.push({
                name: instanceName,
                types: instanceTypes,
                line: instanceLine,
            });

            // Extract property assertions from this instance
            const instanceAssertions = extractPropertyAssertions(instance, importPrefixMap, logger);
            assertions.push(...instanceAssertions);
        }

        if (isRelationInstance(statement)) {
            const instance = statement as RelationInstance;
            const instanceName = instance.name || 'unnamed';
            const instanceLine = instance.$cstNode?.range?.start?.line
                ? instance.$cstNode.range.start.line + 1
                : undefined;

            const instanceTypes = instance.ownedTypes?.map((t: any) => t.type?.$refText || t.type?.ref?.name || 'Unknown') || [];

            logger.debug(`Found relation instance`, { name: instanceName, typeCount: instanceTypes.length });

            instances.push({
                name: instanceName,
                types: instanceTypes,
                line: instanceLine,
            });
        }
    }

    return { instances, assertions };
}

/**
 * Parse an OML description AST and extract all relevant information
 * This is a pure function - no file I/O, only AST processing
 *
 * @param description Parsed OML description AST
 * @param sourceCode Raw OML source code (for reference)
 * @param logger Optional logger
 * @returns Parsed description with assertions, instances, and metadata
 */
export function parseDescriptionAst(
    description: Description,
    sourceCode: string,
    logger: Logger = getLogger('description-parser'),
): ParsedDescription {
    logger.info(`Parsing description AST`);

    // Build import prefix map
    const importPrefixMap = buildImportPrefixMap(description, logger);
    logger.debug(`Built import prefix map`, { entries: Object.keys(importPrefixMap).length });

    // Extract instances and assertions
    const { instances, assertions } = extractInstances(description, importPrefixMap, logger);

    logger.info(`Parsing complete`, {
        instanceCount: instances.length,
        assertionCount: assertions.length,
    });

    return {
        assertions,
        instances,
        sourceCode,
        importPrefixMap,
    };
}
