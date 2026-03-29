/**
 * Generate a member ID like "P-001", "P-042", etc.
 */
export function generateMemberId(existingIds: string[]): string {
  const nums = existingIds
    .map((id) => parseInt(id.replace(/\D/g, "")) || 0)
    .filter((n) => !isNaN(n));
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return `P-${String(max + 1).padStart(3, "0")}`;
}

/**
 * Generate a payment ID like "PAY-1711234567890"
 */
export function generatePaymentId(): string {
  return `PAY-${Date.now()}`;
}

/**
 * Generate an SPK ID like "SPK-234567"
 */
export function generateSpkId(): string {
  return `SPK-${Date.now().toString().slice(-6)}`;
}

/**
 * Generate an installment ID like "CIL-P-001"
 */
export function generateInstallmentId(memberId: string): string {
  return `CIL-${memberId}`;
}

/**
 * Generate a meter reading ID like "P-001-2026-3"
 */
export function generateReadingId(
  memberId: string,
  year: number,
  month: number
): string {
  return `${memberId}-${year}-${month}`;
}

/**
 * Format currency as Indonesian Rupiah
 */
export function formatRp(num: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(num || 0);
}

/**
 * Get current month and year
 */
export function getCurrentPeriod(): { month: number; year: number } {
  const now = new Date();
  return {
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  };
}
