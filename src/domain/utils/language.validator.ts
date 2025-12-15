/**
 * ISO-639-1 language code validator
 * Validates that a language code is a valid ISO-639-1 two-letter code
 */

// Common ISO-639-1 language codes (subset of most commonly used)
const ISO_639_1_CODES = new Set([
  "aa", "ab", "ae", "af", "ak", "am", "an", "ar", "as", "av", "ay", "az",
  "ba", "be", "bg", "bh", "bi", "bm", "bn", "bo", "br", "bs",
  "ca", "ce", "ch", "co", "cr", "cs", "cu", "cv", "cy",
  "da", "de", "dv", "dz",
  "ee", "el", "en", "eo", "es", "et", "eu",
  "fa", "ff", "fi", "fj", "fo", "fr", "fy",
  "ga", "gd", "gl", "gn", "gu", "gv",
  "ha", "he", "hi", "ho", "hr", "ht", "hu", "hy", "hz",
  "ia", "id", "ie", "ig", "ii", "ik", "io", "is", "it", "iu",
  "ja", "jv",
  "ka", "kg", "ki", "kj", "kk", "kl", "km", "kn", "ko", "kr", "ks", "ku", "kv", "kw", "ky",
  "la", "lb", "lg", "li", "ln", "lo", "lt", "lu", "lv",
  "mg", "mh", "mi", "mk", "ml", "mn", "mr", "ms", "mt", "my",
  "na", "nb", "nd", "ne", "ng", "nl", "nn", "no", "nr", "nv", "ny",
  "oc", "oj", "om", "or", "os",
  "pa", "pi", "pl", "ps", "pt",
  "qu",
  "rm", "rn", "ro", "ru", "rw",
  "sa", "sc", "sd", "se", "sg", "si", "sk", "sl", "sm", "sn", "so", "sq", "sr", "ss", "st", "su", "sv", "sw",
  "ta", "te", "tg", "th", "ti", "tk", "tl", "tn", "to", "tr", "ts", "tt", "tw", "ty",
  "ug", "uk", "ur", "uz",
  "ve", "vi", "vo",
  "wa", "wo",
  "xh",
  "yi", "yo",
  "za", "zh", "zu"
]);

/**
 * Validates if a string is a valid ISO-639-1 language code
 * @param lang - The language code to validate
 * @returns true if valid, false otherwise
 */
export function isValidISO6391Code(lang: string): boolean {
  if (!lang || typeof lang !== "string") {
    return false;
  }
  
  // ISO-639-1 codes are exactly 2 lowercase letters
  if (lang.length !== 2) {
    return false;
  }
  
  // Check if all characters are letters
  if (!/^[a-z]{2}$/.test(lang)) {
    return false;
  }
  
  // Check if it's in our list of valid codes
  return ISO_639_1_CODES.has(lang.toLowerCase());
}

/**
 * Validates and normalizes an ISO-639-1 language code
 * @param lang - The language code to validate and normalize
 * @returns The normalized lowercase code if valid, undefined otherwise
 */
export function validateAndNormalizeLanguage(lang: string | undefined | null): string | undefined {
  if (!lang) {
    return undefined;
  }
  
  const normalized = lang.toLowerCase().trim();
  
  if (isValidISO6391Code(normalized)) {
    return normalized;
  }
  
  return undefined;
}
