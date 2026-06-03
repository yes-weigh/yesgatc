/** Draw the current video frame to a JPEG file for upload. */
export function captureImageFileFromVideo(
  video: HTMLVideoElement,
  fileName = `photo-${Date.now()}.jpg`,
): Promise<File | null> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return Promise.resolve(null);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(video, 0, 0, width, height);

  return new Promise(resolve => {
    canvas.toBlob(
      blob => {
        if (!blob) {
          resolve(null);
          return;
        }
        resolve(new File([blob], fileName, { type: 'image/jpeg', lastModified: Date.now() }));
      },
      'image/jpeg',
      0.9,
    );
  });
}
