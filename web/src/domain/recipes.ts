import { z } from 'zod'

export const MAX_DECIMAL_INTEGER_DIGITS = 12
export const MAX_DECIMAL_PLACES = 6
export const PROCUREMENT_DECIMAL_PLACES = 6

const DECIMAL_PATTERN = new RegExp(
  `^(?:0|[1-9]\\d{0,${MAX_DECIMAL_INTEGER_DIGITS - 1}})(?:\\.\\d{1,${MAX_DECIMAL_PLACES}})?$`,
)

function decimalPartsUnchecked(value: string): { coefficient: bigint; scale: number } {
  const [integerPart, fractionalPart = ''] = value.split('.')
  return {
    coefficient: BigInt(`${integerPart}${fractionalPart}`),
    scale: fractionalPart.length,
  }
}

function isPositiveDecimal(value: string): boolean {
  return DECIMAL_PATTERN.test(value) && decimalPartsUnchecked(value).coefficient > 0n
}

function isPercentage(value: string): boolean {
  if (!DECIMAL_PATTERN.test(value)) return false
  const { coefficient, scale } = decimalPartsUnchecked(value)
  return coefficient <= 100n * 10n ** BigInt(scale)
}

export const StableCatalogIdSchema = z.string().trim().min(1).max(160)

export const DecimalQuantitySchema = z
  .string()
  .trim()
  .regex(
    DECIMAL_PATTERN,
    `must be a canonical decimal with at most ${MAX_DECIMAL_INTEGER_DIGITS} integer digits and ${MAX_DECIMAL_PLACES} decimal places`,
  )

export const PositiveDecimalQuantitySchema = DecimalQuantitySchema.refine(isPositiveDecimal, {
  message: 'must be greater than zero',
})

export const WastePercentSchema = DecimalQuantitySchema.refine(isPercentage, {
  message: 'must be between zero and 100',
})

export type DecimalQuantity = z.infer<typeof DecimalQuantitySchema>

export interface DecimalParts {
  readonly coefficient: bigint
  readonly scale: number
}

export function decimalParts(value: DecimalQuantity): DecimalParts {
  const parsed = DecimalQuantitySchema.parse(value)
  return decimalPartsUnchecked(parsed)
}

export const RecipeIngredientSchema = z
  .object({
    ingredientId: StableCatalogIdSchema,
    ingredientName: z.string().trim().min(1).max(240),
    quantity: PositiveDecimalQuantitySchema,
    unit: z.string().trim().min(1).max(80),
    wastePercent: WastePercentSchema.optional(),
  })
  .strict()

export const RecipeDefinitionSchema = z
  .object({
    itemId: StableCatalogIdSchema,
    name: z.string().trim().min(1).max(240).optional(),
    yield: z.number().int().safe().positive(),
    ingredients: z.array(RecipeIngredientSchema).min(1),
  })
  .strict()
  .superRefine((recipe, context) => {
    const namesByIdentity = new Map<string, string>()

    recipe.ingredients.forEach((ingredient, index) => {
      const key = JSON.stringify([ingredient.ingredientId, ingredient.unit])
      const existingName = namesByIdentity.get(key)
      if (existingName !== undefined && existingName !== ingredient.ingredientName) {
        context.addIssue({
          code: 'custom',
          path: ['ingredients', index, 'ingredientName'],
          message: `conflicts with the name ${existingName} for the same ingredientId and unit`,
        })
      } else {
        namesByIdentity.set(key, ingredient.ingredientName)
      }
    })
  })

type ParsedRecipeIngredient = z.infer<typeof RecipeIngredientSchema>
type ParsedRecipeDefinition = z.infer<typeof RecipeDefinitionSchema>

export type RecipeIngredient = Readonly<ParsedRecipeIngredient>

export type RecipeDefinition = Readonly<
  Omit<ParsedRecipeDefinition, 'ingredients'> & {
    readonly ingredients: readonly RecipeIngredient[]
  }
>

export type RecipeValidationResult =
  | {
      readonly valid: true
      readonly recipe: RecipeDefinition
    }
  | {
      readonly valid: false
      readonly issues: readonly string[]
    }

export function validateRecipeDefinition(value: unknown): RecipeValidationResult {
  const result = RecipeDefinitionSchema.safeParse(value)
  if (result.success) return { valid: true, recipe: result.data }

  return {
    valid: false,
    issues: result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
      return `${path}${issue.message}`
    }),
  }
}
