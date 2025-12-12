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
