import {
  EscPosTextBuilder,
  labelValueEscPosLine,
  leftRightEscPosLine,
  repeatChar,
  wrapEscPosText,
} from './escposText';
import {
  formatReceiptLineAmount,
  formatReceiptMoney,
  VERIFICATION_RECEIPT_BRANDING,
  type VerificationReceiptData,
} from './verificationReceipt';

/** Typical 80 mm thermal width at normal font. */
const RECEIPT_CHAR_WIDTH = 48;

function dashedRule(width = RECEIPT_CHAR_WIDTH): string {
  return repeatChar('-', width);
}

function formatReceiptMoneyEscPos(amount: number): string {
  return formatReceiptMoney(amount).replace(/\u20b9/g, 'Rs.');
}

export function buildVerificationReceiptEscPosPayload(
  receipt: VerificationReceiptData,
): Uint8Array {
  const builder = new EscPosTextBuilder().init().align('left').textSize('normal').bold(false);

  builder.align('center').bold(true).textSize('large');
  builder.textLine(VERIFICATION_RECEIPT_BRANDING.companyName);
  builder.textSize('normal');
  builder.bold(false);

  for (const line of VERIFICATION_RECEIPT_BRANDING.addressLines) {
    builder.textLine(line);
  }
  builder.textLine(`GSTIN : ${VERIFICATION_RECEIPT_BRANDING.gstin}`);

  builder.align('left').textLine(dashedRule());
  builder.align('center').bold(true);
  builder.textLine('CASH RECEIPT');
  builder.bold(false).align('left');
  builder.textLine(dashedRule());

  builder.textLine(labelValueEscPosLine('Receipt No', receipt.receiptNumber, RECEIPT_CHAR_WIDTH));
  builder.textLine(labelValueEscPosLine('Date', receipt.receiptDate, RECEIPT_CHAR_WIDTH));
  builder.textLine(labelValueEscPosLine('Time', receipt.receiptTime, RECEIPT_CHAR_WIDTH));

  builder.textLine(dashedRule());
  builder.textLine(labelValueEscPosLine('Customer Name', receipt.customerName, RECEIPT_CHAR_WIDTH));
  const locationLines = wrapEscPosText(receipt.customerLocation, RECEIPT_CHAR_WIDTH - 12);
  builder.textLine(labelValueEscPosLine('Location', locationLines[0] ?? receipt.customerLocation, RECEIPT_CHAR_WIDTH));
  for (let i = 1; i < locationLines.length; i += 1) {
    builder.textLine(locationLines[i]!);
  }

  builder.textLine(dashedRule());
  builder.textLine(leftRightEscPosLine('Description', 'Amount (Rs.)', RECEIPT_CHAR_WIDTH));
  builder.textLine(repeatChar('-', RECEIPT_CHAR_WIDTH));
  builder.textLine(
    leftRightEscPosLine(receipt.lineDescription, formatReceiptLineAmount(receipt.amount), RECEIPT_CHAR_WIDTH),
  );

  builder.textLine(dashedRule());
  builder.bold(true);
  builder.textLine(
    leftRightEscPosLine('Total Amount', formatReceiptMoneyEscPos(receipt.totalAmount), RECEIPT_CHAR_WIDTH),
  );
  builder.bold(false);

  builder.textLine(dashedRule());
  builder.textLine('Amount In Words');
  for (const line of wrapEscPosText(receipt.amountInWords, RECEIPT_CHAR_WIDTH)) {
    builder.textLine(line);
  }

  builder.textLine(dashedRule());
  builder.textLine('Payment Mode');
  builder.textLine(VERIFICATION_RECEIPT_BRANDING.paymentMode);

  builder.textLine(dashedRule());
  builder.align('center');
  for (const line of VERIFICATION_RECEIPT_BRANDING.footerLines) {
    builder.textLine(line);
  }
  builder.align('left');
  builder.textLine(dashedRule());
  builder.align('center');
  builder.textLine('This is a computer generated receipt.');
  builder.textLine('No signature required.');
  builder.align('left').feed(3);

  return builder.build();
}
