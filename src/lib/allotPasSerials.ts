import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import type { Product } from '../types';

const FUNCTIONS_REGION = 'us-central1';

export type AllotPasSerialsInput = {
  verifierUid: string;
  serials: string[];
  product: Pick<Product, 'id' | 'name' | 'yesoneSku' | 'modelid' | 'modelNo' | 'modelApprovalNo'>;
  invoiceNo?: string;
  source: 'rcQuota' | 'interweighingDirect';
};

export async function allotPasSerialsToBank(input: AllotPasSerialsInput): Promise<{
  serials: string[];
  qty: number;
}> {
  const fn = httpsCallable<AllotPasSerialsInput, { serials: string[]; qty: number }>(
    getFunctions(app, FUNCTIONS_REGION),
    'allotPasSerials',
  );
  const result = await fn({
    verifierUid: input.verifierUid,
    serials: input.serials,
    product: {
      id: input.product.id,
      name: input.product.name,
      yesoneSku: input.product.yesoneSku,
      modelid: input.product.modelid,
      modelNo: input.product.modelNo,
      modelApprovalNo: input.product.modelApprovalNo,
    },
    invoiceNo: input.invoiceNo,
    source: input.source,
  });
  return {
    serials: result.data?.serials || input.serials,
    qty: result.data?.qty ?? input.serials.length,
  };
}
