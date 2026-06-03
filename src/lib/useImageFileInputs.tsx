import React, { useCallback, useId, useRef } from 'react';
import {
  fileInputAcceptForCapture,
  getImageCaptureAttribute,
  type ImageCaptureFacing,
} from './imageCapture';

type UseImageFileInputsOptions = {
  avatar?: boolean;
  disabled?: boolean;
  onSelect: (file: File) => void;
};

export type ImageFileInputsApi = {
  /** Mobile touch / PWA — offer camera and gallery separately. */
  mobileSourceChoice: boolean;
  openPicker: () => void;
  openCamera: () => void;
  openGallery: () => void;
  inputs: React.ReactNode;
};

export function useImageFileInputs(
  accept: string,
  options: UseImageFileInputsOptions,
): ImageFileInputsApi {
  const { avatar, disabled, onSelect } = options;
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const desktopRef = useRef<HTMLInputElement>(null);
  const idPrefix = useId().replace(/:/g, '');

  const capture: ImageCaptureFacing | undefined = getImageCaptureAttribute(accept, { avatar });
  const mobileSourceChoice = capture !== undefined;
  const cameraAccept = fileInputAcceptForCapture(accept, capture);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file) onSelect(file);
    },
    [onSelect],
  );

  const openPicker = useCallback(() => {
    if (!mobileSourceChoice) desktopRef.current?.click();
  }, [mobileSourceChoice]);

  const openCamera = useCallback(() => {
    cameraRef.current?.click();
  }, []);

  const openGallery = useCallback(() => {
    galleryRef.current?.click();
  }, []);

  const inputs = mobileSourceChoice ? (
    <>
      <input
        ref={cameraRef}
        id={`${idPrefix}-camera`}
        type="file"
        accept={cameraAccept}
        capture={capture}
        className="sr-only"
        onChange={handleChange}
        disabled={disabled}
      />
      <input
        ref={galleryRef}
        id={`${idPrefix}-gallery`}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={handleChange}
        disabled={disabled}
      />
    </>
  ) : (
    <input
      ref={desktopRef}
      id={`${idPrefix}-file`}
      type="file"
      accept={accept}
      className="sr-only"
      onChange={handleChange}
      disabled={disabled}
    />
  );

  return { mobileSourceChoice, openPicker, openCamera, openGallery, inputs };
}
