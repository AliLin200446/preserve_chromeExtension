const thumbnails = new WeakMap<Blob, Promise<Blob>>();
/** Bounded previews, created only when a visible thumbnail needs them. */
export function thumbnailFor(blob: Blob) {
  let cached = thumbnails.get(blob);
  if (!cached) {
    cached = (async () => {
      const bitmap = await createImageBitmap(blob, {
        resizeWidth: 512,
        resizeQuality: "medium",
      });
      try {
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
        return await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(Error("Thumbnail unavailable"))),
            "image/webp",
            0.82,
          ),
        );
      } finally {
        bitmap.close();
      }
    })().catch(() => blob);
    thumbnails.set(blob, cached);
  }
  return cached;
}
