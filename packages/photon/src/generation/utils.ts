import { DMMFClass } from '../runtime/dmmf'
import { DMMF } from '../runtime/dmmf-types'

export function getScalarsName(modelName: string) {
  return `${modelName}Scalars`
}

export function getPayloadName(modelName: string) {
  return `${modelName}GetPayload`
}

export function getSelectName(modelName: string) {
  return `${modelName}Select`
}

export function getDefaultName(modelName: string) {
  return `${modelName}Default`
}

export function getFieldArgName(field: DMMF.SchemaField): string {
  return getArgName((field.outputType.type as DMMF.OutputType).name, field.outputType.isList)
}

export function getArgName(name: string, isList: boolean): string {
  if (!isList) {
    return `${name}Args`
  }

  return `FindMany${name}Args`
}

// we need names for all top level args,
// as GraphQL doesn't have the concept of unnamed args
export function getModelArgName(modelName: string, action: DMMF.ModelAction): string {
  switch (action) {
    case DMMF.ModelAction.findMany:
      return `FindMany${modelName}Args`
    case DMMF.ModelAction.findOne:
      return `FindOne${modelName}Args`
    case DMMF.ModelAction.upsert:
      return `${modelName}UpsertArgs`
    case DMMF.ModelAction.update:
      return `${modelName}UpdateArgs`
    case DMMF.ModelAction.updateMany:
      return `${modelName}UpdateManyArgs`
    case DMMF.ModelAction.delete:
      return `${modelName}DeleteArgs`
    case DMMF.ModelAction.create:
      return `${modelName}CreateArgs`
    case DMMF.ModelAction.deleteMany:
      return `${modelName}DeleteManyArgs`
  }
}

export function getDefaultArgName(dmmf: DMMFClass, modelName: string, action: DMMF.ModelAction) {
  const mapping = dmmf.mappings.find(m => m.model === modelName)!

  const fieldName = mapping[action]
  const operation = getOperation(action)
  const queryType = operation === 'query' ? dmmf.queryType : dmmf.mutationType
  const field = queryType.fields.find(f => f.name === fieldName)!
  return (field.args[0].inputType[0].type as DMMF.InputType).name
}

export function getOperation(action: DMMF.ModelAction): 'query' | 'mutation' {
  if (action === DMMF.ModelAction.findMany || action === DMMF.ModelAction.findOne) {
    return 'query'
  }
  return 'mutation'
}

/**
 * Used to render the initial client args
 * @param modelName
 * @param fieldName
 * @param mapping
 */
export function renderInitialClientArgs(
  actionName: DMMF.ModelAction,
  fieldName: string,
  mapping: DMMF.Mapping,
): string {
  return `
  dmmf,
  fetcher,
  '${getOperation(actionName as DMMF.ModelAction)}',
  '${fieldName}',
  '${mapping.plural}.${actionName}',
  args,
  []\n`
}

export function getFieldTypeName(field: DMMF.SchemaField) {
  if (typeof field.outputType.type === 'string') {
    return field.outputType.type
  }

  return field.outputType.type.name
}

export function getType(name: string, isList: boolean) {
  return name + (isList ? '[]' : '')
}

export function getFieldType(field: DMMF.SchemaField) {
  return getType(getFieldTypeName(field), field.outputType.isList)
}

interface SelectReturnTypeOptions {
  name: string
  actionName: DMMF.ModelAction
  renderPromise?: boolean
  hideCondition?: boolean
  isField?: boolean
  fieldName?: string
}

/**
 * Get the complicated extract output
 * @param name Model name
 * @param actionName action name
 */
export function getSelectReturnType({
  name,
  actionName,
  renderPromise = true,
  hideCondition = false,
  isField = false,
  fieldName,
}: SelectReturnTypeOptions) {
  const isList = actionName === DMMF.ModelAction.findMany

  const argName = isField ? getArgName(name, isList) : getModelArgName(name, actionName as DMMF.ModelAction)

  if (isList || hideCondition) {
    const listOpen = isList ? 'Array<' : ''
    const listClose = isList ? '>' : ''
    return `${renderPromise ? 'Promise<' : ''}${listOpen}${name}GetPayload<Extract${argName}Select<T>>${listClose}${
      renderPromise ? '>' : ''
    }`
  }

  return `'select' extends keyof T ? ${renderPromise ? 'Promise<' : ''}${name}GetPayload<Extract${argName}Select<T>>${
    renderPromise ? '>' : ''
  } : ${name}Client<${getType(name, isList)}>`
}

export function isQueryAction(action: DMMF.ModelAction, operation: 'query' | 'mutation'): boolean {
  if (!(action in DMMF.ModelAction)) {
    return false
  }
  const result = action === DMMF.ModelAction.findOne || action === DMMF.ModelAction.findMany
  return operation === 'query' ? result : !result
}
