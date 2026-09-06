# Product Media Context

## Durable concerns

Product media must preserve the distinction between media slot, main image, detail/gallery media, metadata, and generated mini-program output. Legacy `img` and `gallery` representations require a compatibility normalization boundary.

## Contract to preserve

The editor-to-preview-to-generator path includes upload, delete, validation, media metadata, main/detail mapping, `productMediaSlot`, and package-size constraints. The normalization boundary must support legacy `img`/`gallery` input without losing ordering, role, or metadata. Media payload bytes and media metadata should remain separable at adapter boundaries; the exact current Meoo Storage implementation remains `NOT_VERIFIED`.

The generated mini-program package is the acceptance artifact. Editor state alone does not prove that the main image, detail/gallery images, deletion behavior, invalid-media handling, or large-media policy survived generation.

## Current status

- `MEDIA_REPOSITORY_PRESENT=YES`
- Normalization and editor/preview/generator parity: `NOT_VERIFIED`
- Upload/delete/validation end-to-end: `NOT_VERIFIED`
- Large media and package handling: `NOT_VERIFIED`
- Product Media remains an open audit area.

## Required future verification

Use explicit fixtures for legacy `img`, `gallery`, `productMediaSlot`, main media, detail media, deletion, invalid media, non-ASCII metadata, and oversized media. Verify the generated mini-program package and the preview, rather than only editor state. A future implementation task should be single-target and separate from the mixed historical audit thread.
