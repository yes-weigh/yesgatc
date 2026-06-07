import { formatRcFeeAmount } from './rcProfileFields';
import type { WalletLedgerEntry, WalletTopUp } from '../types';

function walletTopUpReference(topUpId: string): string {
  const safe = topUpId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);
  return `WALLET-${safe || 'TOPUP'}`;
}

function zohoTransferTargetLabel(topUp: WalletTopUp | undefined): string {
  if (!topUp) return 'destination bank account';
  if (topUp.rechargeMethod === 'razorpay') {
    return topUp.zohoToAccountName?.trim() || 'Razorpay';
  }
  return topUp.zohoToAccountName?.trim() || 'Kotak Current Account';
}

function formatLedgerDeleteSummary(
  entry: WalletLedgerEntry,
  rcName: string,
): string {
  const amount = formatRcFeeAmount(Math.abs(entry.amountInr));
  const signed = entry.amountInr >= 0 ? `+${amount}` : `−${amount}`;
  return `${rcName} · ${signed} · ${entry.createdAt.slice(0, 10)}`;
}

/**
 * Plain-text notice for the delete confirmation — lists Zoho Books rows to remove manually.
 */
export function buildWalletLedgerZohoClearanceMessage(
  entry: WalletLedgerEntry,
  linkedTopUp: WalletTopUp | undefined,
  rcName: string,
): string {
  const lines: string[] = [
    `Firebase: delete ledger entry (${formatLedgerDeleteSummary(entry, rcName)}).`,
    'RC wallet balance will be adjusted to reverse this row.',
    '',
    'ZOHO BOOKS — remove manually to stay in sync:',
  ];

  if (entry.type === 'top_up_credit') {
    if (linkedTopUp?.zohoTransferStatus === 'completed') {
      const fromAccount = linkedTopUp.zohoFromAccountName?.trim() || 'GATC Wallet';
      const toAccount = zohoTransferTargetLabel(linkedTopUp);
      const reference =
        linkedTopUp.zohoReferenceNumber?.trim()
        || (linkedTopUp.id ? walletTopUpReference(linkedTopUp.id) : '—');
      lines.push(
        `• Transfer Fund: ${fromAccount} → ${toAccount}`,
        `• Amount: ${formatRcFeeAmount(linkedTopUp.amountInr)}`,
        `• Reference #: ${reference}`,
        linkedTopUp.zohoTransferDate
          ? `• Date: ${linkedTopUp.zohoTransferDate}`
          : `• Ledger date: ${entry.createdAt.slice(0, 10)}`,
      );
      if (linkedTopUp.zohoTransactionId) {
        lines.push(`• Zoho transaction ID: ${linkedTopUp.zohoTransactionId}`);
      }
      if (linkedTopUp.zohoTransferDescription) {
        lines.push(`• Description: ${linkedTopUp.zohoTransferDescription}`);
      }
    } else {
      lines.push(
        '• No completed GATC Wallet bank transfer is linked to this top-up.',
        '• Nothing to delete in Zoho for this ledger row (transfer failed or was never pushed).',
      );
    }
    if (linkedTopUp) {
      lines.push(
        '',
        `Note: wallet top-up record ${linkedTopUp.id.slice(0, 8)}… remains in Firebase unless you delete it from Top-ups.`,
      );
    }
  } else if (entry.type === 'rv_payment') {
    lines.push(
      '• No GATC Wallet bank transfer is created for RV wallet payments.',
      '• Delete only this Firebase ledger row here.',
    );
    if (entry.recordIds?.length) {
      lines.push(
        `• Linked verification record(s): ${entry.recordIds.join(', ')}`,
        '• If you posted RV invoice / settlement in Zoho for these, remove those entries separately.',
      );
    } else {
      lines.push('• If you posted related RV invoice or settlement in Zoho, remove those separately.');
    }
  } else if (entry.type === 'rv_refund') {
    lines.push(
      '• No GATC Wallet bank transfer is created for RV refunds.',
      '• Delete only this Firebase ledger row here.',
    );
    if (entry.relatedPaymentId) {
      lines.push(`• Related payment ID: ${entry.relatedPaymentId}`);
    }
  }

  return lines.join('\n');
}
