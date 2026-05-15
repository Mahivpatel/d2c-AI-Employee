export function resolveMerchantId(args: any, options?: any): string {
  const contextMerchantId = options?.experimental_context?.merchantId;
  const merchantId = contextMerchantId ?? args?.merchant_id;

  if (!merchantId || typeof merchantId !== "string") {
    throw new Error("merchant_id is required");
  }

  return merchantId;
}
