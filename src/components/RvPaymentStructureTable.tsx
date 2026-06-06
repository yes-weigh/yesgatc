import React from 'react';
import {
  formatRvPaymentStructureAmount,
  RV_PAYMENT_STRUCTURE_ROWS,
} from '../lib/rvPaymentStructure';

type RvPaymentStructureTableProps = {
  className?: string;
};

export const RvPaymentStructureTable: React.FC<RvPaymentStructureTableProps> = ({
  className = '',
}) => (
  <div className={`rv-payment-structure-table-wrap${className ? ` ${className}` : ''}`}>
    <div className="table-scroll">
      <table className="data-table data-table--rv-payment-structure">
        <thead>
          <tr>
            <th scope="col">Cap</th>
            <th scope="col">Base</th>
            <th scope="col">GST</th>
            <th scope="col">Total</th>
            <th scope="col">Payout</th>
          </tr>
        </thead>
        <tbody>
          {RV_PAYMENT_STRUCTURE_ROWS.map(row => (
            <tr key={row.cap}>
              <td data-label="Cap">{row.cap}</td>
              <td data-label="Base">{formatRvPaymentStructureAmount(row.baseInr)}</td>
              <td data-label="GST">{formatRvPaymentStructureAmount(row.gstInr)}</td>
              <td data-label="Total">{formatRvPaymentStructureAmount(row.totalInr)}</td>
              <td data-label="Payout">{formatRvPaymentStructureAmount(row.payoutInr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);
