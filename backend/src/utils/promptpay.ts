function emvField(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, "0")}${value}`;
}

function crc16CcittFalse(value: string): string {
  let crc = 0xffff;

  for (const byte of Buffer.from(value, "utf8")) {
    crc ^= byte << 8;

    for (let bit = 0; bit < 8; bit += 1) {
      crc =
        (crc & 0x8000) !== 0
          ? ((crc << 1) ^ 0x1021) & 0xffff
          : (crc << 1) & 0xffff;
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function normalizePromptPayId(promptPayId: string): {
  tag: "01" | "02";
  value: string;
} {
  const digits = promptPayId.replace(/\D/g, "");

  if (digits.length === 10 && digits.startsWith("0")) {
    return {
      tag: "01",
      value: `0066${digits.slice(1)}`,
    };
  }

  if (digits.length === 13) {
    return {
      tag: "02",
      value: digits,
    };
  }

  throw new Error(
    "PROMPTPAY_ID must be a 10-digit Thai phone number or 13-digit citizen/tax ID",
  );
}

export function createPromptPayPayload(
  promptPayId: string,
  amount: number,
): string {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(
      "PromptPay amount must be greater than zero",
    );
  }

  const target = normalizePromptPayId(promptPayId);
  const merchantAccount =
    emvField("00", "A000000677010111") +
    emvField(target.tag, target.value);

  const payloadWithoutCrc =
    emvField("00", "01") +
    emvField("01", "12") +
    emvField("29", merchantAccount) +
    emvField("53", "764") +
    emvField("54", amount.toFixed(2)) +
    emvField("58", "TH") +
    "6304";

  return (
    payloadWithoutCrc +
    crc16CcittFalse(payloadWithoutCrc)
  );
}
