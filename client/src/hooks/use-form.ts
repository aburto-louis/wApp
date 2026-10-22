import { createFormHook } from "@tanstack/react-form"
import { fieldContext, formContext } from "@/hooks/form-context"

export const { useAppForm, withForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: {},
  formComponents: {},
})
