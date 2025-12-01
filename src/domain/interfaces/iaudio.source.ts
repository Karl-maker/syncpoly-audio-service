// Abstraction for where audio comes from (upload, GCS, etc.)

export interface IAudioSource {
    getId(): string; // e.g. "bucket/file.wav" or "bucket/key"
    getReadableStream(): NodeJS.ReadableStream;
}