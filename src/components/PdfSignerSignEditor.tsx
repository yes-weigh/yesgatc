import React, { useRef } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Minus, Plus, Replace } from 'lucide-react';
import { StorageImage } from './StorageImage';
import type { ProductFileMeta } from '../lib/productApprovalUpload';
import {
  clampPdfSignerPercent,
  clampPdfSignerScale,
  PDF_SIGNER_NUDGE,
  PDF_SIGNER_SCALE_MAX,
  PDF_SIGNER_SCALE_MIN,
  PDF_SIGNER_SCALE_STEP,
} from '../lib/pdfSignerSign';

type PdfSignerSignEditorProps = {
  file: ProductFileMeta;
  scale: number;
  x: number;
  y: number;
  onLayoutChange: (patch: { scale?: number; x?: number; y?: number }) => void;
  onReplace: (event: React.ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  readOnly?: boolean;
  uploading?: boolean;
};

export function PdfSignerSignEditor({
  file,
  scale,
  x,
  y,
  onLayoutChange,
  onReplace,
  disabled = false,
  readOnly = false,
  uploading = false,
}: PdfSignerSignEditorProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const locked = disabled || readOnly || uploading;

  const bumpScale = (delta: number) => {
    onLayoutChange({ scale: clampPdfSignerScale(scale + delta) });
  };

  const nudge = (dx: number, dy: number) => {
    onLayoutChange({
      x: clampPdfSignerPercent(x + dx),
      y: clampPdfSignerPercent(y + dy),
    });
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (locked) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { px: event.clientX, py: event.clientY, x, y };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const nextX = drag.current.x + ((event.clientX - drag.current.px) / rect.width) * 100;
    const nextY = drag.current.y + ((event.clientY - drag.current.py) / rect.height) * 100;
    onLayoutChange({
      x: clampPdfSignerPercent(nextX),
      y: clampPdfSignerPercent(nextY),
    });
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div className="rc-pdf-signer-editor">
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png"
        hidden
        onChange={onReplace}
        disabled={locked}
      />
      {!readOnly ? (
        <div className="rc-pdf-signer-toolbar">
          <button
            type="button"
            className="rc-pdf-signer-btn"
            onClick={() => fileRef.current?.click()}
            disabled={locked}
          >
            <Replace size={15} aria-hidden />
            Replace
          </button>
          <button
            type="button"
            className="rc-pdf-signer-icon-btn"
            onClick={() => bumpScale(-PDF_SIGNER_SCALE_STEP)}
            disabled={locked || scale <= PDF_SIGNER_SCALE_MIN}
            aria-label="Make signature smaller"
          >
            <Minus size={16} aria-hidden />
          </button>
          <button
            type="button"
            className="rc-pdf-signer-icon-btn"
            onClick={() => bumpScale(PDF_SIGNER_SCALE_STEP)}
            disabled={locked || scale >= PDF_SIGNER_SCALE_MAX}
            aria-label="Make signature bigger"
          >
            <Plus size={16} aria-hidden />
          </button>
          <div className="rc-pdf-signer-nudge" role="group" aria-label="Move signature">
            <button
              type="button"
              className="rc-pdf-signer-icon-btn"
              onClick={() => nudge(0, -PDF_SIGNER_NUDGE)}
              disabled={locked}
              aria-label="Move signature up"
            >
              <ArrowUp size={15} aria-hidden />
            </button>
            <div className="rc-pdf-signer-nudge-mid">
              <button
                type="button"
                className="rc-pdf-signer-icon-btn"
                onClick={() => nudge(-PDF_SIGNER_NUDGE, 0)}
                disabled={locked}
                aria-label="Move signature left"
              >
                <ArrowLeft size={15} aria-hidden />
              </button>
              <button
                type="button"
                className="rc-pdf-signer-icon-btn"
                onClick={() => nudge(PDF_SIGNER_NUDGE, 0)}
                disabled={locked}
                aria-label="Move signature right"
              >
                <ArrowRight size={15} aria-hidden />
              </button>
            </div>
            <button
              type="button"
              className="rc-pdf-signer-icon-btn"
              onClick={() => nudge(0, PDF_SIGNER_NUDGE)}
              disabled={locked}
              aria-label="Move signature down"
            >
              <ArrowDown size={15} aria-hidden />
            </button>
          </div>
        </div>
      ) : null}
      <div
        ref={stageRef}
        className={`rc-pdf-signer-stage${locked ? ' is-locked' : ''}`}
      >
        <div
          className={`rc-pdf-signer-mark${locked ? '' : ' is-draggable'}`}
          style={{
            left: `${x}%`,
            top: `${y}%`,
            transform: `translate(-50%, -50%) scale(${scale})`,
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <StorageImage
            url={file.url}
            path={file.path}
            alt="Officer signature"
            className="rc-pdf-signer-img"
          />
        </div>
      </div>
    </div>
  );
}
