export const AudioSourceProviders = [
    's3',
    'r2'
] as const;

export type AudioSourceProvidersType = typeof AudioSourceProviders[number]