// Abstraction for where audio comes from (upload, GCS, etc.)

export interface IAudioSource {
    getId(): string; // e.g. "s3://bucket/file.wav" or "gs://bucket/file.wav"
    getReadableStream(): NodeJS.ReadableStream;
}