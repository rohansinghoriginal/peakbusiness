export { 
  deterministicMappingForEntity, 
  deterministicMapping,
  scoreSheetForOrderData,
  detectSheetType,
  detectHeaderRow 
} from './deterministic'

export { inferMappingWithAI } from './ai-inference'
export { docTypeToEntityType } from './entity-mapper'
export { findMatchingTemplate, learnTemplateFromCorrection } from './template-matcher'
export type { ImportTemplate } from './template-matcher'