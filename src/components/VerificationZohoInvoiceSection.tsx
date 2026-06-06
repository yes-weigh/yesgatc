import React from 'react';
import { FileText } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { zohoInvoiceOrderReferenceFromCertificate } from '../lib/zohoInvoiceReference';
import {
  canViewZohoPushDiagnostics,
  resolveZohoPushStatus,
  resolveZohoSettlementStatus,
  zohoPushStatusLabel,
  zohoSettlementStatusLabel,
} from '../lib/zohoRvSubmit';
import type { SiteCalibration } from '../types';

type VerificationZohoInvoiceSectionProps = {
  record: SiteCalibration;
};

export const VerificationZohoInvoiceSection: React.FC<VerificationZohoInvoiceSectionProps> = ({
  record,
}) => {
  const { user } = useAuth();
  const status = resolveZohoPushStatus(record);
  const settlementStatus = resolveZohoSettlementStatus(record);
  const orderReference =
    record.zohoInvoiceReferenceNumber?.trim()
    || zohoInvoiceOrderReferenceFromCertificate(record.certificateNumber);
  if (!status) return null;

  const showError =
    canViewZohoPushDiagnostics(user?.role) && record.zohoPushError?.trim();
  const showSettlementError =
    canViewZohoPushDiagnostics(user?.role) && record.zohoSettlementError?.trim();

  return (
    <section className="verification-detail-section">
      <h3 className="verification-detail-section-title">
        <FileText className="inline-icon" size={16} aria-hidden />
        Zoho invoice
      </h3>
      <div className="verification-detail-grid">
        <div className="verification-detail-field">
          <span className="verification-detail-label">Status</span>
          <span className={`verification-detail-value verification-zoho-status verification-zoho-status--${status}`}>
            {zohoPushStatusLabel(status)}
          </span>
        </div>
        {record.zohoInvoiceNumber?.trim() && (
          <div className="verification-detail-field">
            <span className="verification-detail-label">Invoice no.</span>
            <span className="verification-detail-value text-mono">{record.zohoInvoiceNumber.trim()}</span>
          </div>
        )}
        {orderReference && (
          <div className="verification-detail-field">
            <span className="verification-detail-label">Order no.</span>
            <span className="verification-detail-value text-mono">{orderReference}</span>
          </div>
        )}
        {record.zohoCustomerName?.trim() && (
          <div className="verification-detail-field">
            <span className="verification-detail-label">Zoho customer</span>
            <span className="verification-detail-value">{record.zohoCustomerName.trim()}</span>
          </div>
        )}
        {record.zohoInvoiceTotal != null && Number.isFinite(record.zohoInvoiceTotal) && (
          <div className="verification-detail-field">
            <span className="verification-detail-label">Invoice total</span>
            <span className="verification-detail-value">₹{record.zohoInvoiceTotal.toLocaleString('en-IN')}</span>
          </div>
        )}
        {record.zohoOrganizationId?.trim() && (
          <div className="verification-detail-field">
            <span className="verification-detail-label">Zoho org ID</span>
            <span className="verification-detail-value text-mono text-sm">{record.zohoOrganizationId.trim()}</span>
          </div>
        )}
        {record.zohoInvoiceId?.trim() && (
          <div className="verification-detail-field">
            <span className="verification-detail-label">Invoice ID</span>
            <span className="verification-detail-value text-mono text-sm">{record.zohoInvoiceId.trim()}</span>
          </div>
        )}
        {record.zohoPushedAt && (
          <div className="verification-detail-field">
            <span className="verification-detail-label">Pushed at</span>
            <span className="verification-detail-value">
              {new Date(record.zohoPushedAt).toLocaleString()}
            </span>
          </div>
        )}
        {showError && (
          <div className="verification-detail-field verification-detail-field--full">
            <span className="verification-detail-label">Error</span>
            <span className="verification-detail-value text-danger text-sm">{record.zohoPushError}</span>
          </div>
        )}
        {settlementStatus && (
          <div className="verification-detail-field">
            <span className="verification-detail-label">Settlement</span>
            <span className={`verification-detail-value verification-zoho-status verification-zoho-status--${settlementStatus}`}>
              {zohoSettlementStatusLabel(settlementStatus)}
            </span>
          </div>
        )}
        {record.zohoCustomerPaymentStatus && (
          <div className="verification-detail-field">
            <span className="verification-detail-label">Customer payment</span>
            <span className="verification-detail-value text-sm">
              {record.zohoCustomerPaymentStatus === 'skipped_paid'
                ? 'Already paid in Zoho'
                : record.zohoCustomerPaymentAmountInr != null
                  ? `₹${record.zohoCustomerPaymentAmountInr.toLocaleString('en-IN')}`
                  : record.zohoCustomerPaymentStatus}
            </span>
          </div>
        )}
        {record.zohoExpenseAmountInr != null && (
          <div className="verification-detail-field">
            <span className="verification-detail-label">Labour expense</span>
            <span className="verification-detail-value text-sm">
              ₹{record.zohoExpenseAmountInr.toLocaleString('en-IN')}
            </span>
          </div>
        )}
        {record.zohoSettledAt && (
          <div className="verification-detail-field">
            <span className="verification-detail-label">Settled at</span>
            <span className="verification-detail-value text-sm">
              {new Date(record.zohoSettledAt).toLocaleString()}
            </span>
          </div>
        )}
        {showSettlementError && (
          <div className="verification-detail-field verification-detail-field--full">
            <span className="verification-detail-label">Settlement error</span>
            <span className="verification-detail-value text-danger text-sm">{record.zohoSettlementError}</span>
          </div>
        )}
      </div>
    </section>
  );
};
