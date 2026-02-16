import * as fs from 'fs';
import { URI } from 'langium';
import { getOmlServices } from '../../services/oml-services.js';
import { resolveWorkspacePath } from '../common.js';
import { isVocabulary, isRelationEntity, isUnreifiedRelation, isScalarProperty, Vocabulary, RelationEntity, UnreifiedRelation, ScalarProperty } from '../../../generated/ast.js';

export interface ExtractedRelation {
    name: string;
    reverseName?: string;
    fromConcept: string;
    toConcept: string;
}

export interface ExtractedScalarProperty {
    name: string;
    domain: string;
    range: string;
    functional: boolean;
}

export interface VocabularyProperties {
    relations: ExtractedRelation[];
    scalarProperties: ExtractedScalarProperty[];
}

/**
 * Parse a vocabulary file to extract all relations and scalar properties
 */
export async function parseVocabularyForProperties(filePath: string): Promise<VocabularyProperties> {
    const services = getOmlServices().Oml;
    const resolvedPath = resolveWorkspacePath(filePath);
    
    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Vocabulary file not found: ${resolvedPath}`);
    }
    
    const content = fs.readFileSync(resolvedPath, 'utf-8');
    const uri = URI.file(resolvedPath);
    const document = services.shared.workspace.LangiumDocumentFactory.fromString(content, uri);
    
    await services.shared.workspace.DocumentBuilder.build([document], { validation: false });
    
    const root = document.parseResult.value;
    if (!isVocabulary(root)) {
        throw new Error(`File is not a vocabulary: ${filePath}`);
    }
    
    const vocabulary = root as Vocabulary;
    const relations: ExtractedRelation[] = [];
    const scalarProperties: ExtractedScalarProperty[] = [];
    
    // Extract relation entities
    for (const member of vocabulary.ownedStatements || []) {
        if (isRelationEntity(member)) {
            const rel = member as RelationEntity;
            
            const fromTypes = rel.sources?.map(s => {
                const ref = s.ref;
                return ref ? ref.name || 'Unknown' : 'Unknown';
            }) || [];
            const toTypes = rel.targets?.map(t => {
                const ref = t.ref;
                return ref ? ref.name || 'Unknown' : 'Unknown';
            }) || [];
            
            relations.push({
                name: rel.name || 'Unknown',
                reverseName: rel.reverseRelation?.name,
                fromConcept: fromTypes.join(', ') || 'Unknown',
                toConcept: toTypes.join(', ') || 'Unknown',
            });
        }
        
        // Extract unreified relations
        if (isUnreifiedRelation(member)) {
            const unrel = member as UnreifiedRelation;
            
            const fromTypes = unrel.sources?.map(s => {
                const ref = s.ref;
                return ref ? ref.name || 'Unknown' : 'Unknown';
            }) || [];
            const toTypes = unrel.targets?.map(t => {
                const ref = t.ref;
                return ref ? ref.name || 'Unknown' : 'Unknown';
            }) || [];
            
            relations.push({
                name: unrel.name || 'Unknown',
                reverseName: unrel.reverseRelation?.name,
                fromConcept: fromTypes.join(', ') || 'Unknown',
                toConcept: toTypes.join(', ') || 'Unknown',
            });
        }
        
        // Extract scalar properties
        if (isScalarProperty(member)) {
            const prop = member as ScalarProperty;
            
            const domains = prop.domains?.map(d => {
                const ref = d.ref;
                return ref ? ref.name || 'Unknown' : 'Unknown';
            }) || [];
            
            const ranges = prop.ranges?.map(r => {
                const ref = r.ref;
                return ref ? ref.name || 'Unknown' : 'Unknown';
            }) || [];
            
            scalarProperties.push({
                name: prop.name || 'Unknown',
                domain: domains.join(', ') || 'Unknown',
                range: ranges.join(', ') || 'Unknown',
                functional: prop.functional || false,
            });
        }
    }
    
    return { relations, scalarProperties };
}
