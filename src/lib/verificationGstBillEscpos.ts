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
  VERIFICATION_GST_BILL_LINE_DESCRIPTION,
  VERIFICATION_GST_BILL_QR_CAPTION,
  VERIFICATION_GST_BILL_SAC_LINE,
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

function appendLabeledValue(
  builder: EscPosTextBuilder,
  label: string,
  value: string,
): void {
  const wrapWidth = RECEIPT_CHAR_WIDTH - Math.min(label.length + 3, 18);
  const lines = wrapEscPosText(value, wrapWidth);
  builder.textLine(labelValueEscPosLine(label, lines[0] ?? value, RECEIPT_CHAR_WIDTH));
  for (let i = 1; i < lines.length; i += 1) {
    builder.textLine(lines[i]!);
  }
}

function appendInstrumentEscPos(
  builder: EscPosTextBuilder,
  lines: VerificationGstBillData['instrumentLines'],
): void {
  const col = Math.floor(RECEIPT_CHAR_WIDTH / 2);
  let i = 0;
  while (i < lines.length) {
    const current = lines[i]!;
    const next = lines[i + 1];
    if (current.plain) {
      for (const wrapped of wrapEscPosText(current.value, RECEIPT_CHAR_WIDTH)) {
        builder.textLine(wrapped);
      }
      i += 1;
      continue;
    }
    if (current.span === 'half' && next?.span === 'half') {
      builder.textLine(
        `${labelValueEscPosLine(current.label, current.value, col)}${labelValueEscPosLine(next.label, next.value, col)}`,
      );
      i += 2;
      continue;
    }
    appendLabeledValue(builder, current.label, current.value);
    i += 1;
  }
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
  appendLabeledValue(builder, 'Phone', bill.customerPhone);
  appendLabeledValue(builder, 'Place', bill.customerAddress);
  builder.textLine(labelValueEscPosLine('Pincode', bill.customerPincode, RECEIPT_CHAR_WIDTH));
  builder.textLine(labelValueEscPosLine('District', bill.customerDistrict, RECEIPT_CHAR_WIDTH));
  builder.textLine(labelValueEscPosLine('State', bill.customerState, RECEIPT_CHAR_WIDTH));

  builder.textLine(dashedRule());
  builder.textLine(leftRightEscPosLine('Description', 'Amount (Rs.)', RECEIPT_CHAR_WIDTH));
  builder.textLine(repeatChar('=', RECEIPT_CHAR_WIDTH));
  builder.bold(true);
  builder.textLine(
    leftRightEscPosLine(
      VERIFICATION_GST_BILL_LINE_DESCRIPTION,
      formatGstBillLineAmount(bill.taxableValue),
      RECEIPT_CHAR_WIDTH,
    ),
  );
  builder.bold(false);
  builder.textLine(VERIFICATION_GST_BILL_SAC_LINE);
  builder.textLine(repeatChar('=', RECEIPT_CHAR_WIDTH));
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
  builder.bold(true).textLine('Instrument Details').bold(false);
  appendInstrumentEscPos(builder, bill.instrumentLines);
  if (bill.verifyUrl) {
    builder.align('center').blankLine();
    builder.qrCode(bill.verifyUrl, 4);
    builder.textLine(VERIFICATION_GST_BILL_QR_CAPTION);
    builder.align('left');
  }

  builder.textLine(dashedRule());
  builder.align('center');
  for (const line of VERIFICATION_GST_BILL_BRANDING.footerLines) {
    builder.textLine(line);
  }
  builder.align('left').feed(3);

  return builder.build();
}
