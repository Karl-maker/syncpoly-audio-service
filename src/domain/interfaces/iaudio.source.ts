// Abstraction for where audio comes from (upload, GCS, etc.)

export interface IAudioSource {
    getId(): string; // e.g. "gs://bucket/file.wav"
    getReadableStream(): NodeJS.ReadableStream;
}