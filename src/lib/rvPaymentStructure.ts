import { formatRcFeeAmount, verificationFeeWithGst } from './rcProfileFields';
import {
  ZOHO_RV_PRODUCT_BASE_ABOVE_20_KG,
  ZOHO_RV_PRODUCT_BASE_UPTO_20_KG,
} from './zohoRvSubmit';

export type RvPaymentStructureRow = {
  cap: string;
  baseInr: number;
  gstInr: number;
  totalInr: number;
  payoutInr: number;
};

function rvPaymentStructureRow(
  cap: string,
  baseInr: number,
  payoutInr: number,
): RvPaymentStructureRow {
  const { gst, total } = verificationFeeWithGst(baseInr);
  return { cap, baseInr, gstInr: gst, totalInr: total, payoutInr };
}

/** RC wallet / Zoho RV fee tiers — reference amounts for admin settings. */
export const RV_PAYMENT_STRUCTURE_ROWS: RvPaymentStructureRow[] = [
  rvPaymentStructureRow('Above 20 kg', ZOHO_RV_PRODUCT_BASE_ABOVE_20_KG, 225),
  rvPaymentStructureRow('Up to 20 kg', ZOHO_RV_PRODUCT_BASE_UPTO_20_KG, 135),
];

export function formatRvPaymentStructureAmount(amount: number): string {
  return formatRcFeeAmount(amount).replace('₹', '');
}
