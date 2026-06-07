import {
  EscPosTextBuilder,
  labelValueEscPosLine,
  leftRightEscPosLine,
  repeatChar,
  wrapEscPosText,
} from './escposText';
import {
  formatGstBillLineAmount,
  formatGstBillMoney,
  VERIFICATION_GST_BILL_BRANDING,
  type VerificationGstBillData,
} from './verificationGstBill';

/** Typical 80 mm thermal width at normal font. */
const RECEIPT_CHAR_WIDTH = 48;

function dashedRule(width = RECEIPT_CHAR_WIDTH): string {
  return repeatChar('-', width);
}

function formatGstBillMoneyEscPos(amount: number): string {
  return formatGstBillMoney(amount).replace(/\u20b9/g, 'Rs.');
}

export function buildVerificationGstBillEscPosPayload(
  bill: VerificationGstBillData,
): Uint8Array {
  const builder = new EscPosTextBuilder().init().align('left').textSize('normal').bold(false);

  builder.align('center').bold(true).textSize('large');
  builder.textLine(VERIFICATION_GST_BILL_BRANDING.companyName);
  builder.textSize('normal');
  builder.bold(false);

  for (const line of VERIFICATION_GST_BILL_BRANDING.addressLines) {
    builder.textLine(line);
  }
  builder.textLine(`GSTIN : ${VERIFICATION_GST_BILL_BRANDING.gstin}`);

  builder.align('left').textLine(dashedRule());
  builder.align('center').bold(true);
  builder.textLine('TAX INVOICE (B2C)');
  builder.textLine('FORM 8B RECEIPT');
  builder.bold(false).align('left');
  builder.textLine(dashedRule());

  builder.textLine(labelValueEscPosLine('Invoice No', bill.invoiceNumber, RECEIPT_CHAR_WIDTH));
  builder.textLine(labelValueEscPosLine('Date', bill.invoiceDateTime, RECEIPT_CHAR_WIDTH));
  builder.textLine(labelValueEscPosLine('Invoice Type', VERIFICATION_GST_BILL_BRANDING.invoiceType, RECEIPT_CHAR_WIDTH));
  builder.textLine(
    labelValueEscPosLine('Place of Supply', VERIFICATION_GST_BILL_BRANDING.placeOfSupply, RECEIPT_CHAR_WIDTH),
  );

  builder.textLine(dashedRule());
  builder.textLine(labelValueEscPosLine('Customer Name', bill.customerName, RECEIPT_CHAR_WIDTH));
  const locationLines = wrapEscPosText(bill.customerLocation, RECEIPT_CHAR_WIDTH - 12);
  builder.textLine(labelValueEscPosLine('Location', locationLines[0] ?? bill.customerLocation, RECEIPT_CHAR_WIDTH));
  for (let i = 1; i < locationLines.length; i += 1) {
    builder.textLine(locationLines[i]!);
  }

  builder.textLine(dashedRule());
  builder.textLine(leftRightEscPosLine('Description', 'Amount (Rs.)', RECEIPT_CHAR_WIDTH));
  builder.textLine(repeatChar('-', RECEIPT_CHAR_WIDTH));
  builder.textLine(
    leftRightEscPosLine('Verification Fees', formatGstBillLineAmount(bill.taxableValue), RECEIPT_CHAR_WIDTH),
  );

  builder.textLine(dashedRule());
  builder.textLine(
    labelValueEscPosLine('Taxable Value', formatGstBillMoneyEscPos(bill.taxableValue), RECEIPT_CHAR_WIDTH),
  );
  builder.textLine(labelValueEscPosLine('CGST @ 9%', formatGstBillMoneyEscPos(bill.cgstAmount), RECEIPT_CHAR_WIDTH));
  builder.textLine(labelValueEscPosLine('SGST @ 9%', formatGstBillMoneyEscPos(bill.sgstAmount), RECEIPT_CHAR_WIDTH));

  builder.textLine(dashedRule());
  builder.bold(true);
  builder.textLine(
    leftRightEscPosLine('TOTAL AMOUNT', formatGstBillMoneyEscPos(bill.totalAmount), RECEIPT_CHAR_WIDTH),
  );
  builder.bold(false);

  builder.textLine(dashedRule());
  builder.textLine('Amount In Words');
  for (const line of wrapEscPosText(bill.amountInWords, RECEIPT_CHAR_WIDTH)) {
    builder.textLine(line);
  }

  builder.textLine(dashedRule());
  builder.textLine(
    labelValueEscPosLine('Payment Mode', VERIFICATION_GST_BILL_BRANDING.paymentMode, RECEIPT_CHAR_WIDTH),
  );

  builder.textLine(dashedRule());
  builder.textLine('Verification Certificate');
  builder.textLine('Certificate No :');
  for (const line of wrapEscPosText(bill.certificateNumber, RECEIPT_CHAR_WIDTH)) {
    builder.textLine(line);
  }

  builder.textLine(dashedRule());
  builder.align('center');
  for (const line of VERIFICATION_GST_BILL_BRANDING.footerLines) {
    builder.textLine(line);
  }
  builder.align('left');
  builder.textLine(dashedRule());
  builder.align('center');
  builder.textLine('This is a computer generated invoice.');
  builder.textLine('No signature required.');
  builder.align('left').feed(3);

  return builder.build();
}
