const TAX_RATE = 0.0825;

export interface PiercingPaymentBreakdown {
  cash: number;
  cashApp: number;
  card: number;
  saleTax: number;
  cashSaleTax: number;
}

function amount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalAmount(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function getPiercingPaymentBreakdown(
  item: Record<string, unknown>,
): PiercingPaymentBreakdown {
  const price = amount(item.price);
  const jewelry = amount(item.priceJewelry);
  const saline = amount(item.priceSaline);
  const jewelryTax =
    optionalAmount(item.taxJewelry ?? item.tax_jewelry) ??
    Number((jewelry * TAX_RATE).toFixed(2));
  const salineTax =
    optionalAmount(item.taxSaline ?? item.tax_saline) ??
    Number((saline * TAX_RATE).toFixed(2));
  const tax = optionalAmount(item.taxTotal ?? item.tax_total) ?? jewelryTax + salineTax;
  const exactAmountDue = price + jewelry + saline + tax;
  const roundedAmountDue = Math.round(exactAmountDue);
  const recordedCash = amount(item.cash);
  const recordedCard = amount(item.card);
  const paymentMethod =
    typeof item.paid_by === "string" ? item.paid_by.toLowerCase() : "";

  let cash = 0;
  let cashApp = 0;
  let card = 0;

  if (paymentMethod === "cash" || !paymentMethod) {
    cash = recordedCash || roundedAmountDue;
  } else if (paymentMethod === "card") {
    card = recordedCard || roundedAmountDue;
  } else if (paymentMethod === "cash-app") {
    cashApp = recordedCash || roundedAmountDue;
  } else if (paymentMethod === "card & cash") {
    const impliedCash = roundedAmountDue - recordedCard;
    cash = impliedCash >= 0 ? impliedCash : recordedCash;
    card = recordedCard;
  }

  const roundingAdjustment = exactAmountDue - roundedAmountDue;
  const saleTax = tax - roundingAdjustment;
  const cashEquivalent = cash + cashApp;
  const cashSaleTax =
    roundedAmountDue > 0
      ? saleTax * Math.min(Math.max(cashEquivalent / roundedAmountDue, 0), 1)
      : 0;

  return {
    cash,
    cashApp,
    card,
    saleTax,
    cashSaleTax,
  };
}
