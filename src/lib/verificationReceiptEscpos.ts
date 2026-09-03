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

export function buildVerificationReceiptEscPosPayload(
  receipt: VerificationReceiptData,
): Uint8Array {
  const builder = new EscPosTextBuilder().init().align('left').textSize('normal').bold(false);

  const issuer = receipt.issuer;

  builder.align('center').bold(true).textSize('normal');
  builder.textLine(issuer.companyName);
  builder.bold(false);

  for (const line of issuer.addressLines) {
    builder.textLine(line);
  }
  if (issuer.phone) {
    builder.textLine(`Ph: ${issuer.phone}`);
  }

  builder.align('left').textLine(dashedRule());
  builder.align('center').bold(true);
  builder.textLine('CASH RECEIPT');
  builder.bold(false).align('left');
  builder.textLine(dashedRule());

  builder.textLine(labelValueEscPosLine('Receipt No', receipt.receiptNumber, RECEIPT_CHAR_WIDTH));
  builder.textLine(labelValueEscPosLine('Date', receipt.receiptDate, RECEIPT_CHAR_WIDTH));
  builder.textLine(labelValueEscPosLine('Time', receipt.receiptTime, RECEIPT_CHAR_WIDTH));

  builder.textLine(dashedRule());
  builder.bold(true);
  builder.textLine(labelValueEscPosLine('Customer Name', receipt.customerName, RECEIPT_CHAR_WIDTH));
  appendLabeledValue(builder, 'Phone', receipt.customerPhone);
  appendLabeledValue(builder, 'Place', receipt.customerAddress);
  builder.textLine(labelValueEscPosLine('Pincode', receipt.customerPincode, RECEIPT_CHAR_WIDTH));
  builder.textLine(labelValueEscPosLine('District', receipt.customerDistrict, RECEIPT_CHAR_WIDTH));
  builder.textLine(labelValueEscPosLine('State', receipt.customerState, RECEIPT_CHAR_WIDTH));
  builder.textLine(labelValueEscPosLine('VCT Name', receipt.vctName, RECEIPT_CHAR_WIDTH));
  builder.textLine(labelValueEscPosLine('VCT Number', receipt.vctNumber, RECEIPT_CHAR_WIDTH));
  builder.bold(false);

  builder.textLine(dashedRule());
  builder.bold(true);
  builder.textLine(leftRightEscPosLine('Description', 'Amount (Rs.)', RECEIPT_CHAR_WIDTH));
  builder.textLine(repeatChar('-', RECEIPT_CHAR_WIDTH));
  for (const line of receipt.lines) {
    builder.textLine(
      leftRightEscPosLine(line.description, formatReceiptLineAmount(line.amount), RECEIPT_CHAR_WIDTH),
    );
  }

  builder.textLine(dashedRule());
  builder.textLine(
    leftRightEscPosLine('Cash Total', formatReceiptMoneyEscPos(receipt.totalAmount), RECEIPT_CHAR_WIDTH),
  );
  builder.bold(false);

  builder.textLine(dashedRule());
  builder.textLine('Amount In Words');
  for (const line of wrapEscPosText(receipt.amountInWords, RECEIPT_CHAR_WIDTH)) {
    builder.textLine(line);
  }

  builder.textLine(dashedRule());
  builder.textLine('Payment Mode');
  builder.textLine(issuer.paymentMode);

  builder.textLine(dashedRule());
  builder.align('center');
  builder.textLine('This is a computer generated receipt.');
  builder.textLine('No signature required.');
  builder.align('left').feed(3);

  return builder.build();
}
