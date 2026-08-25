/** Keep in sync with src/lib/rvGstBillRates.ts */

const RV_GST_FEE_CUTOVER_DATE = '2026-08-18';
const RV_GST_FEE_THROUGH_CUTOVER = { upto20Kg: 150, above20Kg: 250 };
const RV_GST_FEE_AFTER_CUTOVER = { upto20Kg: 200, above20Kg: 350 };

function istDateKey(iso) {
  if (!iso || !String(iso).trim()) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function rvGstBillRateIso(record) {
  return record?.certifiedAt || record?.submittedAt || record?.approvedAt || record?.createdAt;
}

function rvGstFeeRatesForDateKey(dateKey) {
  return dateKey <= RV_GST_FEE_CUTOVER_DATE
    ? RV_GST_FEE_THROUGH_CUTOVER
    : RV_GST_FEE_AFTER_CUTOVER;
}

function pickDatedGstFeeBaseInr(record, capacityKg) {
  const rateDate = istDateKey(rvGstBillRateIso(record));
  const rates = rateDate
    ? rvGstFeeRatesForDateKey(rateDate)
    : RV_GST_FEE_AFTER_CUTOVER;
  return capacityKg <= 20 ? rates.upto20Kg : rates.above20Kg;
}

module.exports = {
  RV_GST_FEE_CUTOVER_DATE,
  pickDatedGstFeeBaseInr,
};
