// Main entry point - exports all modules for backward compatibility

// Types
export type {
  RawRow,
  ImportMapping,
  DocumentType,
  DocumentAnalysis,
  PlatformType,
  EntityType,
  SheetAnalysis,
  ColumnCluster,
  ImportPlan,
  SheetImportPlan,
} from './types'

// Aliases
export { fieldAliases, entityFieldAliases } from './aliases'

// Classification
export { 
  classifySheetEntity, 
  detectColumnClusters 
} from './classification/entity-classifier'
export { 
  detectPlatformFromSheet, 
  detectPlatformFromContent 
} from './classification/platform-detector'
export { detectDocumentAndPlatform } from './classification/doc-type-detector'

// Mapping
export { 
  deterministicMappingForEntity, 
  deterministicMapping,
  scoreSheetForOrderData,
  detectSheetType,
  detectHeaderRow 
} from './mapping/deterministic'
export { inferMappingWithAI } from './mapping/ai-inference'
export { docTypeToEntityType } from './mapping/entity-mapper'
export { findMatchingTemplate, learnTemplateFromCorrection } from './mapping/template-matcher'
export type { ImportTemplate } from './mapping/template-matcher'

// Normalization
export { 
  normalizeFieldValue, 
  normalizeRow,
  normalizeLocation,
  normalizeCategory,
  normalizeUnit,
  normalizeStatus,
  normalizePlatform,
  toTitleCase,
  cleanText 
} from './normalization'

// Planning
export { 
  extractSheetData, 
  analyzeSheet, 
  serializeImportRows 
} from './planning/sheet-analyzer'
export { 
  createImportPlan, 
  detectCrossSheetRelationships, 
  getTargetTable,
  computeUnionMapping,
  mergeSheetsWithUnion,
  areSheetsMergeable 
} from './planning/import-planner'

// Parsing
export { parseUnstructuredTextToRows } from './parsing/text-parser'

// Business utilities
export { 
  asNumber, 
  importNumber, 
  importDate, 
  normalizeImportStatus, 
  skuLookupKey,
  valueFor,
  formatCurrency,
  formatNumber,
  toDateInput 
} from '../business'