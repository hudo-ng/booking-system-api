export const parseMoney = (value: any): number => {
  if (value === undefined || value === null || value === "") return 0;

  // if already number
  if (typeof value === "number" && !isNaN(value)) return value;

  // if string → convert to number
  if (typeof value === "string") {
    const cleaned = value.trim();

    // Must match format: 123, 123.45, 0.50, etc.
    if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
      throw new Error(`Invalid money format: ${value}`);
    }

    return parseFloat(cleaned);
  }

  throw new Error(`Invalid money value: ${value}`);
};

export const normalizePhone = (phoneStr: string | null | undefined): string => {
  if (!phoneStr) return "";
  // Strip everything except numbers
  let cleaned = phoneStr.replace(/\D/g, "");
  // Remove leading US country code if present
  if (cleaned.length === 11 && cleaned.startsWith("1")) {
    cleaned = cleaned.substring(1);
  }
  return cleaned.length === 10 ? cleaned : "";
};

/**
 * Normalizes a string for loose, case-insensitive comparison
 */
export const normalizeName = (nameStr: string | null | undefined): string => {
  if (!nameStr) return "";
  return nameStr.trim().toLowerCase().replace(/\s+/g, " ");
};
