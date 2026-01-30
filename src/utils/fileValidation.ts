import { fileTypeFromBuffer } from "file-type";

const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1MB

// Allowed image MIME types
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml"
]);

export interface FileValidationError {
  valid: boolean;
  error?: string;
}

/**
 * Validate image file type and size using file-type library
 * @param file - The Blob/File to validate
 * @param maxSize - Maximum file size in bytes (default: 1MB)
 * @returns Validation result with optional error message
 */
export async function validateImageFile(
  file: Blob,
  maxSize: number = MAX_FILE_SIZE
): Promise<FileValidationError> {
  // Convert Blob to ArrayBuffer for file-type analysis
  const arrayBuffer = await file.arrayBuffer();

  // Validate file size first (faster check)
  if (arrayBuffer.byteLength > maxSize) {
    const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(0);
    return { valid: false, error: `File size must be less than ${maxSizeMB}MB` };
  }

  // Validate file type using magic numbers
  const fileType = await fileTypeFromBuffer(arrayBuffer);

  if (!fileType) {
    return { valid: false, error: "Unable to determine file type" };
  }

  if (!ALLOWED_IMAGE_TYPES.has(fileType.mime)) {
    return { valid: false, error: `File type ${fileType.mime} is not allowed. Only image files are allowed.` };
  }

  return { valid: true };
}
